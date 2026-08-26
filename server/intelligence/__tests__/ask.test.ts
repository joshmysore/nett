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
delete process.env.NETT_ASK_WRITER;
delete process.env.NETT_OPENROUTER_API_KEY;
delete process.env.OPENROUTER_API_KEY;

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>;
const offline: FetchHandler = async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
};
let handler: FetchHandler = offline;
globalThis.fetch = ((input: unknown, init?: RequestInit) => handler(String(input), init)) as typeof fetch;

const { addMemory, createPerson, db, updatePerson } = await import("../../db.js");
const { refreshEvidenceIndex } = await import("../evidence-index.js");
const {
  applyAskAbility,
  parseAskIntent,
  retrieveAskMatches,
  formatAskAnswer,
  cosine,
  reciprocalRankFusion,
  extractNamedPerson,
  loadNamedPeople,
  normalizeAskName,
} = await import("../ask.js");
const { answerRelationshipQuestion, refreshEvidenceEmbeddings, resetIntelligenceModelCache, streamRelationshipQuestion } = await import("../service.js");
const { InMemoryCredentialVault } = await import("../../platform/security/credential-vault.js");
const { resetAskWriterVault, setAskWriterSettings } = await import("../ask-writer.js");

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
  options: { connector?: string; subject?: string; occurredAt?: string; conversationId?: string } = {},
): void {
  const timestamp = options.occurredAt ?? new Date().toISOString();
  const communicationId = randomUUID();
  db.prepare(`
    INSERT INTO communications
      (id, connector_id, external_id, conversation_id, direction, kind, body, occurred_at,
       evidence_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'incoming', 'text', ?, ?, ?, ?, ?)
  `).run(
    communicationId,
    options.connector ?? "messages",
    `ext-${communicationId}`,
    options.conversationId ?? null,
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

function addGroupChat(
  title: string,
  personId: string,
  options: { connector?: string; body?: string } = {},
): string {
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const connector = options.connector ?? "whatsapp";
  db.prepare(`
    INSERT INTO conversations (id, connector_id, external_id, title, is_group, raw_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, '{}', ?, ?)
  `).run(id, connector, `group-${id}`, title, timestamp, timestamp);
  addMessage(personId, options.body ?? `Hello from ${title}`, { connector, conversationId: id });
  return id;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sse(events: string[]): Response {
  return new Response(`${events.join("\n\n")}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
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

test("a follow-up clause does not become part of the person name", () => {
  const intent = parseAskIntent("what do i know about kendra mysore? any key insights on our relationship?");
  assert.equal(intent.namedPerson?.toLocaleLowerCase(), "kendra mysore");
  assert.ok(!intent.namedPerson?.toLocaleLowerCase().includes("insights"));
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
  seedPerson("Ivo This Week", { location: "Madrid", last_contact: new Date(Date.now() - 2 * 86_400_000).toISOString() });
  seedPerson("Kim Years", { location: "Madrid", last_contact: "2020-01-01T00:00:00.000Z" });
  const retrieval = await retrieveAskMatches("What do I know about the people I contacted most recently?");
  const names = peopleNames(retrieval);
  assert.ok(names.includes("Jules Today"));
  assert.ok(names.includes("Ivo This Week"));
  assert.ok(!names.includes("Kim Years"));
  const answer = formatAskAnswer(retrieval);
  assert.match(answer, /Jules Today/);
  assert.match(answer, /Ivo This Week/);
  assert.doesNotMatch(answer, /Kim Years/);
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

test("tell-me-about uses OpenRouter when a key is stored", async () => {
  seedPerson("Nora Brief", { location: "Lisbon", company: "Atelier Nora", relationship: "collaborator" });
  refreshEvidenceIndex();
  resetAskWriterVault(new InMemoryCredentialVault());
  resetIntelligenceModelCache();
  await setAskWriterSettings({
    writer: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    apiKey: "test-key",
  });
  let askedModel = "";
  let prompt = "";
  let provider: { ignore?: string[]; allow_fallbacks?: boolean; only?: string[] } | undefined;
  handler = async (url, init) => {
    const target = String(url);
    if (target.includes("/embeddings")) return json({ data: [] });
    if (target.includes("openrouter.ai/api/v1/chat/completions")) {
      const body = JSON.parse(String(init?.body || "{}"));
      askedModel = body.model;
      provider = body.provider;
      prompt = JSON.stringify(body.messages);
      return sse([
        `data: ${JSON.stringify({ model: "stealth/ox-alpha", choices: [{ delta: { content: "Nora Brief is a collaborator at Atelier Nora in Lisbon." } }] })}`,
        "data: [DONE]",
      ]);
    }
    throw new Error(`unexpected ${url}`);
  };
  const answer = await answerRelationshipQuestion("Tell me about Nora Brief");
  assert.equal(askedModel, "stealth/ox-alpha");
  assert.deepEqual(provider?.ignore, ["anthropic", "openai"]);
  assert.equal(provider?.allow_fallbacks, false);
  assert.match(prompt, /Nora Brief|Atelier Nora/i);
  assert.equal(answer.provider, "openrouter:stealth/ox-alpha");
  assert.match(answer.answer, /Nora Brief/);
  handler = offline;
  await setAskWriterSettings({ writer: "local" });
  resetAskWriterVault(new InMemoryCredentialVault());
  resetIntelligenceModelCache();
});

test("people questions send stored evidence blocks to OpenRouter", async () => {
  seedPerson("Giselle Model Paris", { location: "Paris", foods: ["Sichuan"] });
  refreshEvidenceIndex();
  resetAskWriterVault(new InMemoryCredentialVault());
  resetIntelligenceModelCache();
  await setAskWriterSettings({
    writer: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    apiKey: "test-key",
  });
  let prompt = "";
  handler = async (url, init) => {
    const target = String(url);
    if (target.includes("/embeddings")) return json({ data: [] });
    if (target.includes("openrouter.ai/api/v1/chat/completions")) {
      prompt = JSON.stringify(JSON.parse(String(init?.body || "{}")).messages);
      return sse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Giselle Model Paris is in Paris and likes Sichuan." } }] })}`,
        "data: [DONE]",
      ]);
    }
    throw new Error(`unexpected ${url}`);
  };
  const answer = await answerRelationshipQuestion("Who do I know in Paris who like spicy food?");
  assert.match(prompt, /Giselle Model Paris|Paris/i);
  assert.equal(answer.provider, "openrouter:stealth/ox-alpha");
  handler = offline;
  await setAskWriterSettings({ writer: "local" });
  resetAskWriterVault(new InMemoryCredentialVault());
  resetIntelligenceModelCache();
});

