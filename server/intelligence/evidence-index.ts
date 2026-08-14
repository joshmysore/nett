import { createHash } from "node:crypto";
import { db } from "../db.js";

export type EvidenceDocument = {
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

export type EvidenceIndexState = {
  documents: number;
  indexedAt: string | null;
  stale: boolean;
  reason: "not-indexed" | "profile-changed" | null;
};

export type EvidenceIndexResult = {
  indexed: number;
  written: number;
  removed: number;
  cancelled: boolean;
};

/** How many of a person's most recent communications a per-person refresh indexes. */
export const PERSON_COMMUNICATION_WINDOW = 400;

type PendingDocument = {
  id: string;
  personId: string | null;
  kind: string;
  source: string;
  sourceRecordId: string;
  text: string;
  occurredAt: string | null;
  metadata: Record<string, unknown>;
};

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

function ensureSeenTable(): void {
  db.exec("CREATE TEMP TABLE IF NOT EXISTS evidence_seen (id TEXT PRIMARY KEY);");
}

// better-sqlite3 does not cache compiled statements. The previous
// implementation compiled three per indexed document, which dominated the
// cost of indexing a person with thousands of messages.
function createStatements() {
  // Statements below reference the scratch table, so it has to exist before
  // they are compiled — not merely before they are first run.
  ensureSeenTable();
  return {
    documentHash: db.prepare("SELECT content_hash FROM evidence_documents WHERE id=?"),
    documentUpdatedAt: db.prepare("SELECT updated_at FROM evidence_documents WHERE id=?"),
    personDocumentCount: db.prepare("SELECT COUNT(*) AS documents FROM evidence_documents WHERE person_id=?"),
    personDocuments: db.prepare(`
      SELECT id, person_id, kind, source, source_record_id, text, occurred_at, metadata_json, embedding_json
      FROM evidence_documents WHERE person_id=?
      ORDER BY occurred_at DESC LIMIT ?
    `),
    documentById: db.prepare(`
      SELECT id, person_id, kind, source, source_record_id, text, occurred_at, metadata_json, embedding_json
      FROM evidence_documents WHERE id=?
    `),
    upsertDocument: db.prepare(`
      INSERT INTO evidence_documents
        (id, person_id, kind, source, source_record_id, text, occurred_at, metadata_json,
         embedding_json, content_hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        person_id=excluded.person_id,
        kind=excluded.kind,
        source=excluded.source,
        source_record_id=excluded.source_record_id,
        text=excluded.text,
        occurred_at=excluded.occurred_at,
        metadata_json=excluded.metadata_json,
        embedding_json=CASE WHEN evidence_documents.text=excluded.text THEN evidence_documents.embedding_json ELSE NULL END,
        content_hash=excluded.content_hash,
        updated_at=excluded.updated_at
    `),
    deleteFtsRow: db.prepare("DELETE FROM evidence_fts WHERE document_id=?"),
    insertFtsRow: db.prepare("INSERT INTO evidence_fts (document_id, person_id, source, kind, text) VALUES (?, ?, ?, ?, ?)"),
    markSeen: db.prepare("INSERT OR IGNORE INTO temp.evidence_seen (id) VALUES (?)"),
    // A per-person refresh only walks the recent communication window, so it
    // must not delete older interaction documents it deliberately skipped. A
    // full refresh still prunes everything.
    prunePersonFts: db.prepare(`
      DELETE FROM evidence_fts WHERE document_id IN (
        SELECT id FROM evidence_documents
        WHERE person_id=? AND kind<>'interaction'
          AND id NOT IN (SELECT id FROM temp.evidence_seen)
      )
    `),
    prunePersonDocuments: db.prepare(`
      DELETE FROM evidence_documents
      WHERE person_id=? AND kind<>'interaction'
        AND id NOT IN (SELECT id FROM temp.evidence_seen)
    `),
    pruneAllFts: db.prepare("DELETE FROM evidence_fts WHERE document_id NOT IN (SELECT id FROM temp.evidence_seen)"),
    pruneAllDocuments: db.prepare("DELETE FROM evidence_documents WHERE id NOT IN (SELECT id FROM temp.evidence_seen)"),
    clearSeen: db.prepare("DELETE FROM temp.evidence_seen")
  };
}

let cachedStatements: ReturnType<typeof createStatements> | undefined;
function sql() {
  return (cachedStatements ??= createStatements());
}

function documentHash(document: PendingDocument, metadataJson: string): string {
  return createHash("sha256").update([
    document.kind,
    document.source,
    document.sourceRecordId,
    document.occurredAt ?? "",
    metadataJson,
    document.text
  ].join("\u0000")).digest("hex");
}

function* profileDocuments(personId?: string): Generator<PendingDocument> {
  const rows = db.prepare(`
    SELECT p.id, p.preferred_name, p.first_name, p.last_name, p.nickname,
      m.*, GROUP_CONCAT(DISTINCT t.name) AS tag_names
    FROM people p
    LEFT JOIN nett_metadata m ON m.person_id=p.id
    LEFT JOIN contact_tags ct ON ct.person_id=p.id
    LEFT JOIN tags t ON t.id=ct.tag_id
    ${personId ? "WHERE p.id=?" : ""}
    GROUP BY p.id
  `).all(...(personId ? [personId] : [])) as Record<string, unknown>[];
  for (const profile of rows) {
    const fields = [
      ["name", profile.preferred_name], ["nickname", profile.nickname],
      ["company", profile.company], ["industry", profile.industry],
      ["location", profile.location], ["headline", profile.headline],
      ["job title", profile.job_title],
      ["hometown", parse(String(profile.hometown || ""), String(profile.hometown || ""))],
      ["relationship", profile.relationship], ["how met", profile.how_met],
      ["where met", profile.where_met], ["when met", profile.when_met],
      ["interests", parse(String(profile.interests || ""), [])],
      ["skills", parse(String(profile.skills || ""), [])],
      ["foods", parse(String(profile.foods || ""), [])],
      ["institutions", parse(String(profile.institutions || ""), [])],
      ["mutuals", parse(String(profile.mutuals || ""), [])],
      ["tags", profile.tag_names], ["notes", profile.notes],
      ["memory summary", profile.quick_memories]
    ].filter(([, value]) => text(value));
    yield {
      id: `profile:${profile.id}`,
      personId: String(profile.id),
      kind: "profile-field",
      source: "nett",
      sourceRecordId: String(profile.id),
      text: fields.map(([label, value]) => `${label}: ${text(value)}`).join("\n"),
      occurredAt: String(profile.updated_at || profile.created_at || ""),
      metadata: { name: profile.preferred_name }
    };
  }
}

function* memoryDocuments(personId?: string): Generator<PendingDocument> {
  const rows = db.prepare(`SELECT mm.* FROM memories mm ${personId ? "WHERE mm.person_id=?" : ""}`)
    .all(...(personId ? [personId] : [])) as Record<string, unknown>[];
  for (const memory of rows) {
    yield {
      id: `memory:${memory.id}`,
      personId: String(memory.person_id),
      kind: "memory",
      source: String(memory.source),
      sourceRecordId: String(memory.id),
      text: String(memory.raw_text),
      occurredAt: String(memory.occurred_at),
      metadata: parse(String(memory.structured_json || "{}"), {})
    };
  }
}

function* communicationDocuments(personId?: string): Generator<PendingDocument> {
  // A person with 25k messages does not need 25k evidence documents: retrieval
  // only ever reads a small recent window, and indexing the whole history is
  // what made a per-person refresh cost minutes.
  const rows = (personId
    ? db.prepare(`
        SELECT c.*, cp.person_id
        FROM communications c
        JOIN communication_people cp ON cp.communication_id=c.id
        WHERE cp.person_id=?
        ORDER BY c.occurred_at DESC
        LIMIT ${PERSON_COMMUNICATION_WINDOW}
      `).all(personId)
    : db.prepare(`
        SELECT c.*, cp.person_id
        FROM communications c
        JOIN communication_people cp ON cp.communication_id=c.id
      `).all()) as Record<string, unknown>[];
  for (const communication of rows) {
    const body = text(communication.body);
    const evidence = parse(String(communication.evidence_json || "{}"), {}) as Record<string, unknown>;
    const subject = text(evidence.subject);
    if (!body && !subject) continue;
    yield {
      id: `communication:${communication.id}:${communication.person_id}`,
      personId: String(communication.person_id),
      kind: "interaction",
      source: String(communication.connector_id),
      sourceRecordId: String(communication.external_id),
      text: [
        communication.direction ? `direction: ${communication.direction}` : "",
        subject ? `subject: ${subject}` : "",
        body
      ].filter(Boolean).join("\n"),
      occurredAt: String(communication.occurred_at),
      metadata: evidence
    };
  }
}

function* provenanceDocuments(personId?: string): Generator<PendingDocument> {
  const rows = db.prepare(`SELECT fp.* FROM field_provenance fp ${personId ? "WHERE fp.person_id=?" : ""}`)
    .all(...(personId ? [personId] : [])) as Record<string, unknown>[];
  for (const fact of rows) {
    if (!text(fact.field_value)) continue;
    yield {
      id: `provenance:${fact.id}`,
      personId: String(fact.person_id),
      kind: "profile-field",
      source: String(fact.connector_id),
      sourceRecordId: String(fact.source_record_id || fact.id),
      text: `${String(fact.field_name).replaceAll("_", " ")}: ${text(fact.field_value)}`,
      occurredAt: String(fact.observed_at),
      metadata: { field: fact.field_name, confidence: fact.confidence }
    };
  }
}

function* pendingDocuments(personId?: string): Generator<PendingDocument> {
  yield* profileDocuments(personId);
  yield* memoryDocuments(personId);
  yield* communicationDocuments(personId);
  yield* provenanceDocuments(personId);
}

function writeDocument(document: PendingDocument, timestamp: string): boolean {
  const metadataJson = JSON.stringify(document.metadata ?? {});
  const hash = documentHash(document, metadataJson);
  const existing = sql().documentHash.get(document.id) as { content_hash: string | null } | undefined;
  if (existing && existing.content_hash === hash) return false;
  sql().upsertDocument.run(
    document.id, document.personId, document.kind, document.source, document.sourceRecordId,
    document.text, document.occurredAt, metadataJson, hash, timestamp
  );
  if (existing) sql().deleteFtsRow.run(document.id);
  sql().insertFtsRow.run(document.id, document.personId, document.source, document.kind, document.text);
  return true;
}

function openSeenTable(): void {
  ensureSeenTable();
  db.exec("DELETE FROM temp.evidence_seen;");
}

function prune(personId?: string): number {
  let removed = 0;
  if (personId) {
    sql().prunePersonFts.run(personId);
    removed = sql().prunePersonDocuments.run(personId).changes;
  } else {
    sql().pruneAllFts.run();
    removed = sql().pruneAllDocuments.run().changes;
  }
  sql().clearSeen.run();
  return removed;
}

/**
 * Synchronous full refresh. Kept for the existing explicit and write-path
 * callers. It is now incremental: a document whose content hash is unchanged
 * is neither rewritten nor re-tokenised into FTS.
 */
export function refreshEvidenceIndex(personId?: string): { indexed: number; written: number; removed: number } {
  const timestamp = new Date().toISOString();
  return db.transaction(() => {
    openSeenTable();
    let indexed = 0;
    let written = 0;
    for (const document of pendingDocuments(personId)) {
      indexed++;
      sql().markSeen.run(document.id);
      if (writeDocument(document, timestamp)) written++;
    }
    return { indexed, written, removed: prune(personId) };
  })();
}

/**
 * Prunes against an explicit id set rather than the shared temp table, so a
 * refresh that yields mid-way cannot have its bookkeeping cleared by another
 * refresh running in the gap.
 */
function prunePerson(personId: string, seen: ReadonlySet<string>): number {
  const ids = [...seen];
  // Beyond SQLite's parameter ceiling the exclusion list cannot be expressed
  // safely, and a partial list would delete live evidence. Keep everything.
  if (ids.length > 20_000) return 0;
  const clause = ids.length ? ` AND id NOT IN (${ids.map(() => "?").join(",")})` : "";
  db.prepare(`
    DELETE FROM evidence_fts WHERE document_id IN (
      SELECT id FROM evidence_documents
      WHERE person_id=? AND kind<>'interaction'${clause}
    )
  `).run(personId, ...ids);
  return db.prepare(`
    DELETE FROM evidence_documents WHERE person_id=? AND kind<>'interaction'${clause}
  `).run(personId, ...ids).changes;
}

/**
 * Cancellable refresh that commits in bounded batches and yields to the event
 * loop between them, so a large person cannot stall unrelated requests.
 */
export async function refreshPersonEvidenceIndex(
  personId: string,
  options: { signal?: AbortSignal; batchSize?: number } = {}
): Promise<EvidenceIndexResult> {
  const batchSize = Math.max(1, options.batchSize ?? 250);
  const timestamp = new Date().toISOString();
  const seen = new Set<string>();
  let indexed = 0;
  let written = 0;
  let batch: PendingDocument[] = [];
  const flush = db.transaction((documents: PendingDocument[]) => {
    let count = 0;
    for (const document of documents) {
      seen.add(document.id);
      if (writeDocument(document, timestamp)) count++;
    }
    return count;
  });
  for (const document of pendingDocuments(personId)) {
    batch.push(document);
    indexed++;
    if (batch.length < batchSize) continue;
    written += flush(batch);
    batch = [];
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    if (options.signal?.aborted) return { indexed, written, removed: 0, cancelled: true };
  }
  if (batch.length) written += flush(batch);
  return {
    indexed,
    written,
    removed: db.transaction(() => prunePerson(personId, seen))(),
    cancelled: false
  };
}

/**
 * Cheap staleness probe. Deliberately avoids counting communications: the
 * document count is answered by idx_evidence_documents_person without touching
 * a row, and the profile document is a primary-key lookup.
 */
export function personEvidenceIndexState(personId: string, personUpdatedAt?: string | null): EvidenceIndexState {
  const { documents } = sql().personDocumentCount.get(personId) as { documents: number };
  const profile = sql().documentUpdatedAt.get(`profile:${personId}`) as { updated_at: string } | undefined;
  if (!documents || !profile) {
    return { documents, indexedAt: profile?.updated_at ?? null, stale: true, reason: "not-indexed" };
  }
  const changed = Boolean(personUpdatedAt && profile.updated_at < personUpdatedAt);
  return {
    documents,
    indexedAt: profile.updated_at,
    stale: changed,
    reason: changed ? "profile-changed" : null
  };
}

/** Bounded, index-ordered read of a person's indexed evidence. */
export function personEvidenceDocuments(personId: string, limit: number): EvidenceDocument[] {
  const rows = sql().personDocuments.all(personId, Math.max(1, limit)) as EvidenceDocument[];
  if (rows.some((row) => row.id === `profile:${personId}`)) return rows;
  const profile = sql().documentById.get(`profile:${personId}`) as EvidenceDocument | undefined;
  return profile ? [profile, ...rows.slice(0, Math.max(0, limit - 1))] : rows;
}

/** Hydrates a bounded set of documents chosen by a ranking stage. */
export function evidenceDocumentsByIds(ids: readonly string[]): EvidenceDocument[] {
  if (!ids.length) return [];
  const bounded = ids.slice(0, 200);
  return db.prepare(`
    SELECT id, person_id, kind, source, source_record_id, text, occurred_at, metadata_json, embedding_json
    FROM evidence_documents WHERE id IN (${bounded.map(() => "?").join(",")})
  `).all(...bounded) as EvidenceDocument[];
}
