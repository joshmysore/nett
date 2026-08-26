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
  evidenceFreshness,
  personEvidenceDocuments,
  personEvidenceIndexState,
  refreshEvidenceIndex,
  refreshPersonEvidenceIndex,
  type EvidenceDocument,
  type EvidenceIndexState
} from "./evidence-index.js";
import {
  askCitations,
  askEvidenceBlocks,
  embedQueryText,
  formatAskAnswer,
  ftsQuery,
  loadEmbeddableDocuments,
  parseAskIntent,
  reciprocalRankFusion,
  retrieveAskMatches,
  retrievalPathNote,
  scoreEmbeddedRows,
  type AskAbilityId,
} from "./ask.js";
import {
  defaultCloudModel,
  getAskWriterKey,
  getAskWriterSettings,
  remoteEmbedModel,
  type AskWriterId,
} from "./ask-writer.js";
import {
  answerWithCloud,
  askSystemPrompt,
  cloudStreamPrompt,
  embedCloud,
  generateCloudStructured,
  isOpenAiCompatible,
  streamCloudGenerate,
  type CloudWriter,
} from "./cloud-llm.js";
import {
  packEvidenceWithBrief,
  upsertWorkingBrief,
  workingBriefSystemPrompt,
  workingBriefUserPrompt,
  type EvidenceBlock,
} from "./working-brief.js";
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

