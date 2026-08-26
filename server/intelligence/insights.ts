import { randomUUID } from "node:crypto";
import { db, getPerson, getPersonCommunications } from "../db.js";
import type {
  InsightSuggestion,
  RelationshipInsight,
  RelationshipMode,
} from "../../src/lib/contracts.js";
import { calculateRelationshipSignals } from "./service.js";
import { defaultCloudModel, getAskWriterKey, getAskWriterSettings } from "./ask-writer.js";
import { CloudLlmError, generateCloudStructured, isOpenAiCompatible, type CloudWriter } from "./cloud-llm.js";

const THEME_WORDS: Record<string, string[]> = {
  work: ["meeting", "deadline", "project", "client", "office", "standup", "okr", "launch"],
  family: ["family", "kids", "mom", "dad", "sister", "brother", "wedding", "birthday"],
  logistics: ["flight", "airport", "uber", "schedule", "calendar", "reschedule", "tomorrow"],
  social: ["dinner", "coffee", "drinks", "party", "weekend", "catch up", "hang"],
  finance: ["invoice", "budget", "raise", "invest", "funding", "equity"],
  product: ["design", "prototype", "ship", "feature", "roadmap", "users"],
};

const CATEGORY_WORDS = [
  "finance", "policy", "fundraising", "AI", "robotics", "health", "travel",
  "founder", "investor", "climate", "design", "product", "research",
];

function assertActive(signal?: AbortSignal) {
  if (signal?.aborted) {
    const error = new Error("Insights cancelled");
    error.name = "AbortError";
    throw error;
  }
}

function classifyMode(bodies: string[], channels: string[]): {
  mode: RelationshipMode;
  evidence: string[];
} {
  const text = bodies.join("\n").toLowerCase();
  const businessHits = ["invoice", "contract", "meeting", "proposal", "q1", "q2", "q3", "q4", "okr", "pipeline"]
    .filter((word) => text.includes(word));
  const personalHits = ["love", "miss you", "family", "dinner", "birthday", "weekend", "kids", "haha", "lol"]
    .filter((word) => text.includes(word));
  const evidence: string[] = [];
  for (const body of bodies.slice(0, 40)) {
    const lower = body.toLowerCase();
    if ([...businessHits, ...personalHits].some((word) => lower.includes(word))) {
      evidence.push(body.slice(0, 160));
      if (evidence.length >= 3) break;
    }
  }
  const gmailHeavy = channels.includes("gmail") && !channels.includes("messages");
  if (businessHits.length >= 2 && personalHits.length >= 2) {
    return { mode: "mixed", evidence };
  }
  if (businessHits.length > personalHits.length || (gmailHeavy && businessHits.length)) {
    return { mode: "business", evidence };
  }
  if (personalHits.length > 0) return { mode: "personal", evidence };
  return { mode: "mixed", evidence };
}

function detectThemes(bodies: string[]) {
  const themes: { label: string; evidence: string[] }[] = [];
  for (const [label, words] of Object.entries(THEME_WORDS)) {
    const evidence: string[] = [];
    for (const body of bodies) {
      const lower = body.toLowerCase();
      if (words.some((word) => lower.includes(word))) {
        evidence.push(body.slice(0, 160));
        if (evidence.length >= 2) break;
      }
    }
    if (evidence.length) themes.push({ label, evidence });
  }
  return themes.slice(0, 6);
}

function categorySuggestions(
  person: Record<string, unknown>,
  bodies: string[],
): InsightSuggestion[] {
  const existing = new Set(
    (Array.isArray(person.tags) ? person.tags as string[] : [])
      .map((tag) => tag.toLowerCase()),
  );
  const found = new Map<string, string>();
  for (const body of bodies) {
    for (const tag of CATEGORY_WORDS) {
      if (existing.has(tag.toLowerCase())) continue;
      if (new RegExp(`\\b${tag}\\b`, "i").test(body) && !found.has(tag)) {
        found.set(tag, body.slice(0, 160));
      }
    }
  }
  return [...found.entries()].slice(0, 5).map(([tag, excerpt]) => ({
    id: randomUUID(),
    kind: "tag" as const,
    field: "tags",
    value: tag,
    confidence: 0.62,
    reason: `Mentioned in recent messages.`,
    evidence: [excerpt],
  }));
}

