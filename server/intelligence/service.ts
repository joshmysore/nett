import { randomUUID } from "node:crypto";
import {
  autofillSuggestions,
  db,
  getPerson,
  updatePerson
} from "../db.js";
import { OllamaProvider } from "./ollama.js";

type EvidenceDocument = {
  id: string;
  person_id: string | null;
  kind: string;
  source: string;
  source_record_id: string;
  text: string;
  occurred_at: string | null;
  metadata_json: string;
  embedding_json: string | null;
};

type IntelligenceCitation = {
  personId: string;
  label: string;
  field: string;
  value: string;
  source: string;
  evidenceId?: string;
};

const ollama = new OllamaProvider();
const allowedFields = new Set([
  "hometown", "location", "industry", "company", "headline", "job_title", "spike", "languages", "skills",
  "interests", "culture", "personality", "relationship", "when_met", "where_met",
  "how_met", "institutions", "mutuals", "notes", "quick_memories", "follow_up_date",
  "relationship_strength", "priority", "warmth", "intro_potential"
]);
const listFields = new Set(["languages", "skills", "interests", "institutions", "mutuals"]);

function parse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function text(value: unknown): string {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value ?? "").trim();
}

function addDocument(
  row: Omit<EvidenceDocument, "metadata_json" | "embedding_json"> & { metadata?: Record<string, unknown> }
): void {
  const timestamp = new Date().toISOString();
  db.prepare(`
    INSERT INTO evidence_documents
      (id, person_id, kind, source, source_record_id, text, occurred_at, metadata_json, embedding_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
      person_id=excluded.person_id,
      kind=excluded.kind,
      source=excluded.source,
      source_record_id=excluded.source_record_id,
      text=excluded.text,
      occurred_at=excluded.occurred_at,
      metadata_json=excluded.metadata_json,
      embedding_json=CASE WHEN evidence_documents.text=excluded.text THEN evidence_documents.embedding_json ELSE NULL END,
      updated_at=excluded.updated_at
  `).run(
    row.id,
    row.person_id,
    row.kind,
    row.source,
    row.source_record_id,
    row.text,
    row.occurred_at,
    JSON.stringify(row.metadata ?? {}),
    timestamp
  );
  db.prepare("DELETE FROM evidence_fts WHERE document_id=?").run(row.id);
  db.prepare(`
    INSERT INTO evidence_fts (document_id, person_id, source, kind, text)
    VALUES (?, ?, ?, ?, ?)
  `).run(row.id, row.person_id, row.source, row.kind, row.text);
  db.prepare("INSERT OR IGNORE INTO temp.evidence_seen (id) VALUES (?)").run(row.id);
}

