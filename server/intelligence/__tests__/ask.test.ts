import assert from "node:assert/strict";
import test, { after, describe } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nett-ask-test-"));
process.env.NETT_DB_PATH = path.join(temporaryDirectory, "nett.db");
process.env.NETT_MESSAGES_DB = path.join(temporaryDirectory, "chat.db");
delete process.env.NETT_OLLAMA_MODEL;

globalThis.fetch = (async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
}) as typeof fetch;

const { addMemory, createPerson, db, updatePerson } = await import("../../db.js");
const { refreshEvidenceIndex } = await import("../evidence-index.js");
const { parseAskIntent, retrieveAskMatches, formatAskAnswer } = await import("../ask.js");
const { answerRelationshipQuestion } = await import("../service.js");

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function seedPerson(name: string, metadata: Record<string, unknown> = {}): string {
  const id = createPerson(name);
  if (Object.keys(metadata).length) updatePerson(id, metadata);
  return id;
}

function addMessage(
  personId: string,
  body: string,
  options: { connector?: string; subject?: string; occurredAt?: string } = {},
): void {
  const timestamp = options.occurredAt ?? new Date().toISOString();
  const communicationId = randomUUID();
  db.prepare(`
    INSERT INTO communications
      (id, connector_id, external_id, conversation_id, direction, kind, body, occurred_at,
       evidence_json, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 'incoming', 'text', ?, ?, ?, ?, ?)
  `).run(
    communicationId,
    options.connector ?? "messages",
    `ext-${communicationId}`,
    body,
    timestamp,
    JSON.stringify({ subject: options.subject ?? null }),
    timestamp,
    timestamp,
  );
  db.prepare(`
    INSERT INTO communication_people (communication_id, person_id, role)
    VALUES (?, ?, 'participant')
  `).run(communicationId, personId);
}

const names = (retrieval: ReturnType<typeof retrieveAskMatches>) =>
  retrieval.people.map((person) => person.name);

describe("Ask Nett retrieval", { concurrency: false }, () => {
test("parses a place plus food constraint without treating food as a place", () => {
  seedPerson("Place Fixture", { location: "Paris, France" });
  const intent = parseAskIntent("Who do I know in Paris who like spicy food?");
  assert.deepEqual(intent.places, ["Paris"]);
  assert.ok(intent.foodIntent);
  assert.ok(intent.topics.includes("spicy"));
  assert.ok(!intent.topics.includes("food"));
});

test("Paris and spicy food intersects metadata instead of returning everyone in the city", async () => {
  const ana = seedPerson("Ana Spicy Paris", {
    location: "Paris, France",
    foods: ["Sichuan", "hot pot"],
    company: "Studio Nord",
  });
  seedPerson("Ben Pastry Paris", { location: "Paris, France", foods: ["pastries", "coffee"] });
  seedPerson("Cam Chili London", { location: "London, UK", foods: ["chili", "spicy noodles"] });
  refreshEvidenceIndex();

  const retrieval = retrieveAskMatches("Who do I know in Paris who like spicy food?");
  assert.ok(names(retrieval).includes("Ana Spicy Paris"));
  assert.ok(!names(retrieval).includes("Ben Pastry Paris"));
  assert.ok(!names(retrieval).includes("Cam Chili London"));
  assert.ok(retrieval.people[0]?.groups.has("place"));
  assert.ok(retrieval.people[0]?.groups.has("topic"));
  const answer = await answerRelationshipQuestion("Who do I know in Paris who like spicy food?");
  assert.match(answer.answer, /Ana Spicy Paris/);
  assert.doesNotMatch(answer.answer, /Ben Pastry Paris/);
  assert.doesNotMatch(answer.answer, /Cam Chili London/);
  assert.ok(answer.citations.some((citation) => citation.personId === ana));
  assert.equal(answer.provider, "local-evidence");
});

test("spicy food in recent email is enough when the foods field is empty", async () => {
  const maya = seedPerson("Maya Email Paris", { location: "Paris, France" });
  addMessage(maya, "Let's get something spicy — hot pot in the 11th this weekend.", {
    connector: "gmail",
    subject: "Dinner",
  });
  seedPerson("Noel Quiet Paris", { location: "Paris, France", notes: "Met at a gallery opening." });
  refreshEvidenceIndex();

  const retrieval = retrieveAskMatches("Who do I know in Paris who like spicy food?");
  assert.ok(names(retrieval).includes("Maya Email Paris"));
  assert.ok(!names(retrieval).includes("Noel Quiet Paris"));
  const mayaHit = retrieval.people.find((person) => person.personId === maya);
  assert.ok(mayaHit?.matches.some((match) => /spicy|hot pot/i.test(match.excerpt)));
  const answer = await answerRelationshipQuestion("Who do I know in Paris who like spicy food?");
  assert.match(answer.answer, /Maya Email Paris/);
  assert.ok(answer.citations.some((citation) => citation.source === "gmail" || /spicy|hot pot/i.test(citation.value)));
});

test("legal tech finds industry and notes, not an unrelated climate contact", async () => {
  seedPerson("Dana Legal", { location: "Berlin", industry: "Legal technology", company: "Counsel Lab" });
  const eli = seedPerson("Eli Notes", { location: "Lisbon", notes: "Building a legaltech workflow for small firms." });
  addMemory(eli, "Follow up about the legaltech pilot with municipal courts.");
  seedPerson("Fay Climate", { location: "Berlin", industry: "Climate", company: "Green Grid" });
  refreshEvidenceIndex();

  const retrieval = retrieveAskMatches("Who might be interested in legal tech?");
  const found = names(retrieval);
  assert.ok(found.includes("Dana Legal"));
  assert.ok(found.includes("Eli Notes"));
  assert.ok(!found.includes("Fay Climate"));
  const answer = await answerRelationshipQuestion("Who might be interested in legal tech?");
  assert.match(answer.answer, /Dana Legal/);
  assert.match(answer.answer, /Eli Notes/);
  assert.doesNotMatch(answer.answer, /Fay Climate/);
});

test("a place-only question still answers from the people index without a model", async () => {
  seedPerson("Giselle Paris", { location: "Paris", job_title: "Editor" });
  seedPerson("Hugo Lyon", { location: "Lyon" });
  const answer = await answerRelationshipQuestion("Who do I know in Paris?");
  assert.equal(answer.provider, "local-people-index");
  assert.match(answer.answer, /Giselle Paris/);
  assert.doesNotMatch(answer.answer, /Hugo Lyon/);
});

test("unmatched questions do not dump unrelated recent evidence", async () => {
  seedPerson("Ivy Recent", { location: "Oslo", notes: "Talked about skiing last night." });
  refreshEvidenceIndex();
  const answer = await answerRelationshipQuestion("Who do I know in Reykjavik who collects stamps?");
  assert.doesNotMatch(answer.answer, /Ivy Recent/);
  assert.match(answer.answer, /Nothing stored|No one matched|Reykjavik/i);
});

test("recent-contact questions prefer last_contact over the rest of the network", () => {
  seedPerson("Jules Today", { location: "Madrid", last_contact: new Date().toISOString() });
  seedPerson("Kim Years", { location: "Madrid", last_contact: "2020-01-01T00:00:00.000Z" });
  const retrieval = retrieveAskMatches("What do I know about the people I contacted most recently?");
  assert.ok(names(retrieval).includes("Jules Today"));
  assert.ok(formatAskAnswer(retrieval).includes("Jules Today"));
});
});