function strategySuggestions(
  signal: ReturnType<typeof calculateRelationshipSignals>,
  themes: { label: string; evidence: string[] }[],
  mode: RelationshipMode | null,
): InsightSuggestion[] {
  const suggestions: InsightSuggestion[] = [];
  const days = signal.explanation.daysSinceContact as number;
  if (days >= 21) {
    const topic = themes[0]?.label || "your last conversation";
    suggestions.push({
      id: randomUUID(),
      kind: "strategy",
      value: `Reach out about ${topic} — it has been ${Math.round(days)} days since contact.`,
      confidence: 0.7,
      reason: "Cadence has drifted past the usual gap.",
      evidence: themes[0]?.evidence || [`Last contact about ${Math.round(days)} days ago.`],
    });
    const due = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    suggestions.push({
      id: randomUUID(),
      kind: "follow_up",
      field: "follow_up_date",
      value: due,
      confidence: 0.65,
      reason: "Suggested follow-up based on silence and recent themes.",
      evidence: themes[0]?.evidence || [],
    });
  }
  if (mode === "business" && (signal.explanation.outgoing as number) > (signal.explanation.incoming as number) * 1.5) {
    suggestions.push({
      id: randomUUID(),
      kind: "strategy",
      value: "You initiate most of this thread. Wait for a reply before another chase, or switch channel.",
      confidence: 0.6,
      reason: "Outgoing messages outpace incoming ones.",
      evidence: [`Outgoing ${(signal.explanation.outgoing as number)}, incoming ${(signal.explanation.incoming as number)}.`],
    });
  }
  if (mode) {
    suggestions.push({
      id: randomUUID(),
      kind: "mode",
      field: "relationship",
      value: mode === "business" ? "Colleague" : mode === "personal" ? "Friend" : "Mixed",
      confidence: 0.55,
      reason: `Message tone reads as ${mode}.`,
      evidence: [],
      mode,
    });
  }
  return suggestions;
}

async function llmBriefing(
  name: string,
  signal: ReturnType<typeof calculateRelationshipSignals>,
  themes: { label: string; evidence: string[] }[],
  mode: RelationshipMode | null,
  bodies: string[],
  abort?: AbortSignal,
): Promise<{ briefing: string; provider: string; degraded: boolean; note?: string }> {
  const fallback = () => {
    const themeText = themes.length ? themes.map((theme) => theme.label).join(", ") : "no clear themes";
    return {
      briefing: `${name}: ${signal.explanation.interactions} interactions across ${(signal.explanation.channels as string[]).join(", ") || "no channel"}. Cadence gap ~${signal.explanation.typicalCadenceDays || "—"} days; last contact ${signal.explanation.daysSinceContact} days ago. Themes: ${themeText}. Mode looks ${mode || "unclear"}.`,
      provider: "signals",
      degraded: true,
      note: "Hosted model unavailable — showing deterministic signals only.",
    };
  };
  const settings = await getAskWriterSettings();
  if (settings.writer === "local" || !settings.hasKey) return fallback();
  const writer = settings.writer as CloudWriter;
  if (!isOpenAiCompatible(writer)) return fallback();
  const apiKey = await getAskWriterKey(settings.writer);
  if (!apiKey) return fallback();
  const model = settings.model || defaultCloudModel(writer);
  try {
    const result = await generateCloudStructured<{ briefing: string }>({
      writer,
      model,
      apiKey,
      system: "You summarize relationship messaging patterns. Cite only the evidence provided. Never invent protected traits (health, religion, politics, ethnicity, sexuality). Keep the briefing under 80 words.",
      prompt: JSON.stringify({
        name,
        signals: signal,
        themes,
        mode,
        excerpts: bodies.slice(0, 12),
      }),
      jsonSchema: {
        type: "object",
        properties: { briefing: { type: "string" } },
        required: ["briefing"],
      },
      signal: abort,
      validate: (value): value is { briefing: string } =>
        Boolean(value && typeof value === "object" && typeof (value as { briefing?: unknown }).briefing === "string"),
    });
    return { briefing: result.briefing, provider: `${writer}:${model}`, degraded: false };
  } catch (error) {
    if (error instanceof CloudLlmError && error.code === "CANCELLED") throw error;
    const themeText = themes.length ? themes.map((theme) => theme.label).join(", ") : "no clear themes";
    return {
      briefing: `${name}: ${signal.explanation.interactions} interactions. Themes: ${themeText}. Mode looks ${mode || "unclear"}.`,
      provider: "signals",
      degraded: true,
      note: error instanceof Error ? error.message : "Model briefing failed",
    };
  }
}

