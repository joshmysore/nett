import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The real database holds irreplaceable user data. Point the module at an
// isolated file before anything that opens it is imported.
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nett-autofill-test-"));
process.env.NETT_DB_PATH = path.join(temporaryDirectory, "nett.db");
process.env.NETT_MESSAGES_DB = path.join(temporaryDirectory, "chat.db");
delete process.env.NETT_OLLAMA_MODEL;

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;

const offline: FetchHandler = async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
};

let handler: FetchHandler = offline;
// OllamaProvider captures `fetch` when it is constructed, which happens as the
// service module is evaluated, so the seam has to be installed first.
globalThis.fetch = ((input: unknown, init?: RequestInit) => handler(String(input), init)) as typeof fetch;

const { addMemory, createPerson, db, getPerson, updatePerson } = await import("../../db.js");
const {
  intelligentAutofill,
  personEvidenceIndexState,
  refreshEvidenceIndex,
  reviewInferenceSuggestion
} = await import("../service.js");

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function modelReturning(suggestions: unknown[]): FetchHandler {
  return async (url) => {
    if (url.endsWith("/api/version")) return json({ version: "test" });
    if (url.endsWith("/api/tags")) return json({ models: [{ name: "qwen3:14b" }, { name: "llama3.2:3b" }] });
    if (url.endsWith("/api/generate")) return json({ response: JSON.stringify({ suggestions }) });
    throw new Error(`unexpected request to ${url}`);
  };
}

function seedPerson(name: string, metadata: Record<string, unknown> = {}): string {
  const id = createPerson(name);
  if (Object.keys(metadata).length) updatePerson(id, metadata);
  return id;
}