export function refreshEvidenceIndex(personId?: string): { indexed: number } {
  let indexed = 0;
  db.transaction(() => {
    db.exec("CREATE TEMP TABLE IF NOT EXISTS evidence_seen (id TEXT PRIMARY KEY); DELETE FROM temp.evidence_seen;");

    const where = personId ? "WHERE p.id=?" : "";
    const profiles = db.prepare(`
      SELECT p.id, p.preferred_name, p.first_name, p.last_name, p.nickname,
        m.*, GROUP_CONCAT(DISTINCT t.name) AS tag_names
      FROM people p
      LEFT JOIN nett_metadata m ON m.person_id=p.id
      LEFT JOIN contact_tags ct ON ct.person_id=p.id
      LEFT JOIN tags t ON t.id=ct.tag_id
      ${where}
      GROUP BY p.id
    `).all(...(personId ? [personId] : [])) as Record<string, unknown>[];
    for (const profile of profiles) {
      const fields = [
        ["name", profile.preferred_name], ["nickname", profile.nickname],
        ["company", profile.company], ["industry", profile.industry],
        ["location", profile.location], ["hometown", profile.hometown],
        ["relationship", profile.relationship], ["how met", profile.how_met],
        ["where met", profile.where_met], ["when met", profile.when_met],
        ["interests", parse(String(profile.interests || ""), [])],
        ["skills", parse(String(profile.skills || ""), [])],
        ["institutions", parse(String(profile.institutions || ""), [])],
        ["mutuals", parse(String(profile.mutuals || ""), [])],
        ["tags", profile.tag_names], ["notes", profile.notes],
        ["memory summary", profile.quick_memories]
      ].filter(([, value]) => text(value));
      addDocument({
        id: `profile:${profile.id}`,
        person_id: String(profile.id),
        kind: "profile-field",
        source: "nett",
        source_record_id: String(profile.id),
        text: fields.map(([label, value]) => `${label}: ${text(value)}`).join("\n"),
        occurred_at: String(profile.updated_at || profile.created_at || ""),
        metadata: { name: profile.preferred_name }
      });
      indexed++;
    }

    const memories = db.prepare(`
      SELECT mm.* FROM memories mm
      ${personId ? "WHERE mm.person_id=?" : ""}
    `).all(...(personId ? [personId] : [])) as Record<string, unknown>[];
    for (const memory of memories) {
      addDocument({
        id: `memory:${memory.id}`,
        person_id: String(memory.person_id),
        kind: "memory",
        source: String(memory.source),
        source_record_id: String(memory.id),
        text: String(memory.raw_text),
        occurred_at: String(memory.occurred_at),
        metadata: parse(String(memory.structured_json || "{}"), {})
      });
      indexed++;
    }

    const communications = db.prepare(`
      SELECT c.*, cp.person_id, p.preferred_name
      FROM communications c
      JOIN communication_people cp ON cp.communication_id=c.id
      JOIN people p ON p.id=cp.person_id
      ${personId ? "WHERE cp.person_id=?" : ""}
    `).all(...(personId ? [personId] : [])) as Record<string, unknown>[];
    for (const communication of communications) {
      const body = text(communication.body);
      if (!body) continue;
      addDocument({
        id: `communication:${communication.id}:${communication.person_id}`,
        person_id: String(communication.person_id),
        kind: "interaction",
        source: String(communication.connector_id),
        source_record_id: String(communication.external_id),
        text: [
          communication.direction ? `direction: ${communication.direction}` : "",
          body
        ].filter(Boolean).join("\n"),
        occurred_at: String(communication.occurred_at),
        metadata: parse(String(communication.evidence_json || "{}"), {})
      });
      indexed++;
    }

    const provenance = db.prepare(`
      SELECT fp.* FROM field_provenance fp
      ${personId ? "WHERE fp.person_id=?" : ""}
    `).all(...(personId ? [personId] : [])) as Record<string, unknown>[];
    for (const fact of provenance) {
      if (!text(fact.field_value)) continue;
      addDocument({
        id: `provenance:${fact.id}`,
        person_id: String(fact.person_id),
        kind: "profile-field",
        source: String(fact.connector_id),
        source_record_id: String(fact.source_record_id || fact.id),
        text: `${String(fact.field_name).replaceAll("_", " ")}: ${text(fact.field_value)}`,
        occurred_at: String(fact.observed_at),
        metadata: { field: fact.field_name, confidence: fact.confidence }
      });
      indexed++;
    }
    if (personId) {
      db.prepare(`
        DELETE FROM evidence_fts WHERE document_id IN (
          SELECT id FROM evidence_documents
          WHERE person_id=? AND id NOT IN (SELECT id FROM temp.evidence_seen)
        )
      `).run(personId);
      db.prepare(`
        DELETE FROM evidence_documents
        WHERE person_id=? AND id NOT IN (SELECT id FROM temp.evidence_seen)
      `).run(personId);
    } else {
      db.prepare(`
        DELETE FROM evidence_fts
        WHERE document_id NOT IN (SELECT id FROM temp.evidence_seen)
      `).run();
      db.prepare(`
        DELETE FROM evidence_documents
        WHERE id NOT IN (SELECT id FROM temp.evidence_seen)
      `).run();
    }
    db.prepare("DELETE FROM temp.evidence_seen").run();
  })();
  return { indexed };
}

function ftsQuery(query: string): string {
  return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}@._+-]{2,}/gu) ?? [])]
    .slice(0, 14)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(" OR ");
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