export async function generateRelationshipInsights(
  personId: string,
  signal?: AbortSignal,
): Promise<RelationshipInsight> {
  assertActive(signal);
  const person = getPerson(personId) as Record<string, unknown> | null;
  if (!person) throw new Error("Person not found");
  const signals = calculateRelationshipSignals(personId);
  assertActive(signal);
  const page = getPersonCommunications(personId, { limit: 120 });
  const bodies = (page.items || [])
    .map((row: { body?: string }) => String(row.body || "").trim())
    .filter(Boolean);
  const channels = (signals.explanation.channels as string[]) || [];
  const { mode, evidence: modeEvidence } = classifyMode(bodies, channels);
  const themes = detectThemes(bodies);
  const suggestions = [
    ...categorySuggestions(person, bodies),
    ...strategySuggestions(signals, themes, mode),
  ];
  if (modeEvidence.length) {
    const modeSuggestion = suggestions.find((item) => item.kind === "mode");
    if (modeSuggestion) modeSuggestion.evidence = modeEvidence;
  }
  assertActive(signal);
  const llm = await llmBriefing(String(person.name || "This person"), signals, themes, mode, bodies, signal);
  // Persist suggestions as pending inference rows so accept/reject works.
  const timestamp = new Date().toISOString();
  for (const suggestion of suggestions) {
    if (!suggestion.field || suggestion.kind === "strategy") continue;
    const id = suggestion.id || randomUUID();
    suggestion.id = id;
    db.prepare(`
      INSERT OR IGNORE INTO inference_suggestions
        (id, person_id, field_name, proposed_value_json, current_value_json, evidence_json,
         rationale, confidence, model, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      id,
      personId,
      suggestion.field,
      JSON.stringify(suggestion.value),
      JSON.stringify(person[suggestion.field] ?? null),
      JSON.stringify(suggestion.evidence.map((excerpt) => ({ sourceType: "communication", excerpt }))),
      suggestion.reason,
      suggestion.confidence,
      "message-insights",
      timestamp,
    );
  }
  return {
    personId,
    generatedAt: timestamp,
    provider: llm.provider,
    degraded: llm.degraded,
    note: llm.note,
    briefing: llm.briefing,
    pattern: {
      recency: signals.recency,
      cadenceDrift: signals.cadenceDrift,
      reciprocity: signals.reciprocity,
      channelDiversity: signals.channelDiversity,
      interactionFrequency: signals.interactionFrequency,
      interactions: Number(signals.explanation.interactions || 0),
      channels,
      daysSinceContact: Number(signals.explanation.daysSinceContact || 0),
      typicalCadenceDays: Number(signals.explanation.typicalCadenceDays || 0),
      incoming: Number(signals.explanation.incoming || 0),
      outgoing: Number(signals.explanation.outgoing || 0),
    },
    themes,
    mode,
    suggestions,
  };
}