test("OpenRouter failures do not fall back to the stored-record card", async () => {
  seedPerson("Nora OpenRouter Fail", { location: "Lisbon", company: "Atelier Nora" });
  refreshEvidenceIndex();
  resetAskWriterVault(new InMemoryCredentialVault());
  resetIntelligenceModelCache();
  await setAskWriterSettings({
    writer: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    apiKey: "test-key",
  });
  handler = async (url) => {
    const target = String(url);
    if (target.includes("/embeddings")) return json({ data: [] });
    if (target.includes("openrouter.ai/api/v1/chat/completions")) {
      return new Response(JSON.stringify({ error: { message: "no credits" } }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected ${url}`);
  };
  const answer = await answerRelationshipQuestion("Tell me about Nora OpenRouter Fail");
  assert.equal(answer.provider, "openrouter:error");
  assert.match(answer.answer, /OpenRouter/);
  assert.match(answer.answer, /no credits/);
  assert.doesNotMatch(answer.answer, /sister|Juniper Square|is in the stored record/);
  handler = offline;
  await setAskWriterSettings({ writer: "local" });
  resetAskWriterVault(new InMemoryCredentialVault());
  resetIntelligenceModelCache();
});

test("embeddings are skipped without a hosted embed writer", async () => {
  await setAskWriterSettings({ writer: "local" });
  resetAskWriterVault(new InMemoryCredentialVault());
  resetIntelligenceModelCache();
  handler = async (url) => {
    throw new Error(`unexpected ${url}`);
  };
  const result = await refreshEvidenceEmbeddings(10);
  assert.equal(result.embedded, 0);
  assert.equal(result.model, null);
  handler = offline;
  resetIntelligenceModelCache();
});

test("stream emits extract, match, and records stages before the answer", async () => {
  seedPerson("Stage Fixture", { location: "Lisbon, Portugal" });
  await refreshEvidenceIndex();
  const events: Array<{ type: string; id?: string }> = [];
  for await (const event of streamRelationshipQuestion("Who do I know in Lisbon?")) {
    events.push(event);
  }
  assert.equal(events[0]?.type, "stage");
  assert.equal(events[0]?.id, "extract");
  assert.ok(events.some((event) => event.type === "stage" && event.id === "match"));
  assert.ok(events.some((event) => event.type === "stage" && event.id === "records"));
  assert.ok(events.some((event) => event.type === "done"));
});

test("extracts a name from a free-form message-history question", () => {
  const intent = parseAskIntent("What's Serena Pellegrino's message history?");
  assert.equal(intent.namedPerson?.toLocaleLowerCase(), "serena pellegrino");
  assert.equal(intent.wantsMessages, true);
  assert.ok(!intent.topics.includes("serena"));
});

test("does not treat leftover question words as a person name", () => {
  const intent = parseAskIntent("What do I know about the people I contacted most recently?");
  assert.equal(intent.namedPerson, null);
  assert.ok(intent.recencyDays);
});

test("fuzzy name matching recovers a one-letter last-name typo", async () => {
  seedPerson("Sofia Pellegrini", { location: "Milan", company: "Studio Luce" });
  seedPerson("Sofia Pei", { location: "Taipei" });
  const intent = parseAskIntent("Tell me about Sofia Pelegrini");
  assert.equal(intent.namedPerson?.toLocaleLowerCase(), "sofia pelegrini");
  const retrieval = await retrieveAskMatches("Tell me about Sofia Pelegrini");
  assert.deepEqual(peopleNames(retrieval), ["Sofia Pellegrini"]);
  assert.match(retrieval.nameNote || "", /Sofia Pellegrini/);
  const matched = loadNamedPeople("Sofia Pelegrini");
  assert.equal(matched[0]?.name, "Sofia Pellegrini");
});

test("message-history questions pull Gmail, WhatsApp, and Messages", async () => {
  const id = seedPerson("Ada Fong", { location: "Singapore", company: "Harbour Lab" });
  addMessage(id, "Can we move the harbour review to Thursday?", { connector: "gmail", subject: "Review" });
  addMessage(id, "On my way — 10 min.", { connector: "whatsapp" });
  addMessage(id, "Landed. Call you after customs.", { connector: "messages" });
  const retrieval = await retrieveAskMatches("What is Ada Fong's message history?");
  assert.deepEqual(peopleNames(retrieval), ["Ada Fong"]);
  const sources = new Set(retrieval.people[0]?.matches.map((match) => match.source));
  assert.ok(sources.has("gmail"));
  assert.ok(sources.has("whatsapp"));
  assert.ok(sources.has("messages"));
  const answer = formatAskAnswer(retrieval);
  assert.match(answer, /Ada Fong/);
});

test("group-chat questions list stored groups for a person", async () => {
  const id = seedPerson("Ben Ortiz", { location: "Austin" });
  addGroupChat("Friday dinner", id, { connector: "whatsapp", body: "I can host." });
  addGroupChat("Studio crew", id, { connector: "messages", body: "Rehearsal at 7." });
  const retrieval = await retrieveAskMatches("What group chats am I in with Ben Ortiz?");
  assert.ok(retrieval.groups.some((group) => group.title === "Friday dinner"));
  assert.ok(retrieval.groups.some((group) => group.title === "Studio crew"));
  assert.match(formatAskAnswer(retrieval), /Friday dinner|Studio crew/);
});

test("group-chat questions without a name list recent groups", async () => {
  const id = seedPerson("Cam Group", { location: "Oslo" });
  addGroupChat("Oslo walkers", id, { connector: "whatsapp" });
  const retrieval = await retrieveAskMatches("What group chats am I in?");
  assert.ok(retrieval.groups.some((group) => group.title === "Oslo walkers"));
});

test("they/them follow-ups resolve to the previous person", async () => {
  const id = seedPerson("Nora Brief Context", { location: "Lisbon", company: "Atelier Nora" });
  addMessage(id, "See you at the studio tomorrow.", { connector: "messages" });
  const retrieval = await retrieveAskMatches("What's their message history?", {
    contextPersonIds: [id],
  });
  assert.deepEqual(peopleNames(retrieval), ["Nora Brief Context"]);
  assert.ok(retrieval.people[0]?.matches.some((match) => /studio tomorrow/i.test(match.excerpt)));
});

test("extractNamedPerson still reads a typed name-only question", () => {
  assert.equal(extractNamedPerson("Ada Fong"), "Ada Fong");
});

test("normalizeAskName folds typographic apostrophes", () => {
  assert.equal(normalizeAskName("Gil’i Zaid"), "Gil'i Zaid");
  assert.equal(normalizeAskName("Gil'i Zaid"), "Gil'i Zaid");
});

test("named-person ask reads messages on an unmerged same-name record", async () => {
  const profile = seedPerson("Kendrax Relalias", {
    relationship: "sister",
    location: "San Francisco",
    company: "Juniper Square",
  });
  const messages = seedPerson("Kendrax");
  addMessage(messages, "Want to get dinner this weekend in the Mission?");
  addMessage(messages, "Landed in SF — call me when you're free.");
  const retrieval = await retrieveAskMatches(
    "What do I know about Kendrax Relalias? any key insights on our relationship?",
  );
  assert.equal(retrieval.people.length, 1);
  assert.equal(retrieval.people[0]?.personId, profile);
  assert.ok(retrieval.people[0]?.aliasIds.includes(messages));
  assert.ok(retrieval.people[0]?.matches.some((match) => /dinner this weekend|Landed in SF/i.test(match.excerpt)));
  assert.match(retrieval.nameNote || "", /Kendrax/);
});

test("named-person ask folds apostrophes when messages sit on the other spelling", async () => {
  const profile = seedPerson("Gil'i Alias Zaid", { relationship: "friend", location: "New York" });
  const messages = createPerson("Gil’i Alias Zaid");
  addMessage(messages, "See you at the Jane Street desk tomorrow.");
  const retrieval = await retrieveAskMatches("What do I know about Gil'i Alias Zaid?");
  assert.equal(retrieval.people.length, 1);
  assert.equal(retrieval.people[0]?.personId, profile);
  assert.ok(retrieval.people[0]?.aliasIds.includes(messages));
  assert.ok(retrieval.people[0]?.matches.some((match) => /Jane Street desk/i.test(match.excerpt)));
});

test("same first name with a different last name does not donate messages", async () => {
  const target = seedPerson("Serena Alias Pellegrino", { location: "Milan" });
  const other = seedPerson("Serena Alias Pei", { location: "Taipei" });
  addMessage(other, "This message belongs to the other Serena.");
  const retrieval = await retrieveAskMatches("Tell me about Serena Alias Pellegrino");
  assert.deepEqual(peopleNames(retrieval), ["Serena Alias Pellegrino"]);
  assert.equal(retrieval.people[0]?.personId, target);
  assert.ok(!retrieval.people[0]?.aliasIds.includes(other));
  assert.ok(!retrieval.people[0]?.matches.some((match) => /other Serena/i.test(match.excerpt)));
});
});
