import { createHash, randomUUID } from "node:crypto";
import {
  autofillSuggestions,
  db,
  getPerson,
  getPersonCommunications,
  updatePerson
} from "../db.js";
import {
  evidenceDocumentsByIds,
  personEvidenceDocuments,
  personEvidenceIndexState,
  refreshEvidenceIndex,
  refreshPersonEvidenceIndex,
  type EvidenceDocument,
  type EvidenceIndexState
} from "./evidence-index.js";
import { OllamaProvider } from "./ollama.js";
import {
  askCitations,
  askEvidenceBlocks,
  formatAskAnswer,
  ftsQuery,
  retrieveAskMatches,
} from "./ask.js";
import { collectSharedContextSuggestions } from "./shared-context.js";
import { collectTraitSuggestions } from "./traits.js";

export { refreshEvidenceIndex, refreshPersonEvidenceIndex, personEvidenceIndexState };
export type { EvidenceDocument, EvidenceIndexState };

type IntelligenceCitation = {
  personId: string;
  label: string;
  field: string;
  value: string;
  source: string;
  evidenceId?: string;
};

const ollama = new OllamaProvider();

/**
 * Fields a suggestion may ever target.
 *
 * Gender and culture may be proposed from name tables / pronouns and require
 * explicit acceptance. `online_personality` is adjective lists mined from
 * stored messages. Offline `personality` stays user-typed only.
 */
const suggestibleFields = new Set([
  "hometown", "location", "industry", "company", "headline", "job_title", "spike", "languages",
  "skills", "interests", "foods", "gender", "culture", "online_personality", "relationship",
  "when_met", "where_met", "how_met", "institutions", "mutuals", "notes", "quick_memories",
  "follow_up_date", "relationship_strength", "priority", "warmth", "intro_potential", "tags",
]);

/** Never proposed by the model or deterministic paths — whatever asks for them. */
const forbiddenFields = new Set([
  "personality", "ethnicity", "race", "nationality", "religion",
  "religious_belief", "politics", "political_view", "political_affiliation", "health",
  "medical", "medical_condition", "disability", "sexuality", "sexual_orientation",
  "orientation", "marital_status", "pregnancy", "immigration_status", "citizenship",
  "criminal_record", "union_membership",
]);

const listFields = new Set([
  "hometown", "languages", "skills", "interests", "foods", "institutions", "mutuals",
  "online_personality", "tags",
]);
const numericFields = new Set(["relationship_strength", "priority", "warmth", "intro_potential"]);

/** Documents handed to the model, and the ceiling on the autofill read. */
const EVIDENCE_WINDOW = 40;
/** Embedded documents scored in memory by a single retrieval call. */
const VECTOR_CANDIDATE_LIMIT = 600;
const EMBEDDING_DIMENSIONS = 384;

export class AutofillCancelled extends Error {
  constructor() {
    super("Autofill was cancelled");
    this.name = "AbortError";
  }
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AutofillCancelled();
}

function parse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function cosine(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}


const evidenceColumns = "id, person_id, kind, source, source_record_id, text, occurred_at, metadata_json, embedding_json";
const joinedEvidenceColumns = "d.id, d.person_id, d.kind, d.source, d.source_record_id, d.text, d.occurred_at, d.metadata_json, d.embedding_json";