function asCloudWriter(writer: AskWriterId): CloudWriter | null {
  return writer === "openrouter" ? "openrouter" : null;
}

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
  const documents = new Map<string, EvidenceDocument>();
  const lexicalIds: string[] = [];
  for (const row of lexical) {
    documents.set(row.id, row);
    lexicalIds.push(row.id);
  }

  const vectorIds: string[] = [];
  if (!options.skipVector) {
    try {
      assertActive(options.signal);
      const settings = await getAskWriterSettings();
      const writer = asCloudWriter(settings.writer);
      const apiKey = writer ? await getAskWriterKey(settings.writer) : undefined;
      const embedModel = writer && apiKey ? remoteEmbedModel(settings.writer) : null;
      if (writer && apiKey && embedModel) {
        const intent = parseAskIntent(query);
        const [queryEmbedding] = await embedCloud({
          writer,
          model: embedModel,
          apiKey,
          input: [embedQueryText(intent)],
          signal: options.signal,
        });
        if (queryEmbedding?.length) {
          const compactQuery = queryEmbedding.slice(0, EMBEDDING_DIMENSIONS);
          const ranked = scoreEmbeddedRows(compactQuery, loadEmbeddableDocuments(), limit * 3);
          const hydrated = new Map(
            evidenceDocumentsByIds(ranked.map((item) => item.id)).map((row) => [row.id, row])
          );
          for (const item of ranked) {
            const row = hydrated.get(item.id);
            if (!row) continue;
            documents.set(row.id, row);
            vectorIds.push(row.id);
          }
        }
      }
    } catch {
      // Lexical retrieval remains fully functional when embeddings are unavailable.
    }
  }

  const fused = reciprocalRankFusion([lexicalIds, vectorIds]);
  const fallbackOrder = [...documents.keys()];
  return [...documents.values()]
    .map((row) => ({
      ...row,
      score: fused.get(row.id) ?? (1 / (60 + fallbackOrder.indexOf(row.id) + 1)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Hosted chat and embeddings. Local Ollama is not used. */
type ModelPick = {
  at: number;
  fast: string | null;
  reason: string | null;
  embed: string | null;
  writer: CloudWriter | null;
};
let cachedModelPick: ModelPick | null = null;
const MODEL_CACHE_MS = 60_000;

export function resetIntelligenceModelCache(): void {
  cachedModelPick = null;
}

async function resolveModels(): Promise<ModelPick> {
  if (cachedModelPick && Date.now() - cachedModelPick.at < MODEL_CACHE_MS) return cachedModelPick;
  const settings = await getAskWriterSettings();
  const writer = asCloudWriter(settings.writer);
  const model = writer && settings.hasKey
    ? (settings.model || defaultCloudModel(writer))
    : null;
  const pick: ModelPick = {
    at: Date.now(),
    fast: model,
    reason: model,
    embed: writer && settings.hasKey ? remoteEmbedModel(settings.writer) : null,
    writer,
  };
  cachedModelPick = pick;
  return pick;
}

async function selectedModel(): Promise<{ writer: CloudWriter; model: string; apiKey: string }> {
  const settings = await getAskWriterSettings();
  const writer = asCloudWriter(settings.writer);
  const apiKey = writer ? await getAskWriterKey(settings.writer) : undefined;
  if (!writer || !apiKey) throw new Error("No hosted Ask writer is configured");
  if (!isOpenAiCompatible(writer)) throw new Error("Structured generation needs OpenRouter or OpenAI");
  return { writer, model: settings.model || defaultCloudModel(writer), apiKey };
}

export async function intelligenceStatus() {
  const settings = await getAskWriterSettings();
  const pick = await resolveModels();
  const freshness = evidenceFreshness();
  return {
    ok: Boolean(settings.hasKey && settings.writer !== "local"),
    version: settings.writer,
    models: pick.fast ? [{ name: pick.fast }] : [],
    selectedModel: pick.fast ?? undefined,
    fastModel: pick.fast ?? undefined,
    reasonModel: pick.reason ?? undefined,
    embedModel: pick.embed ?? undefined,
    askWriter: settings.writer,
    askWriterModel: settings.model,
    askWriterHasKey: settings.hasKey,
    askWriterDisclosure: settings.disclosure,
    evidenceDocuments: (db.prepare("SELECT COUNT(*) AS count FROM evidence_documents").get() as { count: number }).count,
    embeddedDocuments: (db.prepare("SELECT COUNT(*) AS count FROM evidence_documents WHERE embedding_json IS NOT NULL").get() as { count: number }).count,
    indexedAt: freshness.indexedAt,
    communicationsAt: freshness.communicationsAt,
    interactionIndexedAt: freshness.interactionIndexedAt,
    stale: freshness.stale,
    staleSources: freshness.staleSources,
  };
}

export async function refreshEvidenceEmbeddings(limit = 250, options: { signal?: AbortSignal } = {}) {
  const settings = await getAskWriterSettings();
  const writer = asCloudWriter(settings.writer);
  const apiKey = writer ? await getAskWriterKey(settings.writer) : undefined;
  const embedModel = writer && apiKey ? remoteEmbedModel(settings.writer) : null;
  if (!writer || !apiKey || !embedModel) return { embedded: 0, model: null as string | null };
  const rows = db.prepare(`
    SELECT id, text FROM evidence_documents
    WHERE embedding_json IS NULL
      AND kind IN ('profile-field', 'memory', 'conversation-summary')
    ORDER BY updated_at DESC LIMIT ?
  `).all(Math.min(Math.max(limit, 1), 2_000)) as { id: string; text: string }[];
  const update = db.prepare("UPDATE evidence_documents SET embedding_json=?, updated_at=? WHERE id=?");
  let embedded = 0;
  for (let offset = 0; offset < rows.length; offset += 32) {
    if (options.signal?.aborted) break;
    const batch = rows.slice(offset, offset + 32);
    const vectors = await embedCloud({
      writer,
      model: embedModel,
      apiKey,
      input: batch.map((row) => row.text.slice(0, 4_000)),
      signal: options.signal,
    });
    db.transaction(() => {
      batch.forEach((row, index) => {
        const compact = (vectors[index] ?? []).slice(0, EMBEDDING_DIMENSIONS);
        update.run(JSON.stringify(compact), new Date().toISOString(), row.id);
        embedded++;
      });
    })();
  }
  return { embedded, model: embedModel };
}

type AskAnswer = {
  answer: string;
  citations: IntelligenceCitation[];
  provider: string;
  note?: string;
};

export type AskStreamEvent =
  | { type: "stage"; id: string; label: string; detail?: string }
  | {
    type: "meta";
    path: string;
    provider: string;
    citations: IntelligenceCitation[];
    note?: string;
    evidence?: Array<{ id: string; title: string; text: string }>;
  }
  | { type: "token"; text: string }
  | { type: "reset" }
  | { type: "done"; answer: string; citations: IntelligenceCitation[]; provider: string; note?: string };

function hasAskEvidence(retrieval: Awaited<ReturnType<typeof retrieveAskMatches>>): boolean {
  return retrieval.people.length > 0 || retrieval.groups.length > 0;
}

function mapModelCitations(
  retrieval: Awaited<ReturnType<typeof retrieveAskMatches>>,
  generated: { citations: Array<{ evidenceId: string; quote?: string }> },
  fallback: IntelligenceCitation[],
): IntelligenceCitation[] {
  const byId = new Map(retrieval.people.map((person) => [person.personId, person]));
  const mapped = generated.citations.flatMap((citation): IntelligenceCitation[] => {
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
      evidenceId: match?.evidenceId || citation.evidenceId,
    }];
  });
  return mapped.length ? mapped : fallback;
}

export type AskQueryOptions = {
  signal?: AbortSignal;
  personIds?: readonly string[];
  ability?: AskAbilityId | null;
  contextPersonIds?: readonly string[];
};

async function retrieveForAsk(question: string, options: AskQueryOptions = {}) {
  const settings = await getAskWriterSettings();
  const writer = asCloudWriter(settings.writer);
  const apiKey = writer ? await getAskWriterKey(settings.writer) : undefined;
  const embedModel = writer && apiKey ? remoteEmbedModel(settings.writer) : null;
  const retrieval = await retrieveAskMatches(question, {
    signal: options.signal,
    personIds: options.personIds,
    ability: options.ability,
    contextPersonIds: options.contextPersonIds,
    embedQuery: writer && apiKey && embedModel
      ? async (text, signal) => {
        try {
          const [vector] = await embedCloud({
            writer,
            model: embedModel,
            apiKey,
            input: [text],
            signal,
          });
          return vector?.length ? vector.slice(0, EMBEDDING_DIMENSIONS) : null;
        } catch {
          return null;
        }
      }
      : undefined,
  });
  return { retrieval, citations: askCitations(retrieval), note: retrievalPathNote(retrieval) };
}

function emptyAskAnswer(retrieval: Awaited<ReturnType<typeof retrieveAskMatches>>): AskAnswer {
  if (retrieval.groups.length) {
    return {
      answer: formatAskAnswer(retrieval),
      citations: askCitations(retrieval),
      provider: retrieval.provider,
      note: retrievalPathNote(retrieval),
    };
  }
  return {
    answer: "Nothing stored in people, notes, messages, or email matched that question.",
    citations: [],
    provider: "local-evidence",
  };
}

async function writeWithCloud(
  question: string,
  retrieval: Awaited<ReturnType<typeof retrieveAskMatches>>,
  fallback: IntelligenceCitation[],
  signal?: AbortSignal,
): Promise<AskAnswer | null> {
  const settings = await getAskWriterSettings();
  const writer = asCloudWriter(settings.writer);
  if (!writer || !settings.hasKey) return null;
  const apiKey = await getAskWriterKey(settings.writer);
  if (!apiKey) return null;
  const model = settings.model || defaultCloudModel(writer);
  const packed = packAskEvidence(retrieval);
  const generated = await answerWithCloud({
    writer,
    model,
    apiKey,
    system: askSystemPrompt(),
    prompt: cloudStreamPrompt(question, packed.evidence),
    question,
    evidence: packed.evidence,
    signal,
  });
  if (!packed.reused) {
    await refreshWorkingBriefs({
      retrieval,
      fullEvidence: packed.fullEvidence,
      fingerprint: packed.fingerprint,
      writer,
      model,
      apiKey,
      question,
      signal,
    }).catch(() => undefined);
  }
  return {
    answer: generated.answer,
    citations: mapModelCitations(retrieval, generated, fallback),
    provider: `${writer}:${generated.model}`,
    note: packed.reused
      ? `${settings.disclosure} Reused working brief for ${packed.personName}.`
      : settings.disclosure,
  };
}

function packAskEvidence(retrieval: Awaited<ReturnType<typeof retrieveAskMatches>>): {
  evidence: EvidenceBlock[];
  fullEvidence: EvidenceBlock[];
  reused: boolean;
  fingerprint: string;
  personId: string | null;
  personName: string | null;
} {
  const fullEvidence = askEvidenceBlocks(retrieval);
  if (retrieval.people.length !== 1) {
    return {
      evidence: fullEvidence,
      fullEvidence,
      reused: false,
      fingerprint: "",
      personId: null,
      personName: null,
    };
  }
  const person = retrieval.people[0];
  const packed = packEvidenceWithBrief(person.personId, person.name, fullEvidence);
  return {
    evidence: packed.blocks,
    fullEvidence,
    reused: packed.reused,
    fingerprint: packed.fingerprint,
    personId: person.personId,
    personName: person.name,
  };
}

async function refreshWorkingBriefs(options: {
  retrieval: Awaited<ReturnType<typeof retrieveAskMatches>>;
  fullEvidence: EvidenceBlock[];
  fingerprint: string;
  writer: CloudWriter;
  model: string;
  apiKey: string;
  question: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (options.retrieval.people.length !== 1) return;
  const person = options.retrieval.people[0];
  const fingerprint = options.fingerprint
    || packEvidenceWithBrief(person.personId, person.name, options.fullEvidence).fingerprint;
  const generated = await answerWithCloud({
    writer: options.writer,
    model: options.model,
    apiKey: options.apiKey,
    system: workingBriefSystemPrompt(),
    prompt: workingBriefUserPrompt(person.name, options.fullEvidence),
    question: `Standing working brief for ${person.name}`,
    evidence: options.fullEvidence,
    signal: options.signal,
  });
  if (!generated.answer.trim()) return;
  upsertWorkingBrief({
    personId: person.personId,
    body: generated.answer.trim(),
    evidenceFingerprint: fingerprint,
    evidenceIds: options.fullEvidence.map((block) => block.id),
    model: generated.model || options.model,
    provider: `${options.writer}:${generated.model || options.model}`,
    sourceQuestion: options.question,
  });
}

export async function answerRelationshipQuestion(question: string, options: AskQueryOptions = {}): Promise<AskAnswer> {
  const { retrieval, citations, note } = await retrieveForAsk(question, options);
  if (!hasAskEvidence(retrieval)) return emptyAskAnswer(retrieval);

  let cloud: AskAnswer | null = null;
  try {
    cloud = await writeWithCloud(question, retrieval, citations, options.signal);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const settings = await getAskWriterSettings();
    if (settings.writer !== "local" && settings.hasKey) {
      const message = error instanceof Error ? error.message : "OpenRouter did not return an answer";
      return {
        answer: `Ask retrieved matching records but could not write with OpenRouter. ${message}`,
        citations,
        provider: `${settings.writer}:error`,
        note: message,
      };
    }
  }
  if (cloud) return cloud;
  return { answer: formatAskAnswer(retrieval), citations, provider: retrieval.provider, note };
}

function matchStage(retrieval: Awaited<ReturnType<typeof retrieveAskMatches>>): { label: string; detail?: string } {
  if (retrieval.people.length === 1) {
    return {
      label: `Found ${retrieval.people[0].name}`,
      detail: retrieval.nameNote,
    };
  }
  if (retrieval.people.length > 1) {
    return {
      label: `Matched ${retrieval.people.length} people`,
      detail: retrieval.people.map((person) => person.name).slice(0, 4).join(", "),
    };
  }
  if (retrieval.groups.length) {
    return { label: `Found ${retrieval.groups.length} group chats` };
  }
  return { label: "No matching people" };
}

function recordsStage(retrieval: Awaited<ReturnType<typeof retrieveAskMatches>>): string {
  const messages = retrieval.people.reduce(
    (count, person) => count + person.matches.filter((match) => match.field === "conversation" || match.field === "group").length,
    0,
  );
  const groups = retrieval.groups.length;
  const parts = [
    retrieval.people.length ? "profile" : "",
    messages ? `${messages} message${messages === 1 ? "" : "s"}` : "",
    groups ? `${groups} group${groups === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? `Loading ${parts.join(" · ")}` : "Loading stored records";
}

export async function* streamRelationshipQuestion(
  question: string,
  options: AskQueryOptions = {},
): AsyncGenerator<AskStreamEvent> {
  yield { type: "stage", id: "extract", label: "Reading the question" };
  const { retrieval, citations, note } = await retrieveForAsk(question, options);
  const named = retrieval.intent.namedPerson || retrieval.people[0]?.name;
  yield {
    type: "stage",
    id: "search",
    label: named ? `Looking for ${named}` : "Searching records",
  };
  const matched = matchStage(retrieval);
  yield {
    type: "stage",
    id: "match",
    label: matched.label,
    detail: matched.detail,
  };
  if (!hasAskEvidence(retrieval)) {
    const empty = emptyAskAnswer(retrieval);
    yield { type: "done", answer: empty.answer, citations: empty.citations, provider: empty.provider };
    return;
  }
  yield { type: "stage", id: "records", label: recordsStage(retrieval) };
  const packed = packAskEvidence(retrieval);
  const evidence = packed.evidence;

  const settings = await getAskWriterSettings();
  const writer = asCloudWriter(settings.writer);
  if (writer && settings.hasKey) {
    const apiKey = await getAskWriterKey(settings.writer);
    const model = settings.model || defaultCloudModel(writer);
    if (apiKey) {
      const cloudNote = packed.reused && packed.personName
        ? `${settings.disclosure} Reused working brief for ${packed.personName}.`
        : settings.disclosure;
      yield {
        type: "stage",
        id: "write",
        label: packed.reused
          ? `Writing with ${model} · working brief`
          : `Writing with ${model}`,
        detail: `${evidence.length} block${evidence.length === 1 ? "" : "s"}${packed.reused ? " (brief + deltas)" : ""} · ${settings.disclosure}`,
      };
      yield {
        type: "meta",
        path: packed.reused ? "cloud-brief" : "cloud",
        provider: `${writer}:${model}`,
        citations,
        note: cloudNote,
        evidence,
      };
      try {
        let collected = "";
        for await (const event of streamCloudGenerate({
          writer,
          model,
          apiKey,
          system: askSystemPrompt(),
          prompt: cloudStreamPrompt(question, evidence),
          signal: options.signal,
        })) {
          if (event.type === "token") {
            collected += event.text;
            yield { type: "token", text: event.text };
          }
        }
        if (!collected.trim()) {
          throw new Error(`${model} returned an empty answer`);
        }
        if (!packed.reused) {
          yield {
            type: "stage",
            id: "brief",
            label: packed.personName
              ? `Saving working brief for ${packed.personName}`
              : "Saving working brief",
          };
          await refreshWorkingBriefs({
            retrieval,
            fullEvidence: packed.fullEvidence,
            fingerprint: packed.fingerprint,
            writer,
            model,
            apiKey,
            question,
            signal: options.signal,
          }).catch(() => undefined);
        }
        yield {
          type: "done",
          answer: collected,
          citations,
          provider: `${writer}:${model}`,
          note: cloudNote,
        };
        return;
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : `${writer} did not return an answer`;
        yield {
          type: "stage",
          id: "write",
          label: "OpenRouter did not return an answer",
          detail: message,
        };
        yield {
          type: "done",
          answer: `Ask retrieved matching records but could not write with OpenRouter. ${message}`,
          citations,
          provider: `${writer}:error`,
          note: message,
        };
        return;
      }
    }
  }

  const answer = formatAskAnswer(retrieval);
  yield { type: "stage", id: "write", label: "Writing from stored records" };
  yield {
    type: "meta",
    path: "index",
    provider: retrieval.provider,
    citations,
    note,
    evidence: packed.fullEvidence,
  };
  yield { type: "done", answer, citations, provider: retrieval.provider, note };
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
  let provider: string | null = null;
  let modelUnavailable = false;

  if (generate && documents.length) {
    try {
      const remote = await selectedModel();
      model = remote.model;
      provider = `${remote.writer}:${remote.model}`;
      const result = await generateCloudStructured<{ suggestions: GeneratedSuggestion[] }>({
        writer: remote.writer,
        model: remote.model,
        apiKey: remote.apiKey,
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
          provider: `${remote.writer}:${model}`
        });
      }
    } catch (error) {
      if (signal?.aborted) throw new AutofillCancelled();
      modelUnavailable = true;
      model = null;
      provider = null;
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
    notes.push("The hosted model was not reachable, so these suggestions come from stored evidence only.");
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
    provider,
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
