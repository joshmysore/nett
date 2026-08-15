/**
 * Isolated investor-demo database. Never reads or copies data/nett.db.
 * The two named people are the ones requested for the cut; supporting
 * rows exist so People looks lived-in. Memories are demo-safe, not a
 * dump of a live Messages store.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import path from "node:path";

export const DEMO_DB = process.env.NETT_DEMO_DB || "/tmp/nett-investor-demo.db";

function daysAgo(days: number, hours = 10): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hours, 12, 0, 0);
  return date.toISOString();
}

function wipe(file: string) {
  for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
    if (existsSync(candidate)) unlinkSync(candidate);
  }
}

export async function seedInvestorDemo(dbPath = DEMO_DB) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  wipe(dbPath);
  const messagesDb = path.join(path.dirname(dbPath), "nett-demo-messages.db");
  wipe(messagesDb);

  process.env.NETT_DB_PATH = dbPath;
  process.env.NETT_MESSAGES_DB = messagesDb;

  const { addMemory, createPerson, db, setConnectorState, updatePerson } = await import("../../server/db.js");
  const { updateOnboarding } = await import("../../server/setup.js");
  const { refreshEvidenceIndex } = await import("../../server/intelligence/evidence-index.js");

  updateOnboarding({
    ownerDisplayName: "Josh",
    ownerHometowns: ["Mysore"],
    ownerInterests: ["building tools for memory"],
    complete: true,
  });

  const kendra = createPerson("Kendra Mysore");
  updatePerson(kendra, {
    relationship: "Sister",
    relationship_strength: 96,
    priority: 10,
    hometown: ["Mysore"],
    languages: ["English", "Kannada"],
    how_met: "Family",
    when_met: "Grew up together",
    quick_memories: "Called last weekend about coming home in September.",
    last_contact: daysAgo(2, 19),
    warmth: 92,
    notes: "The person I call when I need the family thread held together.",
  }, "nett");
  addMemory(
    kendra,
    "Kendra is my sister. We grew up in Mysore. She is the person I call when I need the family thread held together.",
    { relationship: "Sister", hometown: ["Mysore"], how_met: "Family" },
    "manual",
  );
  addMemory(
    kendra,
    "Called last weekend. She is planning to come home in September and wanted to know if I would be there for the week Dad is in town.",
    {},
    "manual",
  );

  const gilly = createPerson("Gilly Zaid");
  updatePerson(gilly, {
    relationship: "Friend",
    relationship_strength: 88,
    priority: 9,
    how_met: "School",
    when_met: "Years ago",
    languages: ["English"],
    quick_memories: "Voice note yesterday — still the same cadence, still the same jokes.",
    last_contact: daysAgo(1, 21),
    warmth: 86,
    notes: "A friend I can go a month without seeing and pick up mid-sentence.",
  }, "nett");
  addMemory(
    gilly,
    "Gilly Zaid is a close friend from school. We can go a month without talking and pick up mid-sentence.",
    { relationship: "Friend", how_met: "School" },
    "manual",
  );
  addMemory(
    gilly,
    "Voice note yesterday. Same cadence, same jokes. He mentioned he might pass through the city later this month.",
    {},
    "whatsapp",
  );

  const others: Array<{
    name: string;
    meta: Record<string, unknown>;
    memory: string;
    days: number;
  }> = [
    {
      name: "Maya Chen",
      meta: { relationship: "Colleague", company: "Local Studio", job_title: "Designer", location: "Oakland", relationship_strength: 62 },
      memory: "Walked through the type specimen together. She notices the thing I miss.",
      days: 5,
    },
    {
      name: "Sam Weil",
      meta: { relationship: "Friend", location: "Paris", foods: ["spicy food"], relationship_strength: 70 },
      memory: "Dinner in the 11th. Ordered the hottest thing on the menu, as usual.",
      days: 12,
    },
    {
      name: "Ada Fong",
      meta: { relationship: "Collaborator", company: "Atelier", job_title: "Research lead", location: "San Francisco", relationship_strength: 58 },
      memory: "Sent the draft of the recognition essay. She marked the sentence that actually mattered.",
      days: 8,
    },
    {
      name: "Harish Mysore",
      meta: { relationship: "Family", hometown: ["Mysore"], relationship_strength: 80, priority: 7 },
      memory: "Asked whether I would be home when Kendra visits in September.",
      days: 4,
    },
    {
      name: "Jordan Lee",
      meta: { relationship: "Colleague", company: "Example Institute", industry: "Technology", location: "Austin", relationship_strength: 44 },
      memory: "Coffee about the product roadmap. No next step yet.",
      days: 21,
    },
    {
      name: "Priya Raman",
      meta: { relationship: "Friend", location: "Bangalore", languages: ["English", "Tamil"], relationship_strength: 66 },
      memory: "Long walk after the wedding. She remembered a story I had forgotten.",
      days: 18,
    },
    {
      name: "Theo Grant",
      meta: { relationship: "Acquaintance", company: "North Press", job_title: "Editor", location: "London", relationship_strength: 35 },
      memory: "Introduced over email. Still owe a proper reply.",
      days: 40,
    },
    {
      name: "Noor Alvi",
      meta: { relationship: "Friend", location: "Chicago", interests: ["legal tech"], relationship_strength: 54 },
      memory: "Asked who I knew who might care about court-record tooling.",
      days: 9,
    },
  ];

  const otherIds: string[] = [];
  for (const row of others) {
    const id = createPerson(row.name);
    otherIds.push(id);
    updatePerson(id, { ...row.meta, last_contact: daysAgo(row.days), quick_memories: row.memory }, "nett");
    addMemory(id, row.memory, {}, "manual");
  }

  const linkSource = (
    personId: string,
    connectorId: string,
    displayName: string,
    body: string,
    occurredAt: string,
  ) => {
    const identityId = randomUUID();
    const recordId = randomUUID();
    const conversationId = randomUUID();
    const communicationId = randomUUID();
    const now = occurredAt;
    db.prepare(`
      INSERT INTO source_identities
        (id, person_id, connector_id, external_id, display_name, raw_json, linked_by, confidence, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, '{}', 'existing', 0.95, ?, ?)
    `).run(identityId, personId, connectorId, `ext-${personId}-${connectorId}`, displayName, now, now);
    db.prepare(`
      INSERT INTO source_records
        (id, connector_id, external_id, source_identity_id, person_id, entity_type, raw_json, captured_at)
      VALUES (?, ?, ?, ?, ?, 'contact', '{}', ?)
    `).run(recordId, connectorId, `rec-${personId}-${connectorId}`, identityId, personId, now);
    db.prepare(`
      INSERT INTO conversations
        (id, connector_id, external_id, title, is_group, raw_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, '{}', ?, ?)
    `).run(conversationId, connectorId, `chat-${personId}-${connectorId}`, displayName, now, now);
    db.prepare(`
      INSERT INTO communications
        (id, connector_id, external_id, conversation_id, sender_identity_id, direction, kind, body, occurred_at, evidence_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'incoming', 'text', ?, ?, '{}', ?, ?)
    `).run(communicationId, connectorId, `msg-${communicationId}`, conversationId, identityId, body, occurredAt, occurredAt, occurredAt);
    db.prepare(`
      INSERT INTO communication_people (communication_id, person_id, role)
      VALUES (?, ?, 'participant')
    `).run(communicationId, personId);
  };

  linkSource(kendra, "messages", "Kendra Mysore", "Can you be home the week Dad is in town in September?", daysAgo(2, 19));
  linkSource(kendra, "whatsapp", "Kendra", "Sending the train times when I have them.", daysAgo(6, 14));
  linkSource(gilly, "whatsapp", "Gilly", "Might pass through later this month — dinner if you are around?", daysAgo(1, 21));
  linkSource(gilly, "messages", "Gilly Zaid", "That voice note was the one about the old joke from school.", daysAgo(3, 11));
  linkSource(otherIds[0], "messages", "Maya Chen", "Marked the sentence that actually mattered.", daysAgo(5, 16));

  setConnectorState("messages", {
    permission: "granted",
    status: "success",
    seen: 1842,
    linked: 126,
    error: null,
  });
  setConnectorState("whatsapp", {
    permission: "granted",
    status: "success",
    seen: 640,
    linked: 88,
    error: null,
  });

  const created = new Date().toISOString();
  db.prepare(`
    INSERT INTO inference_suggestions
      (id, person_id, field_name, proposed_value_json, current_value_json, evidence_json,
       rationale, confidence, model, status, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'pending', ?)
  `).run(
    randomUUID(),
    gilly,
    "interests",
    JSON.stringify(["photography"]),
    JSON.stringify({
      version: 2,
      evidence: [{ sourceType: "whatsapp", excerpt: "Might pass through later this month — dinner if you are around?" }],
    }),
    "Mentioned in a recent WhatsApp thread. Review before it is written.",
    0.81,
    "whatsapp",
    created,
  );
  db.prepare(`
    INSERT INTO inference_suggestions
      (id, person_id, field_name, proposed_value_json, current_value_json, evidence_json,
       rationale, confidence, model, status, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'pending', ?)
  `).run(
    randomUUID(),
    kendra,
    "follow_up_date",
    JSON.stringify("2026-09-08"),
    JSON.stringify({
      version: 2,
      evidence: [{ sourceType: "messages", excerpt: "Can you be home the week Dad is in town in September?" }],
    }),
    "September visit is in Messages. Confirm the date before it becomes a follow-up.",
    0.9,
    "messages",
    created,
  );

  refreshEvidenceIndex();
  db.close();

  return { dbPath, kendra, gilly };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  seedInvestorDemo().then((result) => {
    console.log(`Seeded ${result.dbPath}`);
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
