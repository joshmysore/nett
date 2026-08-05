import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(path.join(tmpdir(), "nett-insights-"));
process.env.NETT_DB_PATH = path.join(directory, "nett.db");
process.env.NETT_MESSAGES_DB = path.join(directory, "chat.db");

// Offline Ollama so insights degrade to signals.
globalThis.fetch = (async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
}) as typeof fetch;

const { createPerson, db, updatePerson } = await import("../../db.js");
const { generateRelationshipInsights } = await import("../insights.js");

after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

test("insights return deterministic briefing without writing profile fields", async () => {
  const id = createPerson("Insight Fixture");
  updatePerson(id, { relationship: "Colleague", company: "Example Co" });
  const timestamp = new Date().toISOString();
  const conversationId = "conv-insight";
  db.prepare(`
    INSERT INTO conversations (id, connector_id, external_id, title, is_group, raw_json, created_at, updated_at)
    VALUES (?, 'messages', 'ext-1', 'Chat', 0, '{}', ?, ?)
  `).run(conversationId, timestamp, timestamp);
  const communicationId = "comm-insight";
  db.prepare(`
    INSERT INTO communications
      (id, connector_id, external_id, conversation_id, direction, kind, body, occurred_at, evidence_json, created_at, updated_at)
    VALUES (?, 'messages', 'msg-1', ?, 'incoming', 'text', ?, ?, '{}', ?, ?)
  `).run(
    communicationId,
    conversationId,
    "Let's catch up over coffee this weekend about the product roadmap and fundraising.",
    timestamp,
    timestamp,
    timestamp,
  );
  db.prepare(`
    INSERT INTO communication_people (communication_id, person_id, role)
    VALUES (?, ?, 'participant')
  `).run(communicationId, id);

  const beforeTags = (db.prepare("SELECT COUNT(*) AS count FROM contact_tags WHERE person_id=?").get(id) as { count: number }).count;
  const insight = await generateRelationshipInsights(id);
  assert.equal(insight.personId, id);
  assert.ok(insight.briefing.length > 10);
  assert.ok(insight.pattern.interactions >= 1);
  assert.ok(Array.isArray(insight.themes));
  assert.ok(Array.isArray(insight.suggestions));
  const afterTags = (db.prepare("SELECT COUNT(*) AS count FROM contact_tags WHERE person_id=?").get(id) as { count: number }).count;
  assert.equal(afterTags, beforeTags, "insights must not write tags without acceptance");
});
