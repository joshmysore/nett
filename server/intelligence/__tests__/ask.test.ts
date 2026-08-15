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

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;
const offline: FetchHandler = async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
};
let handler: FetchHandler = offline;
globalThis.fetch = ((input: unknown, init?: RequestInit) => handler(String(input), init)) as typeof fetch;

const { addMemory, createPerson, db, updatePerson } = await import("../../db.js");
const { refreshEvidenceIndex } = await import("../evidence-index.js");
const { applyAskAbility, parseAskIntent, retrieveAskMatches, formatAskAnswer, cosine, reciprocalRankFusion } = await import("../ask.js");
const { answerRelationshipQuestion, refreshEvidenceEmbeddings, resetIntelligenceModelCache, streamRelationshipQuestion } = await import("../service.js");

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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function peopleNames(retrieval: Awaited<ReturnType<typeof retrieveAskMatches>>) {
  return retrieval.people.map((person) => person.name);
}

describe("Ask Nett retrieval", { concurrency: false }, () => {
test("parses a place plus food constraint without treating food as a place", () => {
  seedPerson("Place Fixture", { location: "Paris, France" });
  const intent = parseAskIntent("Who do I know in Paris who like spicy food?");
  assert.deepEqual(intent.places, ["Paris"]);
  assert.ok(intent.foodIntent);
  assert.ok(intent.topics.includes("spicy"));
  assert.ok(!intent.topics.includes("food"));
  assert.equal(intent.inferential, false);
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

  const retrieval = await retrieveAskMatches("Who do I know in Paris who like spicy food?");
  assert.ok(peopleNames(retrieval).includes("Ana Spicy Paris"));
  assert.ok(!peopleNames(retrieval).includes("Ben Pastry Paris"));
  assert.ok(!peopleNames(retrieval).includes("Cam Chili London"));
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

  const retrieval = await retrieveAskMatches("Who do I know in Paris who like spicy food?");
  assert.ok(peopleNames(retrieval).includes("Maya Email Paris"));
  assert.ok(!peopleNames(retrieval).includes("Noel Quiet Paris"));
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

  const retrieval = await retrieveAskMatches("Who might be interested in legal tech?");
  const found = peopleNames(retrieval);
  assert.ok(found.includes("Dana Legal"));
  assert.ok(found.includes("Eli Notes"));
  assert.ok(!found.includes("Fay Climate"));
  const answer = await answerRelationshipQuestion("Who might be interested in legal tech?");
  assert.match(answer.answer, /Dana Legal/);
  assert.match(answer.answer, /Eli Notes/);
  assert.doesNotMatch(answer.answer, /Fay Climate/);
});

test("tell-me-about resolves the named person and writes a brief", async () => {
  seedPerson("Serena Pellegrino", {
    location: "Milan",
    company: "Studio Luce",
    job_title: "Designer",
    relationship: "friend from school",
    notes: "Met through architecture studio.",
  });
  seedPerson("Serena Pei", { location: "Taipei", notes: "Different Serena." });
  const intent = parseAskIntent("Tell me about Serena Pellegrino");
  assert.equal(intent.personBrief, true);
  assert.equal(intent.namedPerson?.toLocaleLowerCase(), "serena pellegrino");
  assert.ok(!intent.topics.includes("serena"));
  const retrieval = await retrieveAskMatches("Tell me about Serena Pellegrino");
  assert.deepEqual(peopleNames(retrieval), ["Serena Pellegrino"]);
  const answer = formatAskAnswer(retrieval);
  assert.match(answer, /Serena Pellegrino/);
  assert.match(answer, /Studio Luce|Designer|friend from school|Milan/);
  assert.doesNotMatch(answer, /2 people match/i);
  assert.doesNotMatch(answer, /Serena Pei/);
});

test("what-else-about does not treat else as a topic", () => {
  const intent = parseAskIntent("What else do I know about Ada Fong?");
  assert.equal(intent.personBrief, true);
  assert.equal(intent.namedPerson?.toLocaleLowerCase(), "ada fong");
  assert.ok(!intent.topics.includes("else"));
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

test("attached person ids scope retrieval to those people", async () => {
  const ana = seedPerson("Ana Mentioned", { location: "Lisbon", notes: "Talked about legal tech over dinner." });
  seedPerson("Ben Unmentioned", { location: "Lisbon", notes: "Also building legaltech, but was not attached." });
  refreshEvidenceIndex();
  const retrieval = await retrieveAskMatches("What notes do I have about legal tech?", {
    personIds: [ana],
    ability: "notes",
  });
  assert.deepEqual(peopleNames(retrieval), ["Ana Mentioned"]);
  assert.ok(!peopleNames(retrieval).includes("Ben Unmentioned"));
});

test("applyAskAbility adds source and recency lenses", () => {
  const intent = applyAskAbility(parseAskIntent("Who have I talked to?"), "recent");
  assert.equal(intent.recencyDays, 90);
  const messages = applyAskAbility(parseAskIntent("What did we discuss?"), "messages");
  assert.deepEqual(messages.sources, ["messages"]);
  const about = applyAskAbility(parseAskIntent("hello"), "about");
  assert.equal(about.personBrief, true);
});

test("recent-contact questions prefer last_contact over the rest of the network", async () => {
  seedPerson("Jules Today", { location: "Madrid", last_contact: new Date().toISOString() });
  seedPerson("Kim Years", { location: "Madrid", last_contact: "2020-01-01T00:00:00.000Z" });
  const retrieval = await retrieveAskMatches("What do I know about the people I contacted most recently?");
  assert.ok(peopleNames(retrieval).includes("Jules Today"));
  assert.ok(formatAskAnswer(retrieval).includes("Jules Today"));
});

test("hybrid retrieval finds a paraphrase via profile embeddings", async () => {
  const owen = seedPerson("Owen Dispute", {
    location: "Edinburgh",
    industry: "Dispute resolution",
    company: "North Chambers",
    notes: "Advises founders on regulatory filings.",
  });
  seedPerson("Fay Climate Vector", { location: "Berlin", industry: "Climate", company: "Green Grid" });
  refreshEvidenceIndex();
  const without = await retrieveAskMatches("Who might be interested in legal tech?");
  assert.ok(!peopleNames(without).includes("Owen Dispute"));

  const query = [1, 0, 0];
  db.prepare("UPDATE evidence_documents SET embedding_json=? WHERE id=?").run(JSON.stringify([0.99, 0.02, 0]), `profile:${owen}`);
  const climate = db.prepare("SELECT id FROM people WHERE preferred_name=?").get("Fay Climate Vector") as { id: string } | undefined;
  if (climate) {
    db.prepare("UPDATE evidence_documents SET embedding_json=? WHERE id=?").run(JSON.stringify([0, 1, 0]), `profile:${climate.id}`);
  }
  const withVectors = await retrieveAskMatches("Who might be interested in legal tech?", {
    embedQuery: async () => query,
  });
  assert.ok(peopleNames(withVectors).includes("Owen Dispute"));
  assert.ok(!peopleNames(withVectors).includes("Fay Climate Vector"));
});

test("cosine and reciprocal rank fusion score as expected", () => {
  assert.ok(cosine([1, 0], [1, 0]) > 0.99);
  assert.ok(cosine([1, 0], [0, 1]) < 0.01);
  const fused = reciprocalRankFusion([["a", "b"], ["b", "a"]]);
  assert.ok((fused.get("a") ?? 0) > 0);
  assert.equal(fused.get("a"), fused.get("b"));
});

test("tell-me-about uses the local chat model when it is available", async () => {
  seedPerson("Nora Brief", { location: "Lisbon", company: "Atelier Nora", relationship: "collaborator" });
  refreshEvidenceIndex();
  resetIntelligenceModelCache();
  let generateModel = "";
  handler = async (url, init) => {
    if (url.endsWith("/api/version")) return json({ version: "test" });
    if (url.endsWith("/api/tags")) {
      return json({ models: [{ name: "llama3.2:3b" }, { name: "qwen3:14b" }] });
    }
    if (url.endsWith("/api/generate")) {
      generateModel = JSON.parse(String(init?.body || "{}")).model;
      return json({
        response: JSON.stringify({
          answer: "Nora Brief is a collaborator at Atelier Nora in Lisbon.",
          citations: [],
        }),
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  const answer = await answerRelationshipQuestion("Tell me about Nora Brief");
  assert.equal(generateModel, "llama3.2:3b");
  assert.equal(answer.provider, "ollama:llama3.2:3b");
  assert.match(answer.answer, /Nora Brief/);
  handler = offline;
  resetIntelligenceModelCache();
});

test("inferential questions use the fast local chat model first", async () => {
  seedPerson("Dana Legal Model", { location: "Berlin", industry: "Legal technology" });
  refreshEvidenceIndex();
  resetIntelligenceModelCache();
  let generateModel = "";
  handler = async (url, init) => {
    if (url.endsWith("/api/version")) return json({ version: "test" });
    if (url.endsWith("/api/tags")) {
      return json({ models: [{ name: "llama3.2:3b" }, { name: "qwen3:14b" }, { name: "nomic-embed-text" }] });
    }
    if (url.endsWith("/api/embed")) return json({ embeddings: [[0, 0, 1]] });
    if (url.endsWith("/api/generate")) {
      generateModel = JSON.parse(String(init?.body || "{}")).model;
      return json({
        response: JSON.stringify({
          answer: "Dana Legal Model works in legal technology.",
          citations: [],
        }),
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  const answer = await answerRelationshipQuestion("Who might be interested in legal tech?");
  assert.equal(generateModel, "llama3.2:3b");
  assert.equal(answer.provider, "ollama:llama3.2:3b");
  handler = offline;
  resetIntelligenceModelCache();
});

test("inferential questions escalate when the fast model is thin", async () => {
  seedPerson("Dana Legal Escalate", { location: "Berlin", industry: "Legal technology" });
  refreshEvidenceIndex();
  resetIntelligenceModelCache();
  const modelsUsed: string[] = [];
  handler = async (url, init) => {
    if (url.endsWith("/api/version")) return json({ version: "test" });
    if (url.endsWith("/api/tags")) {
      return json({ models: [{ name: "llama3.2:3b" }, { name: "qwen3:14b" }] });
    }
    if (url.endsWith("/api/generate")) {
      const model = JSON.parse(String(init?.body || "{}")).model;
      modelsUsed.push(model);
      if (model === "llama3.2:3b") {
        return json({
          response: JSON.stringify({ answer: "No.", citations: [] }),
        });
      }
      return json({
        response: JSON.stringify({
          answer: "Dana Legal Escalate works in legal technology.",
          citations: [],
        }),
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  const answer = await answerRelationshipQuestion("Who might be interested in legal tech?");
  assert.deepEqual(modelsUsed, ["llama3.2:3b", "qwen3:14b"]);
  assert.equal(answer.provider, "ollama:qwen3:14b");
  handler = offline;
  resetIntelligenceModelCache();
});

test("factual questions do not wait on a chat model", async () => {
  resetIntelligenceModelCache();
  let generateCalled = false;
  handler = async (url) => {
    if (url.endsWith("/api/version")) return json({ version: "test" });
    if (url.endsWith("/api/tags")) return json({ models: [{ name: "llama3.2:3b" }, { name: "qwen3:14b" }] });
    if (url.endsWith("/api/generate")) {
      generateCalled = true;
      return json({ response: JSON.stringify({ answer: "should not run", citations: [] }) });
    }
    throw new Error(`unexpected ${url}`);
  };
  const answer = await answerRelationshipQuestion("Who do I know in Paris who like spicy food?");
  assert.equal(generateCalled, false);
  assert.equal(answer.provider, "local-evidence");
  handler = offline;
  resetIntelligenceModelCache();
});

test("stream emits search and match stages before the answer", async () => {
  seedPerson("Stage Fixture", { location: "Lisbon, Portugal" });
  await refreshEvidenceIndex();
  const events: Array<{ type: string; id?: string }> = [];
  for await (const event of streamRelationshipQuestion("Who do I know in Lisbon?")) {
    events.push(event);
  }
  assert.equal(events[0]?.type, "stage");
  assert.equal(events[0]?.id, "search");
  assert.ok(events.some((event) => event.type === "stage" && event.id === "match"));
  assert.ok(events.some((event) => event.type === "done"));
});

test("embeddings are never written with a chat model", async () => {
  resetIntelligenceModelCache();
  handler = async (url) => {
    if (url.endsWith("/api/version")) return json({ version: "test" });
    if (url.endsWith("/api/tags")) return json({ models: [{ name: "llama3.2:3b" }, { name: "qwen3:14b" }] });
    if (url.endsWith("/api/embed")) throw new Error("chat models must not be used to embed");
    throw new Error(`unexpected ${url}`);
  };
  const result = await refreshEvidenceEmbeddings(10);
  assert.equal(result.embedded, 0);
  assert.equal(result.model, null);
  handler = offline;
  resetIntelligenceModelCache();
});
});
