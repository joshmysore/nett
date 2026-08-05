import { mkdirSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** Build an isolated, seeded database for Playwright. Never copies the user's
 *  live `data/nett.db` — that path is huge, WAL-sensitive, and unsafe to share
 *  with parallel stress writes. */
export default async function globalSetup() {
  const target = process.env.NETT_E2E_DB || "/tmp/nett-e2e.db";
  mkdirSync(path.dirname(target), { recursive: true });
  for (const candidate of [target, `${target}-wal`, `${target}-shm`]) {
    if (existsSync(candidate)) unlinkSync(candidate);
  }

  process.env.NETT_DB_PATH = target;
  process.env.NETT_MESSAGES_DB = path.join(path.dirname(target), "nett-e2e-messages.db");

  const { createPerson, db, updatePerson } = await import("../server/db.js");
  const timestamp = new Date().toISOString();

  // Enough people for pagination smoke (50/page + Next) and named search hits.
  const names = [
    "Alex Rivera", "Alex Chen", "Jordan Lee", "Sam Okonkwo", "Casey Nguyen",
    "Riley Patel", "Morgan Blake", "Quinn Harper", "Avery Brooks", "Jamie Soto",
    "Taylor Kim", "Drew Alvarez", "Reese Campbell", "Cameron Diaz", "Parker Singh",
    "Hayden Cole", "Rowan Miles", "Skyler James", "Finley Shaw", "Emerson Cruz",
    "Kai Nakamura", "Logan Price", "Sydney West", "Dakota Reed", "Charlie Dunn",
    "Harper Stone", "Micah Ford", "Elliot Grant", "Sasha Lane", "Noah Bennett",
    "Liam Carter", "Olivia Hayes", "Emma Brooks", "Ava Mitchell", "Sophia Reed",
    "Isabella Cole", "Mia Turner", "Charlotte Ward", "Amelia Scott", "Harper Evans",
    "Evelyn Price", "Abigail Hughes", "Emily Foster", "Elizabeth Gray", "Sofia Powell",
    "Madison Ross", "Scarlett Kelly", "Victoria Perry", "Aria Simmons", "Penelope Butler",
    "Chloe Barnes", "Layla Fisher", "Riley Jenkins", "Zoey Henderson", "Nora Peterson",
    "Lily Morris", "Eleanor Rogers", "Hannah Reed", "Lillian Cook", "Addison Morgan",
  ];

  for (const [index, name] of names.entries()) {
    const id = createPerson(name);
    updatePerson(id, {
      company: index % 3 === 0 ? "Example Institute" : "Local Studio",
      industry: index % 2 === 0 ? "Technology" : "Design",
      relationship: index % 4 === 0 ? "Friend" : "Colleague",
      location: "Austin, Texas, United States",
    });
    if (index < 3) {
      const conversationId = randomUUID();
      db.prepare(`
        INSERT INTO conversations (id, connector_id, external_id, title, is_group, raw_json, created_at, updated_at)
        VALUES (?, 'messages', ?, ?, 0, '{}', ?, ?)
      `).run(conversationId, `ext-${index}`, `Chat ${name}`, timestamp, timestamp);
      const communicationId = randomUUID();
      db.prepare(`
        INSERT INTO communications
          (id, connector_id, external_id, conversation_id, direction, kind, body, occurred_at, evidence_json, created_at, updated_at)
        VALUES (?, 'messages', ?, ?, 'incoming', 'text', ?, ?, '{}', ?, ?)
      `).run(
        communicationId,
        `msg-${index}`,
        conversationId,
        `Coffee next week about the product roadmap and fundraising?`,
        timestamp,
        timestamp,
        timestamp,
      );
      db.prepare(`
        INSERT INTO communication_people (communication_id, person_id, role)
        VALUES (?, ?, 'participant')
      `).run(communicationId, id);
    }
  }

  db.close();
}