export async function searchEvidence(
  query: string,
  limit = 12,
  options: { signal?: AbortSignal; skipVector?: boolean } = {}
): Promise<Array<EvidenceDocument & { score: number }>> {
  const match = ftsQuery(query);
  const lexical = match
    ? db.prepare(`
      SELECT ${joinedEvidenceColumns}, bm25(evidence_fts) AS rank
      FROM evidence_fts
      JOIN evidence_documents d ON d.id=evidence_fts.document_id
      WHERE evidence_fts MATCH ?
      ORDER BY rank LIMIT ?
    `).all(match, Math.max(limit * 3, 24)) as Array<EvidenceDocument & { rank: number }>
    : [];
  const scores = new Map<string, number>();
  const documents = new Map<string, EvidenceDocument>();
  lexical.forEach((row, index) => {
    documents.set(row.id, row);
    scores.set(row.id, Math.max(scores.get(row.id) ?? 0, 1 - index / Math.max(lexical.length, 1)));
  });

  // Strong FTS hits are enough for Ask — skip embedding the question with a 14b chat model.
  const skipVector = options.skipVector || lexical.length >= Math.min(limit, 6);
  if (!skipVector) {
    try {
      assertActive(options.signal);
      const models = await resolveModels(options.signal);
      const embedModel = models.embed;
      if (embedModel) {
        const [queryEmbedding] = await ollama.embed(embedModel, [query], options.signal);
        if (queryEmbedding?.length) {
          const compactQuery = queryEmbedding.slice(0, EMBEDDING_DIMENSIONS);
          const candidates = db.prepare(`
            SELECT id, embedding_json FROM evidence_documents
            WHERE embedding_json IS NOT NULL
            ORDER BY updated_at DESC LIMIT ?
          `).all(Math.min(VECTOR_CANDIDATE_LIMIT, 200)) as { id: string; embedding_json: string }[];
          const ranked = candidates
            .map((row) => ({ id: row.id, score: cosine(compactQuery, parse<number[]>(row.embedding_json, [])) }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit * 2);
          const hydrated = new Map(
            evidenceDocumentsByIds(ranked.map((item) => item.id)).map((row) => [row.id, row])
          );
          for (const item of ranked) {
            const row = hydrated.get(item.id);
            if (!row) continue;
            documents.set(row.id, row);
            scores.set(row.id, (scores.get(row.id) ?? 0) * 0.6 + item.score * 0.4);
          }
        }
      }
    } catch {
      // Lexical retrieval remains fully functional when Ollama is unavailable.
    }
  }

  return [...documents.values()]
    .map((row) => ({ ...row, score: scores.get(row.id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Prefer small/fast chat models for Ask Nett. Override with NETT_OLLAMA_MODEL. */
const PREFERRED_CHAT_MODELS = [
  "llama3.2:3b",
  "llama3.2:1b",
  "qwen2.5:3b",
  "qwen3:8b",
  "qwen3.5:9b",
  "qwen3:14b",
];

const PREFERRED_EMBED_MODELS = [
  "nomic-embed-text",
  "nomic-embed-text:latest",
  "mxbai-embed-large",
  "all-minilm",
];

let cachedModelPick: { at: number; chat: string; embed: string | null } | null = null;
const MODEL_CACHE_MS = 60_000;

async function selectedModel(signal?: AbortSignal): Promise<string> {
  const models = await ollama.listModels(signal);
  const requested = process.env.NETT_OLLAMA_MODEL;
  if (requested && models.some((model) => model.name === requested)) return requested;
  for (const preferred of PREFERRED_CHAT_MODELS) {
    const hit = models.find((model) => model.name === preferred || model.name.startsWith(`${preferred}:`));
    if (hit) return hit.name;
  }
  return models.find((model) => !model.name.toLocaleLowerCase().includes("embed"))?.name
    ?? models[0]?.name
    ?? (() => { throw new Error("No Ollama model is installed"); })();
}

async function selectedEmbedModel(signal?: AbortSignal): Promise<string | null> {
  const models = await ollama.listModels(signal);
  for (const preferred of PREFERRED_EMBED_MODELS) {
    const hit = models.find((model) => model.name === preferred || model.name.startsWith(`${preferred.split(":")[0]}`));
    if (hit) return hit.name;
  }
  return null;
}

async function resolveModels(signal?: AbortSignal) {
  if (cachedModelPick && Date.now() - cachedModelPick.at < MODEL_CACHE_MS) return cachedModelPick;
  const chat = await selectedModel(signal);
  const embed = await selectedEmbedModel(signal);
  cachedModelPick = { at: Date.now(), chat, embed };
  return cachedModelPick;
}

export async function intelligenceStatus() {
  const health = await ollama.health();
  const models = health.ok ? await ollama.listModels().catch(() => []) : [];
  return {
    ...health,
    models,
    selectedModel: models.length ? await selectedModel().catch(() => undefined) : undefined,
    evidenceDocuments: (db.prepare("SELECT COUNT(*) AS count FROM evidence_documents").get() as { count: number }).count,
    embeddedDocuments: (db.prepare("SELECT COUNT(*) AS count FROM evidence_documents WHERE embedding_json IS NOT NULL").get() as { count: number }).count
  };
}

export async function refreshEvidenceEmbeddings(limit = 250, options: { signal?: AbortSignal } = {}) {
  const models = await resolveModels(options.signal);
  const model = models.embed || models.chat;
  const rows = db.prepare(`
    SELECT id, text FROM evidence_documents
    WHERE embedding_json IS NULL ORDER BY updated_at DESC LIMIT ?
  `).all(Math.min(Math.max(limit, 1), 2_000)) as { id: string; text: string }[];
  const update = db.prepare("UPDATE evidence_documents SET embedding_json=?, updated_at=? WHERE id=?");
  let embedded = 0;
  for (let offset = 0; offset < rows.length; offset += 32) {
    if (options.signal?.aborted) break;
    const batch = rows.slice(offset, offset + 32);
    const vectors = await ollama.embed(model, batch.map((row) => row.text.slice(0, 4_000)), options.signal);
    db.transaction(() => {
      batch.forEach((row, index) => {
        const compact = (vectors[index] ?? []).slice(0, EMBEDDING_DIMENSIONS);
        update.run(JSON.stringify(compact), new Date().toISOString(), row.id);
        embedded++;
      });
    })();
  }
  return { embedded, model };
}

export async function answerRelationshipQuestion(question: string, options: { signal?: AbortSignal } = {}): Promise<{
  answer: string;
  citations: IntelligenceCitation[];
  provider: string;
}> {
  const retrieval = retrieveAskMatches(question);
  const citations = askCitations(retrieval);
  if (!retrieval.people.length) {
    return {
      answer: "Nothing stored in people, notes, messages, or email matched that question.",
      citations: [],
      provider: "local-evidence",
    };
  }

  // Place-only lookups are a metadata index hit — skip the model wait.
  if (retrieval.provider === "local-people-index") {
    return { answer: formatAskAnswer(retrieval), citations, provider: retrieval.provider };
  }

  try {
    assertActive(options.signal);
    const { chat: model } = await resolveModels(options.signal);
    const generated = await ollama.answerWithCitations({
      model,
      question,
      signal: options.signal,
      evidence: askEvidenceBlocks(retrieval),
      system: [
        "You are Nett, a private local relationship assistant.",
        "Each evidence block is one person: profile fields plus excerpts from notes, messages, or email.",
        "Name people. Use only these records. If a constraint has no evidence, say so.",
        "Never invent facts or infer health, politics, religion, sexuality, or ethnicity.",
        "Answer in under 12 sentences.",
      ].join(" "),
    });
    const byId = new Map(retrieval.people.map((person) => [person.personId, person]));
    const modelCitations = generated.citations.flatMap((citation): IntelligenceCitation[] => {
      const person = byId.get(citation.evidenceId)
        || retrieval.people.find((item) => item.matches.some((match) => match.evidenceId === citation.evidenceId));
      if (!person) return [];
      const match = person.matches.find((item) => item.evidenceId === citation.evidenceId) ?? person.matches[0];
      return [{
        personId: person.personId,
        label: person.name,
        field: match?.field || "profile",
        value: citation.quote || match?.excerpt || person.location || person.name,
        source: match?.source || "nett",
        evidenceId: match?.evidenceId,
      }];
    });
    return {
      answer: generated.answer,
      citations: modelCitations.length ? modelCitations : citations,
      provider: `ollama:${model}`,
    };
  } catch {
    return { answer: formatAskAnswer(retrieval), citations, provider: retrieval.provider };
  }
}

export type SuggestionEvidence = {
  kind: "evidence-document" | "memory" | "provenance" | "derived-signal";
  documentId?: string;
  sourceType: string;
  sourceId: string;
  excerpt?: string;
  structured?: Record<string, unknown>;
  observedAt: string | null;
};

export type AutofillSuggestion = {
  id: string;
  personId: string;
  field: string;
  operation: "set" | "extend" | "replace";
  value: unknown;
  normalizedValue: unknown;
  existingValue: unknown;
  conflict: boolean;
  conflictNote: string | null;
  confidence: number;
  reason: string;
  source: string;
  sourceType: string;
  provider: string | null;
  evidence: SuggestionEvidence[];
  /** Retained for the existing client contract. */
  evidenceIds: string[];
  observedAt: string | null;
  generatedAt: string;
  status: "pending";
  accepted: boolean;
  rejected: boolean;
  personMatch: { personId: string; name: string; basis: "explicit-person"; confidence: number };
};

export type AutofillResult = {
  suggestions: AutofillSuggestion[];
  degraded: boolean;
  note?: string;
  model: string | null;
  provider: string | null;
  generatedAt: string;
  index: EvidenceIndexState;
};

export type AutofillOptions = {
  /** Abort the whole call: the model request is cancelled and no rows are written. */
  signal?: AbortSignal;
  /** Skip the local model and return evidence-backed deterministic suggestions only. */
  generate?: boolean;
  /**
   * Refresh this person's evidence index before reading it. Off by default:
   * indexing is an explicit or background concern, never an implicit cost of
   * asking for suggestions.
   */
  reindex?: boolean;
};

type GeneratedSuggestion = {
  field: string;
  value: unknown;
  confidence: number;
  rationale: string;
  evidenceIds: string[];
};

type Candidate = {
  field: string;
  value: unknown;
  confidence: number;
  reason: string;
  evidence: SuggestionEvidence[];
  provider: string | null;
};

const suggestionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value", "confidence", "rationale", "evidenceIds"],
        properties: {
          field: { type: "string", enum: [...suggestibleFields] },
          value: {},
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

const extractionSystemPrompt = [
  "Extract relationship facts only when a supplied evidence block states them explicitly.",
  "Every suggestion must cite the evidence ids it came from. Prefer returning nothing over an unsupported guess.",
  "You may propose gender only from clear pronouns or an explicit self-identification in evidence.",
  "You may propose culture only from an explicit self-identification in evidence — never guess ethnicity.",
  "You may propose online_personality as a short list of communication-style adjectives grounded in message tone.",
  "You may propose foods when messages or memories name specific foods or drinks.",
  "Never propose offline personality, health, medical status, disability, religion, political belief,",
  "sexuality, ethnicity, race, nationality, or immigration status. Absence of evidence is not evidence.",
].join(" ");

function isProposable(field: string): boolean {
  return suggestibleFields.has(field) && !forbiddenFields.has(field);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "number") return value === 0;
  return String(value).trim() === "";
}

function normalizeValue(field: string, value: unknown): unknown {
  if (listFields.has(field)) {
    const items = (Array.isArray(value) ? value : String(value ?? "").split(","))
      .map((item) => String(item).replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return [...new Map(items.map((item) => [item.toLocaleLowerCase(), item])).values()];
  }
  if (numericFields.has(field)) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : null;
  }
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    const normalize = (items: unknown[]) => items.map((item) => String(item).toLocaleLowerCase()).sort();
    return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
  }
  if (typeof left === "string" && typeof right === "string") {
    return left.toLocaleLowerCase() === right.toLocaleLowerCase();
  }
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * Decides how a proposal relates to what Nett already holds. A value that would
 * replace existing content is always marked as a conflict so the reviewer sees
 * both sides rather than discovering an overwrite afterwards.
 */
function compareWithExisting(field: string, proposed: unknown, existing: unknown): {
  operation: "set" | "extend" | "replace";
  conflict: boolean;
  conflictNote: string | null;
} | null {
  if (isEmptyValue(existing)) return { operation: "set", conflict: false, conflictNote: null };
  if (sameValue(proposed, existing)) return null;
  if (listFields.has(field) && Array.isArray(proposed) && Array.isArray(existing)) {
    const known = new Set(existing.map((item) => String(item).toLocaleLowerCase()));
    const keepsAll = existing.every((item) =>
      proposed.some((candidate) => String(candidate).toLocaleLowerCase() === String(item).toLocaleLowerCase()));
    const added = proposed.filter((item) => !known.has(String(item).toLocaleLowerCase()));
    if (!added.length) return null;
    if (keepsAll) return { operation: "extend", conflict: false, conflictNote: null };
    return {
      operation: "replace",
      conflict: true,
      conflictNote: `Nett already records ${existing.length} entries; this proposal would drop some of them.`
    };
  }
  return {
    operation: "replace",
    conflict: true,
    conflictNote: `Nett already records ${JSON.stringify(existing)} for ${field.replaceAll("_", " ")}.`
  };
}

function fingerprint(field: string, normalizedValue: unknown, evidence: readonly SuggestionEvidence[]): string {
  const keys = evidence.map((item) => `${item.kind}:${item.documentId ?? item.sourceId}`).sort();
  return createHash("sha256")
    .update(JSON.stringify([field, normalizedValue ?? null, keys]))
    .digest("hex");
}

/**
 * A suggestion the user already rejected must not come back unless something
 * new supports it, so the fingerprint covers the value *and* its evidence.
 * Rejected rows themselves are never deleted — they are local ranking signal.
 */
function rejectedFingerprints(personId: string): Set<string> {
  const rows = db.prepare(`
    SELECT field_name, proposed_value_json, evidence_json
    FROM inference_suggestions WHERE person_id=? AND status='rejected'
  `).all(personId) as { field_name: string; proposed_value_json: string; evidence_json: string }[];
  const result = new Set<string>();
  for (const row of rows) {
    const payload = parse<unknown>(row.evidence_json, []);
    if (payload && !Array.isArray(payload) && typeof payload === "object") {
      const stored = (payload as { fingerprint?: unknown }).fingerprint;
      if (typeof stored === "string") {
        result.add(stored);
        continue;
      }
    }
    // Rows written before suggestions carried a fingerprint, including those
    // from the LinkedIn archive importer, store a plain array of evidence ids.
    const ids = Array.isArray(payload) ? payload.map(String) : [];
    const value = normalizeValue(row.field_name, parse<unknown>(row.proposed_value_json, null));
    result.add(fingerprint(
      row.field_name,
      value,
      ids.map((id) => ({ kind: "evidence-document", documentId: id, sourceType: "unknown", sourceId: id, observedAt: null } as SuggestionEvidence))
    ));
  }
  return result;
}

/** Names previously rejected on a list field — suppress them even if the batch grows. */
function rejectedListItemKeys(personId: string, field: string): Set<string> {
  if (!listFields.has(field)) return new Set();
  const rows = db.prepare(`
    SELECT proposed_value_json, current_value_json
    FROM inference_suggestions
    WHERE person_id=? AND field_name=? AND status='rejected'
  `).all(personId, field) as { proposed_value_json: string; current_value_json: string }[];
  const keys = new Set<string>();
  for (const row of rows) {
    const proposed = normalizeValue(field, parse<unknown>(row.proposed_value_json, [])) as unknown[];
    const current = new Set(
      (normalizeValue(field, parse<unknown>(row.current_value_json, [])) as unknown[])
        .map((item) => String(item).toLocaleLowerCase()),
    );
    for (const item of proposed) {
      const key = String(item).toLocaleLowerCase();
      if (key && !current.has(key)) keys.add(key);
    }
  }
  return keys;
}

function documentEvidence(document: EvidenceDocument): SuggestionEvidence {
  return {
    kind: "evidence-document",
    documentId: document.id,
    sourceType: document.source,
    sourceId: document.source_record_id,
    excerpt: document.text.replace(/\s+/g, " ").slice(0, 400),
    observedAt: document.occurred_at
  };
}

/**
 * Ties each deterministic suggestion back to the row it actually came from.
 * Anything we cannot attribute is dropped rather than shipped with borrowed
 * evidence — the previous implementation attached whichever document happened
 * to be first, which made an unsupported proposal look sourced.
 */
function deterministicEvidence(
  person: Record<string, any>,
  item: { field: string; value: unknown; reason: string }
): SuggestionEvidence[] {
  const memories = (person.memories ?? []) as Record<string, any>[];
  const provenance = (person.provenance ?? []) as Record<string, any>[];
  const proposed = String(item.value ?? "").toLocaleLowerCase();

  if (item.field === "company" || item.field === "location") {
    const fact = provenance.find((row) =>
      row.field_name === item.field && String(row.field_value ?? "").toLocaleLowerCase() === proposed);
    return fact ? [{
      kind: "provenance",
      sourceType: String(fact.connector_id),
      sourceId: String(fact.id),
      excerpt: `${item.field.replaceAll("_", " ")}: ${fact.field_value}`,
      observedAt: fact.observed_at ?? null
    }] : [];
  }
  if (item.field === "hometown") {
    const institutions = Array.isArray(person.institutions) ? person.institutions : [];
    const matched = institutions.find((value: unknown) => {
      const text = String(value ?? "");
      return text && (item.reason.includes(text) || text.toLocaleLowerCase().includes(proposed.split(",")[0] || ""));
    });
    if (matched) {
      return [{
        kind: "derived-signal",
        sourceType: "education-inference",
        sourceId: `institution:${person.id}`,
        excerpt: `Institution: ${matched}`,
        structured: { institution: matched, proposedHometown: item.value },
        observedAt: null
      }];
    }
    const fact = provenance.find((row) => row.field_name === "institutions" || row.field_name === "hometown");
    return fact ? [{
      kind: "provenance",
      sourceType: String(fact.connector_id),
      sourceId: String(fact.id),
      excerpt: `${fact.field_name}: ${fact.field_value}`,
      observedAt: fact.observed_at ?? null
    }] : [{
      kind: "derived-signal",
      sourceType: "education-inference",
      sourceId: `hometown:${person.id}`,
      excerpt: item.reason,
      observedAt: null
    }];
  }
  if (item.field === "quick_memories") {
    const memory = memories.find((row) => String(row.raw_text ?? "").toLocaleLowerCase() === proposed);
    return memory ? [{
      kind: "memory",
      sourceType: String(memory.source),
      sourceId: String(memory.id),
      excerpt: String(memory.raw_text).replace(/\s+/g, " ").slice(0, 400),
      observedAt: memory.occurred_at ?? null
    }] : [];
  }
  if (item.field === "follow_up_date") {
    const memory = memories.find((row) => row.structured?.followUpDate === item.value);
    return memory ? [{
      kind: "memory",
      sourceType: String(memory.source),
      sourceId: String(memory.id),
      excerpt: String(memory.raw_text).replace(/\s+/g, " ").slice(0, 400),
      structured: { followUpDate: item.value },
      observedAt: memory.occurred_at ?? null
    }] : [];
  }
  if (item.field === "industry" || item.field === "interests") {
    // The deterministic industry rule matches a keyword rather than the label
    // it proposes, and reports that keyword in its reason. Cite the keyword,
    // otherwise a genuine match looks unsupported and gets dropped.
    const matched = /Matched relationship context:\s*(.+)$/.exec(item.reason)?.[1]?.trim();
    const terms = [
      ...(matched ? [matched] : []),
      ...(Array.isArray(item.value) ? item.value : [item.value])
    ].map((term) => String(term).toLocaleLowerCase());
    return memories
      .filter((row) => {
        const haystack = `${row.raw_text ?? ""} ${JSON.stringify(row.structured ?? {})}`.toLocaleLowerCase();
        return terms.some((term) => term && haystack.includes(term));
      })
      .slice(0, 3)
      .map((row) => ({
        kind: "memory" as const,
        sourceType: String(row.source),
        sourceId: String(row.id),
        excerpt: String(row.raw_text).replace(/\s+/g, " ").slice(0, 400),
        observedAt: row.occurred_at ?? null
      }));
  }
  if (item.field === "relationship_strength") {
    const interactions = (person.interactions ?? []) as Record<string, any>[];
    return interactions.length ? [{
      kind: "derived-signal",
      sourceType: "nett",
      sourceId: `interactions:${person.id}`,
      structured: {
        recentInteractions: interactions.length,
        mostRecent: interactions[0]?.occurred_at ?? null,
        connectors: [...new Set(interactions.map((row) => String(row.source_connector)))]
      },
      observedAt: interactions[0]?.occurred_at ?? null
    }] : [];
  }
  if (item.field === "warmth") {
    return person.last_contact ? [{
      kind: "derived-signal",
      sourceType: "nett",
      sourceId: `last-contact:${person.id}`,
      structured: { lastContact: person.last_contact },
      observedAt: person.last_contact
    }] : [];
  }
  if (item.field === "gender" || item.field === "culture") {
    const term = String((item as { evidenceTerms?: string[] }).evidenceTerms?.[0]
      || namePartsForEvidence(person)[0]
      || person.name
      || "").trim();
    if (!term) return [];
    return [{
      kind: "derived-signal",
      sourceType: "name-inference",
      sourceId: `name:${person.id}`,
      excerpt: `Name used for suggestion: ${term}`,
      structured: { field: item.field, nameToken: term },
      observedAt: null
    }];
  }
  if (item.field === "online_personality" || item.field === "foods") {
    const terms = (item as { evidenceTerms?: string[] }).evidenceTerms ?? [];
    if (!terms.length) return [];
    return terms.slice(0, 4).map((excerpt, index) => ({
      kind: "derived-signal" as const,
      sourceType: "messages",
      sourceId: `messages:${person.id}:${index}`,
      excerpt: String(excerpt).slice(0, 400),
      structured: { field: item.field },
      observedAt: null
    }));
  }
  return [];
}

function namePartsForEvidence(person: Record<string, any>) {
  const full = String(person.preferred_name || person.name || "").trim();
  return [person.first_name, person.last_name, ...full.split(/\s+/)].map((part) => String(part || "").trim()).filter(Boolean);
}

function buildSuggestion(
  person: Record<string, any>,
  candidate: Candidate,
  generatedAt: string
): AutofillSuggestion | null {
  if (!isProposable(candidate.field)) return null;
  if (!candidate.evidence.length) return null;
  const normalizedValue = normalizeValue(candidate.field, candidate.value);
  if (isEmptyValue(normalizedValue)) return null;
  const existingValue = person[candidate.field] ?? null;
  const comparison = compareWithExisting(candidate.field, normalizedValue, existingValue);
  if (!comparison) return null;
  const observedAt = candidate.evidence
    .map((item) => item.observedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  return {
    id: randomUUID(),
    personId: String(person.id),
    field: candidate.field,
    operation: comparison.operation,
    value: candidate.value,
    normalizedValue,
    existingValue,
    conflict: comparison.conflict,
    conflictNote: comparison.conflictNote,
    confidence: Math.max(0, Math.min(1, candidate.confidence)),
    reason: candidate.reason,
    source: [...new Set(candidate.evidence.map((item) => item.sourceType))].join(", ") || "nett",
    sourceType: candidate.evidence[0]?.kind ?? "derived-signal",
    provider: candidate.provider,
    evidence: candidate.evidence,
    evidenceIds: candidate.evidence.flatMap((item) => item.documentId ? [item.documentId] : []),
    observedAt,
    generatedAt,
    status: "pending",
    accepted: false,
    rejected: false,
    personMatch: {
      personId: String(person.id),
      name: String(person.name ?? ""),
      basis: "explicit-person",
      confidence: 1
    }
  };
}

export async function intelligentAutofill(
  personId: string,
  options: AutofillOptions = {}
): Promise<AutofillResult> {
  const { signal, generate = true, reindex = false } = options;
  const generatedAt = new Date().toISOString();
  const person = getPerson(personId) as Record<string, any> | null;
  if (!person) throw new Error("Person not found");
  assertActive(signal);

  // The index is a background concern. Autofill reads it, reports how fresh it
  // is, and only rebuilds when the caller explicitly asked for it.
  if (reindex) await refreshPersonEvidenceIndex(personId, { signal });
  assertActive(signal);
  const index = personEvidenceIndexState(personId, person.updated_at);
  const documents = personEvidenceDocuments(personId, EVIDENCE_WINDOW);
  assertActive(signal);

  const candidates: Candidate[] = [];
  let model: string | null = null;
  let modelUnavailable = false;

  if (generate && documents.length) {
    try {
      model = await selectedModel(signal);
      const result = await ollama.generateStructured<{ suggestions: GeneratedSuggestion[] }>({
        model,
        signal,
        jsonSchema: suggestionSchema,
        system: extractionSystemPrompt,
        prompt: [
          `Current profile:\n${JSON.stringify({
            name: person.name, company: person.company, headline: person.headline,
            job_title: person.job_title, industry: person.industry,
            location: person.location, hometown: person.hometown, interests: person.interests,
            skills: person.skills, institutions: person.institutions, relationship: person.relationship,
            how_met: person.how_met, where_met: person.where_met, notes: person.notes
          })}`,
          `Evidence:\n${documents.map((row) => `[${row.id}] ${row.text.slice(0, 1_200)}`).join("\n\n")}`
        ].join("\n\n"),
        validate: (value): value is { suggestions: GeneratedSuggestion[] } => {
          const candidate = value as { suggestions?: unknown };
          return Boolean(candidate && Array.isArray(candidate.suggestions));
        }
      });
      const byId = new Map(documents.map((row) => [row.id, row]));
      for (const suggestion of result.suggestions) {
        if (!isProposable(suggestion.field)) continue;
        if (!(suggestion.confidence >= 0.55)) continue;
        const cited = (suggestion.evidenceIds ?? []).flatMap((id) => {
          const document = byId.get(id);
          return document ? [documentEvidence(document)] : [];
        });
        // A citation the model invented is not evidence.
        if (!cited.length || cited.length !== (suggestion.evidenceIds ?? []).length) continue;
        candidates.push({
          field: suggestion.field,
          value: suggestion.value,
          confidence: suggestion.confidence,
          reason: suggestion.rationale,
          evidence: cited,
          provider: `ollama:${model}`
        });
      }
    } catch (error) {
      if (signal?.aborted) throw new AutofillCancelled();
      modelUnavailable = true;
      model = null;
    }
  }
  assertActive(signal);

  const modelFields = new Set(candidates.map((candidate) => candidate.field));
  for (const item of autofillSuggestions(personId)) {
    if (modelFields.has(item.field)) continue;
    const evidence = deterministicEvidence(person, item);
    if (!evidence.length) continue;
    candidates.push({
      field: item.field,
      value: item.value,
      confidence: item.confidence,
      reason: item.reason,
      evidence,
      provider: null
    });
  }
  assertActive(signal);

  // Name + message trait suggestions (gender, culture, online_personality, foods).
  const messageBodies = getPersonCommunications(personId, { limit: 120 }).items
    .filter((row) => row.direction === "incoming" && String(row.body || "").trim())
    .map((row) => String(row.body));
  for (const item of collectTraitSuggestions(person, messageBodies)) {
    if (modelFields.has(item.field) || !isProposable(item.field)) continue;
    const evidence = deterministicEvidence(person, item);
    if (!evidence.length) continue;
    candidates.push({
      field: item.field,
      value: item.value,
      confidence: item.confidence,
      reason: item.reason,
      evidence,
      provider: null
    });
  }
  assertActive(signal);

  // Shared place / school / company / reciprocal mutuals — local graph only.
  const claimedFields = new Set(candidates.map((candidate) => candidate.field));
  const rejectedMutualKeys = rejectedListItemKeys(personId, "mutuals");
  for (const item of collectSharedContextSuggestions(person, { rejectedMutualKeys })) {
    if (claimedFields.has(item.field) || !isProposable(item.field)) continue;
    if (!item.evidence.length) continue;
    candidates.push({
      field: item.field,
      value: item.value,
      confidence: item.confidence,
      reason: item.reason,
      evidence: item.evidence,
      provider: null
    });
    claimedFields.add(item.field);
  }
  assertActive(signal);

  const rejected = rejectedFingerprints(personId);
  const seenFields = new Set<string>();
  const suggestions: AutofillSuggestion[] = [];
  for (const candidate of candidates) {
    if (seenFields.has(candidate.field)) continue;
    const suggestion = buildSuggestion(person, candidate, generatedAt);
    if (!suggestion) continue;
    if (rejected.has(fingerprint(suggestion.field, suggestion.normalizedValue, suggestion.evidence))) continue;
    seenFields.add(candidate.field);
    suggestions.push(suggestion);
    if (suggestions.length >= 12) break;
  }
  assertActive(signal);

  persistSuggestions(personId, suggestions, generatedAt);

  const notes: string[] = [];
  if (modelUnavailable) {
    notes.push("The local model was not reachable, so these suggestions come from stored evidence only.");
  }
  if (index.stale) {
    notes.push(index.reason === "not-indexed"
      ? "Nett has not indexed this person's messages yet, so only profile and memory evidence was used. Refresh the evidence index to include conversations."
      : "This profile changed since the evidence index was last refreshed, so recent edits may not be reflected.");
  }
  if (!documents.length && !suggestions.length) {
    notes.push("There is no stored evidence for this person, so Nett has nothing to propose.");
  }

  return {
    suggestions,
    degraded: modelUnavailable || index.stale,
    note: notes.length ? notes.join(" ") : undefined,
    model,
    provider: model ? `ollama:${model}` : null,
    generatedAt,
    index
  };
}

function persistSuggestions(personId: string, suggestions: readonly AutofillSuggestion[], generatedAt: string): void {
  if (!suggestions.length) return;
  const supersede = db.prepare(
    "UPDATE inference_suggestions SET status='superseded', reviewed_at=? WHERE person_id=? AND field_name=? AND status='pending'"
  );
  const insert = db.prepare(`
    INSERT INTO inference_suggestions
      (id, person_id, field_name, proposed_value_json, current_value_json, evidence_json,
       rationale, confidence, model, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  db.transaction(() => {
    for (const suggestion of suggestions) {
      supersede.run(generatedAt, personId, suggestion.field);
      insert.run(
        suggestion.id,
        personId,
        suggestion.field,
        JSON.stringify(suggestion.value),
        JSON.stringify(suggestion.existingValue),
        JSON.stringify({
          version: 2,
          fingerprint: fingerprint(suggestion.field, suggestion.normalizedValue, suggestion.evidence),
          operation: suggestion.operation,
          normalizedValue: suggestion.normalizedValue,
          conflict: suggestion.conflict,
          conflictNote: suggestion.conflictNote,
          observedAt: suggestion.observedAt,
          provider: suggestion.provider,
          personMatch: suggestion.personMatch,
          evidence: suggestion.evidence,
          evidenceIds: suggestion.evidenceIds
        }),
        suggestion.reason,
        suggestion.confidence,
        suggestion.provider ?? "deterministic",
        generatedAt
      );
    }
  })();
}

function evidenceSourcePattern(evidenceJson: string): string {
  const payload = parse<unknown>(evidenceJson, []);
  if (Array.isArray(payload)) {
    return payload.map((id) => String(id).split(":")[0]).join(",");
  }
  const evidence = (payload as { evidence?: SuggestionEvidence[] }).evidence ?? [];
  return [...new Set(evidence.map((item) => item.sourceType))].join(",");
}

export function reviewInferenceSuggestion(id: string, decision: "accepted" | "rejected", apply = false) {
  const row = db.prepare("SELECT * FROM inference_suggestions WHERE id=?").get(id) as Record<string, any> | undefined;
  if (!row) throw new Error("Suggestion not found");
  if (!["pending", "superseded"].includes(row.status)) throw new Error("Suggestion was already reviewed");
  if (forbiddenFields.has(row.field_name)) throw new Error("This field cannot be written by inference");
  const value = parse(row.proposed_value_json, null);
  db.transaction(() => {
    db.prepare("UPDATE inference_suggestions SET status=?, reviewed_at=? WHERE id=?")
      .run(decision, new Date().toISOString(), id);
    db.prepare(`
      INSERT INTO inference_feedback
        (id, suggestion_id, person_id, field_name, decision, source_pattern, created_at,
         original_value_json, final_value_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), id, row.person_id, row.field_name, decision,
      evidenceSourcePattern(row.evidence_json),
      new Date().toISOString(),
      row.current_value_json ?? null,
      decision === "accepted" && apply ? row.proposed_value_json : null
    );
    if (decision === "accepted" && apply) updatePerson(row.person_id, { [row.field_name]: value });
  })();
  return { id, decision, applied: decision === "accepted" && apply };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function calculateRelationshipSignals(personId: string) {
  const rows = db.prepare(`
    SELECT c.connector_id, c.direction, c.occurred_at
    FROM communications c JOIN communication_people cp ON cp.communication_id=c.id
    WHERE cp.person_id=? ORDER BY c.occurred_at DESC
  `).all(personId) as { connector_id: string; direction: string; occurred_at: string }[];
  const dates = rows.map((row) => Date.parse(row.occurred_at)).filter(Number.isFinite);
  const gaps = dates.slice(0, -1).map((value, index) => Math.max(0, (value - dates[index + 1]) / 86400000));
  const typicalGap = median(gaps);
  const currentGap = dates[0] ? Math.max(0, (Date.now() - dates[0]) / 86400000) : 365;
  const cadenceDrift = typicalGap ? Math.max(0, Math.min(100, (currentGap / typicalGap - 1) * 50)) : 0;
  const incoming = rows.filter((row) => row.direction === "incoming").length;
  const outgoing = rows.filter((row) => row.direction === "outgoing").length;
  const reciprocity = incoming + outgoing
    ? Math.round((1 - Math.abs(incoming - outgoing) / (incoming + outgoing)) * 100)
    : 0;
  const channels = new Set(rows.map((row) => row.connector_id));
  const recency = Math.max(0, Math.round(100 - currentGap * 1.1));
  const frequency = Math.min(100, Math.round(rows.filter((row) => Date.parse(row.occurred_at) > Date.now() - 180 * 86400000).length * 4));
  const signal = {
    personId,
    calculatedAt: new Date().toISOString(),
    recency,
    cadenceDrift: Math.round(cadenceDrift),
    reciprocity,
    channelDiversity: Math.min(100, channels.size * 25),
    interactionFrequency: frequency,
    explanation: {
      interactions: rows.length,
      channels: [...channels],
      daysSinceContact: Math.round(currentGap),
      typicalCadenceDays: Math.round(typicalGap),
      incoming,
      outgoing
    }
  };
  db.prepare(`
    INSERT INTO relationship_signal_snapshots
      (id, person_id, calculated_at, recency, cadence_drift, reciprocity,
       channel_diversity, interaction_frequency, explanation_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(), personId, signal.calculatedAt, signal.recency, signal.cadenceDrift,
    signal.reciprocity, signal.channelDiversity, signal.interactionFrequency,
    JSON.stringify(signal.explanation)
  );
  return signal;
}
