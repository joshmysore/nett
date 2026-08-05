import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { latestSchemaVersion } from "./migrations.js";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nett-test-"));
const testDatabasePath = path.join(temporaryDirectory, "nett.db");
const messagesPath = path.join(temporaryDirectory, "chat.db");
process.env.NETT_DB_PATH = testDatabasePath;
process.env.NETT_MESSAGES_DB = messagesPath;
process.env.NETT_PHONE_REGION = "US";

const dbModule = await import("./db.js");
const { connectors } = await import("./connectors.js");
const {
  applyLinkedInPublicProfile,
  normalizeLinkedInProfileUrl,
  previewLinkedInPublicProfile
} = await import("./enrichment/linkedin.js");
const {
  connectorStates,
  createDatabase,
  db,
  findExactPerson,
  getPeople,
  overview,
  getPerson,
  getPersonCommunications,
  mergeReviewQueue,
  normalizePhone,
  resolveMerge,
  upsertInteraction,
  upsertSourceContacts,
  updatePerson
} = dbModule;
const count = (database: Database.Database, sql: string) =>
  (database.prepare(sql).get() as { count: number }).count;

try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row: any) => row.name);
  for (const required of [
    "people", "source_identities", "nett_metadata", "interactions", "source_records",
    "schema_migrations", "conversations", "conversation_participants", "communications", "communication_people"
  ]) assert.ok(tables.includes(required), `missing table: ${required}`);
  assert.equal(db.pragma("user_version", { simple: true }), latestSchemaVersion);
  assert.equal(getPeople().length, 0, "a new production database must not auto-seed demo people");
  assert.ok(connectorStates().length >= 10, "connector registry should include implemented and future adapters");
  assert.ok(connectors.has("apple-contacts") && connectors.has("messages") && connectors.has("whatsapp"));

  const contactResult = upsertSourceContacts("apple-contacts", [{
    sourceId: "apple-alice",
    name: "Alice Test",
    phones: ["(415) 555-0100"],
    emails: ["ALICE@example.test"],
    notes: "Apple source note"
  }]);
  assert.equal(contactResult.created, 1);
  const alice = getPeople()[0] as any;
  const aliceCreated = getPerson(alice.id) as any;
  assert.equal(aliceCreated.gender, "female", "gender should auto-fill from the given-name table at creation");
  assert.ok(
    aliceCreated.provenance.some((row: any) => row.field_name === "gender" && row.connector_id === "name-inference"),
    "auto-filled gender must record name-inference provenance"
  );
  updatePerson(alice.id, { gender: "M" });
  assert.equal((getPerson(alice.id) as any).gender, "male", "gender shorthand must normalise to male");
  updatePerson(alice.id, { gender: "unrecognised text" });
  assert.equal((getPerson(alice.id) as any).gender, "", "unrecognised gender text must clear rather than store free text");
  updatePerson(alice.id, { gender: "f" });
  assert.equal((getPerson(alice.id) as any).gender, "female", "gender shorthand must normalise to female");
  updatePerson(alice.id, { notes: "Editable Nett note" });
  upsertSourceContacts("apple-contacts", [{
    sourceId: "apple-alice",
    name: "Alice Test",
    phones: ["+1 415 555 0100"],
    emails: ["alice@example.test"],
    notes: "Updated Apple source note"
  }]);
  const aliceFull = getPerson(alice.id) as any;
  assert.equal(aliceFull.notes, "Editable Nett note", "source notes must never overwrite editable Nett notes");
  assert.equal(aliceFull.provenance.filter((row: any) => row.field_name === "apple_note").length, 1);
  assert.equal(aliceFull.provenance.find((row: any) => row.field_name === "apple_note").field_value, "Updated Apple source note");
  assert.equal(findExactPerson([], ["415-555-0100"])?.person_id, alice.id);
  assert.equal(normalizePhone("+44 20 7946 0958"), "+442079460958");
  assert.notEqual(normalizePhone("+44 20 7946 0958"), normalizePhone("+1 207 946 0958"), "country codes must remain significant");

  const publicPreview = previewLinkedInPublicProfile({
    profileUrl: "https://www.linkedin.com/in/alice-test/?trk=public",
    publicText: "Alice Test\nResearch Lead at Example Labs\nGreater San Francisco Bay Area\n500+ connections"
  }, aliceFull);
  assert.equal(publicPreview.profileUrl, "https://www.linkedin.com/in/alice-test");
  assert.equal(publicPreview.suggestions.find((item) => item.field === "location")?.value, "Greater San Francisco Bay Area");
  assert.equal(publicPreview.suggestions.find((item) => item.field === "job_title")?.value, "Research Lead");
  assert.throws(() => normalizeLinkedInProfileUrl("https://www.linkedin.com/company/example"), /public LinkedIn profile URL/);
  await applyLinkedInPublicProfile(alice.id, {
    profileUrl: publicPreview.profileUrl,
    publicText: "Alice Test\nResearch Lead at Example Labs\nGreater San Francisco Bay Area",
    acceptedFields: ["headline", "job_title", "company", "location", "linkedin_url"]
  });
  const enrichedAlice = getPerson(alice.id) as any;
  assert.equal(enrichedAlice.location, "Greater San Francisco Bay Area");
  assert.equal(enrichedAlice.job_title, "Research Lead");
  assert.ok(enrichedAlice.sources.includes("linkedin-public"));
  assert.ok(enrichedAlice.provenance.some((row: any) => row.connector_id === "linkedin-public" && row.field_name === "location"));

  const interaction = {
    personId: alice.id,
    kind: "manual-test",
    occurredAt: "2026-01-01T12:00:00.000Z",
    summary: "first",
    sourceConnector: "fixture",
    sourceRecordId: "stable-1"
  };
  upsertInteraction(interaction);
  upsertInteraction({ ...interaction, summary: "updated" });
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM interactions WHERE source_connector='fixture'"), 1);
  assert.equal((db.prepare("SELECT summary FROM interactions WHERE source_connector='fixture'").get() as { summary: string }).summary, "updated");

  const source = new Database(messagesPath);
  source.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT NOT NULL);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, handle_id INTEGER, text TEXT, date INTEGER, is_from_me INTEGER NOT NULL);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT);
    CREATE TABLE chat_message_join (chat_id INTEGER NOT NULL, message_id INTEGER NOT NULL);
    CREATE TABLE chat_handle_join (chat_id INTEGER NOT NULL, handle_id INTEGER NOT NULL);
    INSERT INTO handle (ROWID, id) VALUES (1, '+14155550100'), (2, '+14155550999');
    INSERT INTO chat (ROWID, guid, chat_identifier, display_name) VALUES
      (1, 'chat-direct', 'direct', NULL),
      (2, 'chat-group', 'group', 'Fixture Group');
    INSERT INTO chat_handle_join (chat_id, handle_id) VALUES (1, 1), (2, 1), (2, 2);
    INSERT INTO message (ROWID, guid, handle_id, text, date, is_from_me) VALUES
      (1, 'message-1', 1, 'Incoming fixture', (strftime('%s','2026-02-01T12:00:00Z') - 978307200) * 1000000000, 0),
      (2, 'message-2', NULL, 'Outgoing fixture', (strftime('%s','2026-02-02T12:00:00Z') - 978307200) * 1000000000, 1),
      (3, 'message-3', 2, 'Group fixture', (strftime('%s','2026-02-03T12:00:00Z') - 978307200) * 1000000000, 0);
    INSERT INTO chat_message_join (chat_id, message_id) VALUES (1, 1), (1, 2), (2, 3);
  `);
  source.close();

  const firstSync = await connectors.get("messages")!.sync();
  assert.equal(firstSync.seen, 3);
  assert.equal(firstSync.linked, 3, "direct and group-aware records should link to known participants");
  const secondSync = await connectors.get("messages")!.sync();
  assert.equal(secondSync.seen, 0, "the ROWID cursor must make repeated sync idempotent");
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM communications"), 3);
  assert.equal(count(db, "SELECT COUNT(*) AS count FROM interactions WHERE source_connector='messages'"), 3);
  const communicationPage = getPersonCommunications(alice.id, { limit: 2 });
  assert.equal(communicationPage.items.length, 2);
  assert.ok(communicationPage.nextCursor);
  assert.equal(getPersonCommunications(alice.id, { limit: 2, cursor: communicationPage.nextCursor! }).items.length, 1);
  const unknownHandle = mergeReviewQueue().find((item: any) => item.displayName === "+14155550999" && item.candidates.length === 0);
  assert.ok(unknownHandle);
  const resolvedHandlePerson = resolveMerge(unknownHandle.sourceIdentityId, undefined, true) as any;
  assert.equal(getPersonCommunications(resolvedHandlePerson.id).items.length, 1, "merge review should backfill message history");

  const csv = parse("name,company\nDaria Solberg,Example Labs\n", { columns: true, skip_empty_lines: true }) as { name: string }[];
  assert.equal(csv[0].name, "Daria Solberg");

  const insertPerson = db.prepare(
    "INSERT INTO people (id, preferred_name, avatar_seed, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))"
  );
  const insertMetadata = db.prepare(
    "INSERT INTO nett_metadata (person_id, location, industry, priority, relationship_strength, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
  );
  db.transaction(() => {
    for (let index = 0; index < 1_200; index++) {
      const id = `scale-${index}`;
      insertPerson.run(id, `Scale Person ${index}`, id);
      insertMetadata.run(id, index % 3 ? "New York" : null, index % 4 ? "Technology" : null, index % 11, index % 101);
    }
  })();
  const overviewStartedAt = performance.now();
  const scaledOverview = overview() as any;
  const overviewElapsed = performance.now() - overviewStartedAt;
  assert.equal(scaledOverview.total, 1_202);
  assert.ok(scaledOverview.people.length <= 360, "dashboard must hydrate a bounded working set");
  assert.ok(overviewElapsed < 1_500, `dashboard aggregation took ${overviewElapsed.toFixed(1)}ms`);

  const legacyPath = path.join(temporaryDirectory, "legacy.db");
  const legacy = new Database(legacyPath);
  legacy.exec(`
    CREATE TABLE people (
      id TEXT PRIMARY KEY, preferred_name TEXT NOT NULL, first_name TEXT, last_name TEXT,
      nickname TEXT, avatar_seed TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE interactions (
      id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT, source_connector TEXT NOT NULL,
      source_record_id TEXT, evidence_json TEXT NOT NULL DEFAULT '{}'
    );
    INSERT INTO people VALUES ('person-1','Demo',NULL,NULL,NULL,NULL,'now','now');
    INSERT INTO people VALUES ('real-contact','Real',NULL,NULL,NULL,NULL,'now','now');
    INSERT INTO interactions VALUES ('duplicate-1','real-contact','message','2026-01-01','one','messages','same','{}');
    INSERT INTO interactions VALUES ('duplicate-2','real-contact','message','2026-01-01','two','messages','same','{}');
  `);
  legacy.close();
  const migrated = createDatabase(legacyPath);
  assert.equal(count(migrated, "SELECT COUNT(*) AS count FROM people WHERE id='person-1'"), 0);
  assert.equal(count(migrated, "SELECT COUNT(*) AS count FROM people WHERE id='real-contact'"), 1);
  assert.equal(count(migrated, "SELECT COUNT(*) AS count FROM interactions"), 1);
  assert.equal(migrated.pragma("user_version", { simple: true }), latestSchemaVersion);
  assert.ok(
    readdirSync(temporaryDirectory).some((name) => name.startsWith("legacy.db.backup-v0-")),
    "existing databases should be backed up before migration"
  );
  migrated.close();

  console.log(`Nett isolated tests passed: ${tables.length} tables, incremental Messages and migrations verified.`);
} finally {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
