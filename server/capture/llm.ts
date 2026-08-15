/** Optional local-model capture extract. Same proposal shape as regex extract.
 *  Regex wins on a field the model also proposed. Nothing writes. */

import { OllamaProvider } from "../intelligence/ollama.js";
import { extractCapture, type CaptureExtraction } from "./extract.js";
import type { CaptureField, CaptureProposal } from "../../src/lib/contracts.js";

const FIELDS: CaptureField[] = [
  "location", "hometown", "industry", "company", "job_title", "languages",
  "relationship", "how_met", "where_met", "when_met", "mutuals", "interests",
  "foods", "tags", "follow_up_date", "birthday",
];

const fieldSet = new Set<string>(FIELDS);

function sentenceAround(text: string, index: number) {
  let start = 0;
  let end = text.length;
  for (let i = index; i > 0; i -= 1) {
    if (/[.!?\n]/u.test(text[i - 1])) { start = i; break; }
  }
  for (let i = index; i < text.length; i += 1) {
    if (/[.!?\n]/u.test(text[i])) { end = i + 1; break; }
  }
  return { text: text.slice(start, end).trim(), start, end };
}

function mergeProposals(base: CaptureProposal[], extra: CaptureProposal[]): CaptureProposal[] {
  const seen = new Set(base.map((proposal) => proposal.field));
  const merged = [...base];
  for (const proposal of extra) {
    if (seen.has(proposal.field)) continue;
    seen.add(proposal.field);
    merged.push(proposal);
  }
  return merged;
}

export async function extractCaptureWithModel(
  transcript: string,
  options: { signal?: AbortSignal; today?: Date } = {},
): Promise<CaptureExtraction> {
  const deterministic = extractCapture(transcript, options.today);
  const ollama = new OllamaProvider();
  const health = await ollama.health().catch(() => ({ ok: false }));
  if (!health.ok) return deterministic;

  const models = await ollama.listModels(options.signal).catch(() => []);
  const chat = models.find((model) => /llama3\.2:3b|qwen2\.5:3b|phi3:mini|gemma2:2b/i.test(model.name))
    ?? models.find((model) => !/embed|minilm|nomic|mxbai/i.test(model.name));
  if (!chat) return deterministic;

  try {
    const generated = await ollama.generateStructured<{
      nameHint: string | null;
      proposals: Array<{ field: string; value: string; values?: string[]; evidence: string; confidence: number }>;
    }>({
      model: chat.name,
      signal: options.signal,
      system: [
        "Extract reviewable person-field operations from a private note.",
        "Only use facts stated in the text. Never infer health, politics, religion, sexuality, or ethnicity.",
        "Every proposal must quote an exact substring of the note as evidence.",
        "Return JSON only.",
      ].join(" "),
      prompt: `Note:\n${transcript}\n\nAllowed fields: ${FIELDS.join(", ")}`,
      jsonSchema: {
        type: "object",
        additionalProperties: false,
        required: ["nameHint", "proposals"],
        properties: {
          nameHint: { type: ["string", "null"] },
          proposals: {
            type: "array",
            maxItems: 12,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["field", "value", "evidence", "confidence"],
              properties: {
                field: { type: "string" },
                value: { type: "string" },
                values: { type: "array", items: { type: "string" } },
                evidence: { type: "string" },
                confidence: { type: "number" },
              },
            },
          },
        },
      },
      validate: (value): value is {
        nameHint: string | null;
        proposals: Array<{ field: string; value: string; values?: string[]; evidence: string; confidence: number }>;
      } => Boolean(value && typeof value === "object" && Array.isArray((value as { proposals?: unknown }).proposals)),
    });

    const extras: CaptureProposal[] = [];
    for (const item of generated.proposals) {
      if (!fieldSet.has(item.field) || !item.value.trim() || !item.evidence.trim()) continue;
      const index = transcript.indexOf(item.evidence);
      if (index < 0) continue;
      const span = sentenceAround(transcript, index);
      extras.push({
        field: item.field as CaptureField,
        value: item.value.trim(),
        values: item.values?.filter(Boolean),
        evidence: span.text,
        evidenceStart: span.start,
        evidenceEnd: span.end,
        confidence: Math.min(0.85, Math.max(0.2, Number(item.confidence) || 0.5)),
      });
    }

    return {
      transcript: deterministic.transcript,
      nameHint: deterministic.nameHint || generated.nameHint || null,
      proposals: mergeProposals(deterministic.proposals, extras),
    };
  } catch {
    return deterministic;
  }
}
