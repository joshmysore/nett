import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nett-ask-threads-"));
process.env.NETT_DB_PATH = path.join(temporaryDirectory, "nett.db");
process.env.NETT_MESSAGES_DB = path.join(temporaryDirectory, "chat.db");

const { db } = await import("../../db.js");
const {
  archiveAllAskThreads,
  archiveAskThread,
  createAskThread,
  getAskThread,
  listAskThreads,
  persistAskTurn,
  persistAskUserMessage,
  renameAskThread,
  titleFromAskQuery,
} = await import("../../ask-threads.js");

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("titleFromAskQuery truncates long questions", () => {
  assert.equal(titleFromAskQuery("  Who is Alex?  "), "Who is Alex?");
  assert.equal(titleFromAskQuery("x".repeat(60)).length, 46);
  assert.equal(titleFromAskQuery(""), "New chat");
});

test("Ask threads persist a turn and list it", () => {
  const created = createAskThread(db);
  assert.equal(created.title, "New chat");
  const persisted = persistAskTurn(db, {
    threadId: created.id,
    query: "Who did I meet at Sequoia?",
    people: [{ id: "p1", name: "Alex" }],
    answer: "I found **Alex** in stored records.",
    citations: [{ personId: "p1", label: "Alex", field: "name", value: "Partner", source: "notes" }],
    stages: [{ id: "search", label: "Searching records" }],
    provider: "local-people-index",
  });
  assert.equal(persisted.thread.title, "Who did I meet at Sequoia?");
  const listed = listAskThreads(db);
  assert.equal(listed[0]?.id, created.id);
  const detail = getAskThread(db, created.id);
  assert.ok(detail);
  assert.equal(detail.messages.length, 2);
  assert.equal(detail.messages[0]?.role, "user");
  assert.equal(detail.messages[0]?.content.people?.[0]?.name, "Alex");
  assert.equal(detail.messages[1]?.role, "assistant");
  assert.equal(detail.messages[1]?.provider, "local-people-index");
});

test("Ask threads rename and archive", () => {
  const { thread } = persistAskUserMessage(db, { threadId: "", query: "Trip ideas" });
  const renamed = renameAskThread(db, thread.id, "Lisbon trip");
  assert.equal(renamed?.title, "Lisbon trip");
  assert.equal(archiveAskThread(db, thread.id), true);
  assert.equal(listAskThreads(db).some((item) => item.id === thread.id), false);
  assert.equal(getAskThread(db, thread.id)?.thread.archivedAt != null, true);
});

test("Ask threads can archive all remaining conversations", () => {
  createAskThread(db, "One");
  createAskThread(db, "Two");
  assert.ok(listAskThreads(db).length >= 2);
  assert.ok(archiveAllAskThreads(db) >= 2);
  assert.equal(listAskThreads(db).length, 0);
});