function addProvenance(
  personId: string,
  field: string,
  value: string,
  connector = "apple-contacts",
  observedAt = "2026-01-05T00:00:00.000Z"
): void {
  db.prepare(`
    INSERT INTO field_provenance
      (id, person_id, field_name, field_value, connector_id, source_record_id, confidence, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), personId, field, value, connector, `record-${randomUUID()}`, 0.9, observedAt);
}

const documentCount = (personId: string) =>
  (db.prepare("SELECT COUNT(*) AS count FROM evidence_documents WHERE person_id=?").get(personId) as { count: number }).count;

const storedFields = (personId: string) =>
  db.prepare("SELECT field_name FROM inference_suggestions WHERE person_id=?")
    .all(personId).map((row) => (row as { field_name: string }).field_name);

const memoryDocumentId = (personId: string) =>
  (db.prepare("SELECT id FROM evidence_documents WHERE person_id=? AND kind='memory' LIMIT 1")
    .get(personId) as { id: string }).id;

// Deliberately first: it is the only test that reaches autofill before
// anything has touched the evidence index in this process.
test("an unindexed person is reported as stale rather than silently empty", async () => {
  handler = offline;
  const id = seedPerson("Hana Unindexed");
  addProvenance(id, "company", "Unindexed Co");

  const state = personEvidenceIndexState(id, (getPerson(id) as unknown as { updated_at: string }).updated_at);
  assert.equal(state.stale, true);
  assert.equal(state.reason, "not-indexed");
  assert.equal(state.documents, 0);

  const result = await intelligentAutofill(id);
  assert.equal(result.degraded, true);
  assert.match(result.note ?? "", /has not indexed this person/);
  assert.equal(
    result.suggestions.some((suggestion) => suggestion.field === "company"),
    true,
    "live provenance evidence still produces a reviewable suggestion"
  );
});

test("autofill degrades honestly when the local model is unavailable", async () => {
  handler = offline;
  const id = seedPerson("Ana Degraded");
  addProvenance(id, "company", "Terra Labs");
  addMemory(id, "Ana leads climate finance work in Lisbon.", {}, "manual");
  refreshEvidenceIndex(id);

  const result = await intelligentAutofill(id);

  assert.equal(result.degraded, true);
  assert.equal(result.model, null);
  assert.equal(result.provider, null);
  assert.match(result.note ?? "", /local model was not reachable/);

  const company = result.suggestions.find((suggestion) => suggestion.field === "company");
  assert.ok(company, "deterministic suggestions must survive an offline model");
  assert.equal(company.value, "Terra Labs");
  assert.equal(company.provider, null);
  assert.equal(company.evidence[0].kind, "provenance");
  assert.equal(company.evidence[0].sourceType, "apple-contacts");
  assert.ok(company.evidence[0].observedAt, "evidence must carry an observed date");
  assert.ok(company.generatedAt, "suggestions must carry a generated date");
  assert.equal(company.status, "pending");
  assert.equal(company.accepted, false);
  assert.equal(company.rejected, false);
  assert.equal(company.personMatch.personId, id);
  assert.ok(result.suggestions.every((suggestion) => suggestion.evidence.length > 0));
});

test("autofill stops immediately when the caller aborts", async () => {
  handler = offline;
  const id = seedPerson("Bo Cancelled");
  addProvenance(id, "company", "Halt Co");
  refreshEvidenceIndex(id);
  const before = storedFields(id).length;

  await assert.rejects(
    () => intelligentAutofill(id, { signal: AbortSignal.abort() }),
    (error: Error) => error.name === "AbortError"
  );
  assert.equal(storedFields(id).length, before, "an aborted call must not write suggestions");

  const controller = new AbortController();
  let generateCalls = 0;
  let sawSignal = false;
  handler = async (url, init) => {
    if (url.endsWith("/api/tags")) return json({ models: [{ name: "qwen3:14b" }] });
    if (url.endsWith("/api/generate")) {
      generateCalls++;
      sawSignal = Boolean(init?.signal);
      controller.abort();
      throw new Error("The operation was aborted");
    }
    throw new Error(`unexpected request to ${url}`);
  };

  await assert.rejects(
    () => intelligentAutofill(id, { signal: controller.signal }),
    (error: Error) => error.name === "AbortError"
  );
  assert.equal(generateCalls, 1);
  assert.ok(sawSignal, "the abort signal must reach the Ollama request");
  assert.equal(storedFields(id).length, before, "a cancelled generation must not write suggestions");
});

test("a suggestion is never produced without supporting evidence", async () => {
  const id = seedPerson("Cy Unsupported");
  refreshEvidenceIndex(id);
  handler = modelReturning([
    { field: "hometown", value: "Porto", confidence: 0.98, rationale: "Sounds Portuguese", evidenceIds: [] },
    { field: "location", value: "Berlin", confidence: 0.98, rationale: "Invented", evidenceIds: ["evidence:does-not-exist"] },
    { field: "industry", value: "Robotics", confidence: 0.98, rationale: "Half invented", evidenceIds: [`profile:${id}`, "evidence:does-not-exist"] }
  ]);

  const result = await intelligentAutofill(id);

  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.field), []);
  assert.deepEqual(storedFields(id), []);
});

test("a proposal that would overwrite an existing value is marked as a conflict", async () => {
  const id = seedPerson("Dana Conflict", { company: "Old Corp" });
  addMemory(id, "Dana said she joined New Corp last month.", {}, "manual");
  refreshEvidenceIndex(id);
  const evidenceId = memoryDocumentId(id);
  handler = modelReturning([
    { field: "company", value: "New Corp", confidence: 0.9, rationale: "Stated in a memory", evidenceIds: [evidenceId] }
  ]);

  const result = await intelligentAutofill(id);

  assert.equal(result.degraded, false);
  assert.equal(result.model, "qwen3:14b");
  const company = result.suggestions.find((suggestion) => suggestion.field === "company");
  assert.ok(company);
  assert.equal(company.conflict, true);
  assert.equal(company.operation, "replace");
  assert.equal(company.existingValue, "Old Corp");
  assert.match(company.conflictNote ?? "", /Old Corp/);
  assert.equal(company.provider, "ollama:qwen3:14b");

  handler = modelReturning([
    { field: "company", value: "Old Corp", confidence: 0.9, rationale: "Already known", evidenceIds: [evidenceId] }
  ]);
  const unchanged = await intelligentAutofill(id);
  assert.equal(
    unchanged.suggestions.some((suggestion) => suggestion.field === "company"),
    false,
    "a proposal identical to the stored value is not a suggestion"
  );
});

test("a rejected suggestion is retained and not proposed again without new evidence", async () => {
  handler = offline;
  const id = seedPerson("Eli Rejected");
  addProvenance(id, "location", "Lisbon");
  refreshEvidenceIndex(id);

  const first = await intelligentAutofill(id);
  const location = first.suggestions.find((suggestion) => suggestion.field === "location");
  assert.ok(location);

  reviewInferenceSuggestion(location.id, "rejected");

  const second = await intelligentAutofill(id);
  assert.equal(
    second.suggestions.some((suggestion) => suggestion.field === "location"),
    false,
    "the same value backed by the same evidence must not come back"
  );

  const retained = db.prepare("SELECT status FROM inference_suggestions WHERE id=?").get(location.id) as { status: string };
  assert.equal(retained.status, "rejected", "rejection history must be preserved");
  const feedback = db.prepare("SELECT decision, source_pattern FROM inference_feedback WHERE suggestion_id=?")
    .get(location.id) as { decision: string; source_pattern: string };
  assert.equal(feedback.decision, "rejected");
  assert.equal(feedback.source_pattern, "apple-contacts", "feedback keeps the source that produced the evidence");

  addProvenance(id, "location", "Lisbon", "linkedin-public", "2026-06-01T00:00:00.000Z");
  refreshEvidenceIndex(id);
  const third = await intelligentAutofill(id);
  assert.equal(
    third.suggestions.some((suggestion) => suggestion.field === "location"),
    true,
    "new evidence makes the proposal reviewable again"
  );
});

test("protected traits are never proposed, whatever the model returns", async () => {
  // Use a name outside the gender tables so name inference does not fire.
  const id = seedPerson("Zzqx Private");
  addMemory(id, "Zzqx is recovering from surgery and goes to church on Sundays.", {}, "manual");
  refreshEvidenceIndex(id);
  const evidenceId = memoryDocumentId(id);
  const forbidden = [
    "religion", "health", "personality",
    "ethnicity", "race", "sexual_orientation", "politics", "marital_status"
  ];
  handler = modelReturning(forbidden.map((field) => ({
    field,
    value: "Confidently inferred",
    confidence: 0.99,
    rationale: "The memory says so",
    evidenceIds: [evidenceId]
  })));

  const result = await intelligentAutofill(id);

  for (const field of forbidden) {
    assert.equal(
      result.suggestions.some((suggestion) => suggestion.field === field),
      false,
      `${field} must never be proposed`
    );
    assert.equal(storedFields(id).includes(field), false, `${field} must never be stored`);
  }

  const smuggled = randomUUID();
  db.prepare(`
    INSERT INTO inference_suggestions
      (id, person_id, field_name, proposed_value_json, current_value_json, evidence_json,
       rationale, confidence, model, status, created_at)
    VALUES (?, ?, 'religion', '"Christian"', 'null', '[]', 'smuggled', 0.9, 'test', 'pending', ?)
  `).run(smuggled, id, new Date().toISOString());
  assert.throws(
    () => reviewInferenceSuggestion(smuggled, "accepted", true),
    /cannot be written by inference/
  );
});

test("autofill never rebuilds the evidence index inside the request", async () => {
  handler = offline;
  const id = seedPerson("Gia Indexed");
  addMemory(id, "Gia met me at a climate policy summit.", {}, "manual");
  refreshEvidenceIndex(id);
  const indexed = documentCount(id);
  assert.ok(indexed > 0);

  addMemory(id, "Gia now advises a robotics team.", {}, "manual");
  await intelligentAutofill(id);
  assert.equal(documentCount(id), indexed, "autofill must not write evidence documents");

  await intelligentAutofill(id, { reindex: true });
  assert.ok(documentCount(id) > indexed, "an explicit reindex still refreshes the index");
});