export async function searchEvidence(query: string, limit = 12): Promise<Array<EvidenceDocument & { score: number }>> {
  const match = ftsQuery(query);
  const lexical = match
    ? db.prepare(`
      SELECT d.*, bm25(evidence_fts) AS rank
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

  try {
    const model = await selectedModel();
    const [queryEmbedding] = await ollama.embed(model, [query]);
    const compactQuery = queryEmbedding.slice(0, 384);
    const vectorRows = db.prepare(`
      SELECT * FROM evidence_documents WHERE embedding_json IS NOT NULL
      ORDER BY updated_at DESC LIMIT 5000
    `).all() as EvidenceDocument[];
    const vector = vectorRows
      .map((row) => ({ row, score: cosine(compactQuery, parse<number[]>(row.embedding_json, [])) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit * 2);
    vector.forEach(({ row, score }) => {
      documents.set(row.id, row);
      scores.set(row.id, (scores.get(row.id) ?? 0) * 0.6 + Math.max(0, score) * 0.4);
    });
  } catch {
    // Lexical retrieval remains fully functional when Ollama is unavailable.
  }
  if (!documents.size) {
    const fallback = db.prepare(`
      SELECT * FROM evidence_documents
      ORDER BY COALESCE(occurred_at, updated_at) DESC LIMIT ?
    `).all(limit) as EvidenceDocument[];
    fallback.forEach((row, index) => {
      documents.set(row.id, row);
      scores.set(row.id, 1 - index / Math.max(fallback.length, 1));
    });
  }
  return [...documents.values()]
    .map((row) => ({ ...row, score: scores.get(row.id) ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

async function selectedModel(): Promise<string> {
  const models = await ollama.listModels();
  const requested = process.env.NETT_OLLAMA_MODEL;
  if (requested && models.some((model) => model.name === requested)) return requested;
  return models.find((model) => model.name === "llama3.2:3b")?.name
    ?? models.find((model) => !model.name.includes("embed"))?.name
    ?? models[0]?.name
    ?? (() => { throw new Error("No Ollama model is installed"); })();
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

export async function refreshEvidenceEmbeddings(limit = 250) {
  const model = await selectedModel();
  const rows = db.prepare(`
    SELECT id, text FROM evidence_documents
    WHERE embedding_json IS NULL ORDER BY updated_at DESC LIMIT ?
  `).all(Math.min(Math.max(limit, 1), 2_000)) as { id: string; text: string }[];
  const update = db.prepare("UPDATE evidence_documents SET embedding_json=?, updated_at=? WHERE id=?");
  let embedded = 0;
  for (let offset = 0; offset < rows.length; offset += 32) {
    const batch = rows.slice(offset, offset + 32);
    const vectors = await ollama.embed(model, batch.map((row) => row.text.slice(0, 4_000)));
    db.transaction(() => {
      batch.forEach((row, index) => {
        const compact = (vectors[index] ?? []).slice(0, 384);
        update.run(JSON.stringify(compact), new Date().toISOString(), row.id);
        embedded++;
      });
    })();
  }
  return { embedded, model };
}

export async function answerRelationshipQuestion(question: string): Promise<{
  answer: string;
  citations: IntelligenceCitation[];
  provider: string;
}> {
  const count = (db.prepare("SELECT COUNT(*) AS count FROM evidence_documents").get() as { count: number }).count;
  if (!count) refreshEvidenceIndex();
  const evidence = await searchEvidence(question, 14);
  if (!evidence.length) {
    return { answer: "I could not find local evidence for that question.", citations: [], provider: "local-evidence" };
  }
  const people = new Map<string, { name: string }>();
  for (const row of evidence) {
    if (!row.person_id || people.has(row.person_id)) continue;
    const person = getPerson(row.person_id) as { name: string } | null;
    if (person) people.set(row.person_id, person);
  }
  try {
    const model = await selectedModel();
    const generated = await ollama.answerWithCitations({
      model,
      question,
      evidence: evidence.map((row) => ({
        id: row.id,
        title: `${people.get(row.person_id || "")?.name || "Network evidence"} · ${row.source}`,
        text: row.text.slice(0, 2_000)
      })),
      system: "You are Nett, a private local relationship intelligence assistant. Be concise, useful, and explicit about uncertainty. Never invent facts."
    });
    const citations = generated.citations.flatMap((citation): IntelligenceCitation[] => {
      const row = evidence.find((item) => item.id === citation.evidenceId);
      if (!row?.person_id) return [];
      return [{
        personId: row.person_id,
        label: people.get(row.person_id)?.name || "Person",
        field: row.kind,
        value: citation.quote || row.text.slice(0, 240),
        source: row.source,
        evidenceId: row.id
      }];
    });
    return { answer: generated.answer, citations, provider: `ollama:${model}` };
  } catch {
    const grouped = evidence.slice(0, 6).map((row) => {
      const label = people.get(row.person_id || "")?.name || "Network evidence";
      return `${label}: ${row.text.replace(/\s+/g, " ").slice(0, 260)}`;
    });
    return {
      answer: `Here are the strongest local evidence matches:\n\n${grouped.join("\n\n")}`,
      citations: evidence.slice(0, 6).flatMap((row): IntelligenceCitation[] => row.person_id ? [{
        personId: row.person_id,
        label: people.get(row.person_id)?.name || "Person",
        field: row.kind,
        value: row.text.slice(0, 240),
        source: row.source,
        evidenceId: row.id
      }] : []),
      provider: "local-evidence"
    };
  }
}

type GeneratedSuggestion = {
  field: string;
  value: unknown;
  confidence: number;
  rationale: string;
  evidenceIds: string[];
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
          field: { type: "string" },
          value: {},
          confidence: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" },
          evidenceIds: { type: "array", items: { type: "string" } }
        }
      }
    }
  }
};

export async function intelligentAutofill(personId: string) {
  const person = getPerson(personId) as Record<string, any> | null;
  if (!person) throw new Error("Person not found");
  refreshEvidenceIndex(personId);
  const evidence = db.prepare(`
    SELECT * FROM evidence_documents WHERE person_id=?
    ORDER BY COALESCE(occurred_at, updated_at) DESC LIMIT 40
  `).all(personId) as EvidenceDocument[];
  const deterministic = autofillSuggestions(personId);
  let generated: GeneratedSuggestion[] = [];
  let model = "deterministic";
  try {
    model = await selectedModel();
    const result = await ollama.generateStructured<{ suggestions: GeneratedSuggestion[] }>({
      model,
      jsonSchema: suggestionSchema,
      system: "Extract relationship facts only when explicitly supported by the supplied local evidence. Never guess sensitive attributes. Prefer no suggestion over an unsupported one.",
      prompt: [
        `Current profile:\n${JSON.stringify({
          name: person.name, company: person.company, headline: person.headline,
          job_title: person.job_title, industry: person.industry,
          location: person.location, hometown: person.hometown, interests: person.interests,
          skills: person.skills, institutions: person.institutions, relationship: person.relationship,
          how_met: person.how_met, where_met: person.where_met, notes: person.notes
        })}`,
        `Evidence:\n${evidence.map((row) => `[${row.id}] ${row.text.slice(0, 1_200)}`).join("\n\n")}`
      ].join("\n\n"),
      validate: (value): value is { suggestions: GeneratedSuggestion[] } => {
        const candidate = value as { suggestions?: unknown };
        return Boolean(candidate && Array.isArray(candidate.suggestions));
      }
    });
    generated = result.suggestions.filter((suggestion) =>
      allowedFields.has(suggestion.field)
      && suggestion.confidence >= 0.55
      && suggestion.evidenceIds.length > 0
      && suggestion.evidenceIds.every((id) => evidence.some((row) => row.id === id))
    );
  } catch {
    // Deterministic suggestions remain available if local inference is offline.
  }

  const combined = [
    ...generated,
    ...deterministic
      .filter((item) => !generated.some((generatedItem) => generatedItem.field === item.field))
      .map((item) => ({
        field: item.field,
        value: item.value,
        confidence: item.confidence,
        rationale: item.reason,
        evidenceIds: evidence.slice(0, 1).map((row) => row.id)
      }))
  ];
  const insert = db.prepare(`
    INSERT INTO inference_suggestions
      (id, person_id, field_name, proposed_value_json, current_value_json, evidence_json,
       rationale, confidence, model, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  return db.transaction(() => combined.slice(0, 12).map((suggestion) => {
    db.prepare("UPDATE inference_suggestions SET status='superseded', reviewed_at=? WHERE person_id=? AND field_name=? AND status='pending'")
      .run(new Date().toISOString(), personId, suggestion.field);
    const id = randomUUID();
    insert.run(
      id,
      personId,
      suggestion.field,
      JSON.stringify(suggestion.value),
      JSON.stringify(person[suggestion.field] ?? null),
      JSON.stringify(suggestion.evidenceIds),
      suggestion.rationale,
      Math.max(0, Math.min(1, suggestion.confidence)),
      model,
      new Date().toISOString()
    );
    const sources = evidence.filter((row) => suggestion.evidenceIds.includes(row.id)).map((row) => row.source);
    return {
      id,
      field: suggestion.field,
      value: suggestion.value,
      confidence: suggestion.confidence,
      reason: suggestion.rationale,
      source: [...new Set(sources)].join(", ") || "Nett inference",
      evidenceIds: suggestion.evidenceIds
    };
  }))();
}

export function reviewInferenceSuggestion(id: string, decision: "accepted" | "rejected", apply = false) {
  const row = db.prepare("SELECT * FROM inference_suggestions WHERE id=?").get(id) as Record<string, any> | undefined;
  if (!row) throw new Error("Suggestion not found");
  if (!["pending", "superseded"].includes(row.status)) throw new Error("Suggestion was already reviewed");
  const value = parse(row.proposed_value_json, null);
  db.transaction(() => {
    db.prepare("UPDATE inference_suggestions SET status=?, reviewed_at=? WHERE id=?")
      .run(decision, new Date().toISOString(), id);
    db.prepare(`
      INSERT INTO inference_feedback
        (id, suggestion_id, person_id, field_name, decision, source_pattern, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), id, row.person_id, row.field_name, decision,
      parse<string[]>(row.evidence_json, []).map((evidenceId) => evidenceId.split(":")[0]).join(","),
      new Date().toISOString()
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
