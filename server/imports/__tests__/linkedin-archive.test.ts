/**
 * Every test runs against a throwaway database. `NETT_DB_PATH` is redirected
 * into a temporary directory before anything that touches `server/db.ts` is
 * imported, and the redirect is asserted before the first import, so the real
 * `data/nett.db` can never be opened by this file.
 */
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { zipSync } from "fflate";
import type DatabaseType from "better-sqlite3";

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), `nett-linkedin-${randomUUID()}-`));
process.env.NETT_DB_PATH = path.join(temporaryDirectory, "singleton.db");
process.env.NETT_MESSAGES_DB = path.join(temporaryDirectory, "chat.db");

const { databasePath } = await import("../../db.js");
assert.equal(
  path.resolve(databasePath),
  path.resolve(process.env.NETT_DB_PATH),
  "the shared database must resolve to the temporary path"
);
assert.ok(
  path.resolve(databasePath).startsWith(path.resolve(os.tmpdir())),
  `refusing to run: the shared database is not inside the temporary directory (${databasePath})`
);

const { openDatabase } = await import("../../migrations.js");
const {
  LINKEDIN_ARCHIVE_CONNECTOR_ID,
  LINKEDIN_ARCHIVE_CONTENTS,
  canonicalizeArchiveProfileUrl,
  getLinkedInArchiveImport,
  importLinkedInArchive,
  listLinkedInArchiveImportRows,
  parseLinkedInConnectedOn,
  parseLinkedInConnections,
  previewLinkedInArchive
} = await import("../linkedin-archive.js");

const BOM = "\uFEFF";
const fixtureText = readFileSync(new URL("../fixtures/connections-sample.csv", import.meta.url), "utf8");
const fixtureBytes = new TextEncoder().encode(BOM + fixtureText);
const fixtureFile = { filename: "Connections.csv", bytes: fixtureBytes };

const openDatabases: DatabaseType.Database[] = [];
function freshDatabase(): DatabaseType.Database {
  const database = openDatabase(path.join(temporaryDirectory, `${randomUUID()}.db`));
  openDatabases.push(database);
  return database;
}

after(() => {
  for (const database of openDatabases) {
    try { database.close(); } catch { /* already closed */ }
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function count(database: DatabaseType.Database, sql: string, ...values: unknown[]): number {
  return (database.prepare(sql).get(...(values as never[])) as { count: number }).count;
}

function snapshot(database: DatabaseType.Database) {
  return {
    people: count(database, "SELECT COUNT(*) AS count FROM people"),
    contactMethods: count(database, "SELECT COUNT(*) AS count FROM contact_methods"),
    sourceIdentities: count(database, "SELECT COUNT(*) AS count FROM source_identities"),
    sourceRecords: count(database, "SELECT COUNT(*) AS count FROM source_records"),
    memories: count(database, "SELECT COUNT(*) AS count FROM memories"),
    provenance: count(database, "SELECT COUNT(*) AS count FROM field_provenance"),
    suggestions: count(database, "SELECT COUNT(*) AS count FROM inference_suggestions")
  };
}

function seedPerson(
  database: DatabaseType.Database,
  input: { name: string; email?: string; company?: string; jobTitle?: string; linkedinUrl?: string }
): string {
  const id = randomUUID();
  database.prepare(`
    INSERT INTO people (id, preferred_name, avatar_seed, created_at, updated_at)
    VALUES (?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, input.name, id);
  database.prepare(`
    INSERT INTO nett_metadata (person_id, company, job_title, linkedin_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(id, input.company ?? null, input.jobTitle ?? null, input.linkedinUrl ?? null);
  if (input.email) {
    database.prepare(`
      INSERT INTO contact_methods (id, person_id, kind, value, normalized_value, is_primary)
      VALUES (?, ?, 'email', ?, ?, 0)
    `).run(randomUUID(), id, input.email, input.email.toLocaleLowerCase());
  }
  return id;
}

function csvFile(body: string, filename = "Connections.csv") {
  const text = [
    "Notes:",
    '"Synthetic fixture."',
    "",
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
    body
  ].join("\n");
  return { filename, bytes: new TextEncoder().encode(BOM + text) };
}

test("parses a realistic Connections.csv with preamble, BOM, quotes, and mixed scripts", () => {
  const parsed = parseLinkedInConnections(fixtureFile);

  assert.equal(parsed.entryName, null);
  assert.equal(parsed.preambleLines, 3, "the header must be detected, not assumed to be at a fixed offset");
  assert.deepEqual(parsed.headers, [
    "First Name", "Last Name", "URL", "Email Address", "Company", "Position", "Connected On"
  ]);
  assert.equal(parsed.rows.length, 6);
  assert.equal(parsed.skippedEmptyRows, 1, "the empty trailing row must not become a person");

  const [ada, zoe, chan, priya, sam, picard] = parsed.rows;

  assert.equal(ada.firstName, "Ada", "the UTF-8 BOM must not leak into the first cell");
  assert.equal(ada.email, "ada.lovelace@example.test");
  assert.equal(ada.connectedOn, "2024-03-21");
  assert.equal(ada.profileUrl, "https://www.linkedin.com/in/ada-lovelace-synthetic");

  assert.equal(zoe.fullName, "Zoë Müller");
  assert.equal(zoe.company, "Müller, Braun & Co.", "a quoted field containing a comma must stay intact");
  assert.equal(zoe.email, null, "LinkedIn omits most email addresses");
  assert.equal(zoe.connectedOn, "2024-03-21", "03/21/24 is LinkedIn's US month-first form");

  assert.equal(chan.fullName, "陳 大文");
  assert.equal(chan.connectedOn, "2023-02-02");

  assert.equal(
    priya.profileUrl,
    "https://www.linkedin.com/in/priya-raman-synthetic",
    "the URL is canonicalised and nothing else is read from it"
  );
  assert.equal(priya.position, "Engineer, Platform");
  assert.equal(priya.connectedOn, null, "an unparseable date must not be guessed");
  assert.equal(priya.connectedOnRaw, "not a date", "the raw cell is kept even when it cannot be parsed");

  assert.equal(sam.profileUrl, null);
  assert.equal(sam.email, "sam.okafor@example.test");

  assert.equal(picard.lastName, "Picard 🚀");
  assert.deepEqual(picard.raw, {
    "First Name": "Jean-Luc",
    "Last Name": "Picard 🚀",
    URL: "https://www.linkedin.com/in/jean-luc-picard-synthetic",
    "Email Address": "",
    Company: "Starfleet",
    Position: "Captain",
    "Connected On": "1 Jan 2020"
  });

  assert.equal(parsed.rowsWithEmail, 3);
  assert.equal(parsed.rowsWithProfileUrl, 5);
  assert.equal(parsed.rowsWithUnparsedDate, 1);
});

test("parses the same content inside a Download-your-data zip", () => {
  const archive = zipSync({
    "Basic_LinkedIn_Data_Export_2026/Profile.csv": new TextEncoder().encode("First Name,Last Name\nJosh,Example\n"),
    "Basic_LinkedIn_Data_Export_2026/Connections.csv": fixtureBytes,
    "__MACOSX/._Connections.csv": new TextEncoder().encode("junk")
  });
  const parsed = parseLinkedInConnections({ filename: "Basic_LinkedIn_Data_Export.zip", bytes: archive });

  assert.equal(parsed.entryName, "Basic_LinkedIn_Data_Export_2026/Connections.csv");
  assert.equal(parsed.rows.length, 6);
  assert.deepEqual(
    parsed.rows.map((row) => row.contentHash),
    parseLinkedInConnections(fixtureFile).rows.map((row) => row.contentHash),
    "the zip and the bare CSV must produce identical row hashes"
  );
});

test("a zip without Connections.csv fails with an actionable message", () => {
  const archive = zipSync({ "Export/Profile.csv": new TextEncoder().encode("a,b\n1,2\n") });
  assert.throws(
    () => parseLinkedInConnections({ filename: "export.zip", bytes: archive }),
    /does not contain Connections\.csv/
  );
});

test("dates are parsed defensively and never guessed", () => {
  assert.equal(parseLinkedInConnectedOn("21 Mar 2024"), "2024-03-21");
  assert.equal(parseLinkedInConnectedOn("03/21/24"), "2024-03-21");
  assert.equal(parseLinkedInConnectedOn("21/03/2024"), "2024-03-21", "a first component above 12 can only be a day");
  assert.equal(parseLinkedInConnectedOn("2024-03-21"), "2024-03-21");
  assert.equal(parseLinkedInConnectedOn("Mar 21, 2024"), "2024-03-21");
  assert.equal(parseLinkedInConnectedOn("31 Feb 2024"), null);
  assert.equal(parseLinkedInConnectedOn("sometime last spring"), null);
  assert.equal(parseLinkedInConnectedOn(""), null);
});

test("only personal profile URLs are canonicalised, and nothing is inferred from them", () => {
  assert.equal(
    canonicalizeArchiveProfileUrl("http://www.linkedin.com/in/example-person/?trk=export"),
    "https://www.linkedin.com/in/example-person"
  );
  assert.equal(canonicalizeArchiveProfileUrl("https://www.linkedin.com/company/example"), null);
  assert.equal(canonicalizeArchiveProfileUrl(""), null);
});

test("re-importing the identical file is a reported no-op", () => {
  const database = freshDatabase();

  const first = importLinkedInArchive(fixtureFile, { database });
  assert.equal(first.duplicate, false);
  assert.equal(first.rows, 6);
  assert.equal(first.created, 6);
  const afterFirst = snapshot(database);
  assert.equal(afterFirst.people, 6);
  assert.equal(afterFirst.contactMethods, 3, "only the three shared email addresses become contact methods");
  assert.equal(afterFirst.sourceIdentities, 6);

  const second = importLinkedInArchive(fixtureFile, { database });
  assert.equal(second.duplicate, true, "the file hash must short-circuit the second run");
  assert.equal(second.importId, first.importId);
  assert.deepEqual(snapshot(database), afterFirst);

  assert.equal(
    count(database, "SELECT COUNT(*) AS count FROM imports WHERE status='committed'"),
    1,
    "a duplicate file must not create a second import run"
  );
});

test("the same rows arriving in a different file are recognised by content hash", () => {
  const database = freshDatabase();
  importLinkedInArchive(fixtureFile, { database });
  const afterFirst = snapshot(database);

  const zipped = {
    filename: "Basic_LinkedIn_Data_Export.zip",
    bytes: zipSync({ "Basic_LinkedIn_Data_Export/Connections.csv": fixtureBytes })
  };
  const second = importLinkedInArchive(zipped, { database });

  assert.equal(second.duplicate, false, "different bytes are a different file");
  assert.equal(second.duplicateRows, 6, "but every row is already applied");
  assert.equal(second.created, 0);
  assert.equal(second.merged, 0);
  assert.deepEqual(snapshot(database), afterFirst, "row-level idempotency must leave the database untouched");
});

test("every source row is preserved verbatim in imported_rows", () => {
  const database = freshDatabase();
  const result = importLinkedInArchive(fixtureFile, { database });

  const stored = listLinkedInArchiveImportRows(result.importId, { database, limit: 200 });
  assert.equal(stored.total, 6);
  assert.deepEqual(stored.rows[0].raw, {
    "First Name": "Ada",
    "Last Name": "Lovelace",
    URL: "https://www.linkedin.com/in/ada-lovelace-synthetic",
    "Email Address": "ada.lovelace@example.test",
    Company: "Analytical Engines",
    Position: "Chief Mathematician",
    "Connected On": "21 Mar 2024"
  });
  assert.deepEqual(
    stored.rows.map((row) => row.rowNumber),
    [1, 2, 3, 4, 5, 6]
  );

  const record = getLinkedInArchiveImport(result.importId, { database });
  assert.equal(record?.status, "committed");
  assert.equal(record?.rowCount, 6);
  assert.equal(record?.filename, "Connections.csv");
});

test("raw rows survive a run that fails part-way through", () => {
  const database = freshDatabase();
  let calls = 0;
  const now = () => {
    calls++;
    if (calls === 3) throw new Error("injected failure");
    return new Date(Date.UTC(2026, 6, 31, 10, calls)).toISOString();
  };

  assert.throws(() => importLinkedInArchive(fixtureFile, { database, now }), /injected failure/);

  assert.equal(count(database, "SELECT COUNT(*) AS count FROM imported_rows"), 6, "raw rows must outlive the failure");
  assert.equal(count(database, "SELECT COUNT(*) AS count FROM imported_rows WHERE status='pending'"), 6);
  assert.equal(count(database, "SELECT COUNT(*) AS count FROM people"), 0, "the apply phase must roll back completely");
  assert.equal(count(database, "SELECT COUNT(*) AS count FROM imports WHERE status='failed'"), 1);

  const failed = database.prepare("SELECT summary_json FROM imports").get() as { summary_json: string };
  assert.match(JSON.parse(failed.summary_json).error, /injected failure/);
});

test("an exact email match links to the existing person", () => {
  const database = freshDatabase();
  const personId = seedPerson(database, { name: "A. Lovelace", email: "ADA.Lovelace@example.test" });

  const result = importLinkedInArchive(fixtureFile, { database });
  const row = listLinkedInArchiveImportRows(result.importId, { database, limit: 200 }).rows[0];

  assert.equal(row.matchMethod, "exact-email");
  assert.equal(row.matchedPersonId, personId);
  assert.equal(row.status, "merged");
  assert.equal(
    count(database, "SELECT COUNT(*) AS count FROM people"),
    6,
    "one match plus five new people"
  );
  assert.equal(
    (database.prepare("SELECT preferred_name FROM people WHERE id=?").get(personId) as { preferred_name: string }).preferred_name,
    "A. Lovelace",
    "an import must never rename an existing person"
  );
});

test("a profile URL already recorded for a person links without a name match", () => {
  const database = freshDatabase();
  const personId = seedPerson(database, {
    name: "Someone Entirely Different",
    linkedinUrl: "https://www.linkedin.com/in/zoe-muller-synthetic/"
  });

  const result = importLinkedInArchive(fixtureFile, { database });
  const row = listLinkedInArchiveImportRows(result.importId, { database, limit: 200 }).rows[1];

  assert.equal(row.matchMethod, "profile-url");
  assert.equal(row.matchedPersonId, personId);
  assert.equal(
    (database.prepare("SELECT company FROM nett_metadata WHERE person_id=?").get(personId) as { company: string }).company,
    "Müller, Braun & Co."
  );
});

test("a name that is unique in the file and the database links; anything ambiguous goes to review", () => {
  const database = freshDatabase();
  const samId = seedPerson(database, { name: "Sam Okafor" });
  seedPerson(database, { name: "Jean-Luc Picard" });
  seedPerson(database, { name: "Jean-Luc Picard" });

  const result = importLinkedInArchive(fixtureFile, { database });
  const rows = listLinkedInArchiveImportRows(result.importId, { database, limit: 200 }).rows;

  const sam = rows[4];
  assert.equal(sam.matchMethod, "unique-exact-name");
  assert.equal(sam.matchedPersonId, samId);

  const picard = rows[5];
  assert.equal(picard.matchMethod, "ambiguous-exact-name");
  assert.equal(picard.status, "review");
  assert.equal(picard.matchedPersonId, null, "an ambiguous name must never merge automatically");
  assert.equal(
    count(
      database,
      "SELECT COUNT(*) AS count FROM merge_suggestions WHERE source_identity_id=? AND status='pending'",
      picard.sourceIdentityId
    ),
    2,
    "both candidates are offered to the reviewer"
  );
  const identity = database.prepare("SELECT person_id, linked_by FROM source_identities WHERE id=?")
    .get(picard.sourceIdentityId) as { person_id: string | null; linked_by: string };
  assert.equal(identity.person_id, null, "the identity stays unlinked so it appears in the merge queue");
  assert.equal(identity.linked_by, "unlinked");
});

test("a name duplicated inside the file routes to review even when the database is unambiguous", () => {
  const database = freshDatabase();
  const personId = seedPerson(database, { name: "Robin Vale" });
  const file = csvFile([
    "Robin,Vale,https://www.linkedin.com/in/robin-vale-one,,North Labs,Analyst,4 Apr 2021",
    "Robin,Vale,https://www.linkedin.com/in/robin-vale-two,,South Labs,Analyst,5 May 2022"
  ].join("\n"));

  const result = importLinkedInArchive(file, { database });

  assert.equal(result.review, 2);
  assert.equal(result.merged, 0);
  assert.equal(result.created, 0);
  assert.equal(
    (database.prepare("SELECT company FROM nett_metadata WHERE person_id=?").get(personId) as { company: string | null }).company,
    null,
    "nothing is written to the candidate while the rows are unresolved"
  );
  assert.ok(result.results.every((row) => row.method === "duplicate-name-in-file"));
});

test("one email held by two people routes to review", () => {
  const database = freshDatabase();
  seedPerson(database, { name: "Sam One", email: "sam.okafor@example.test" });
  seedPerson(database, { name: "Sam Two", email: "sam.okafor@example.test" });

  const result = importLinkedInArchive(fixtureFile, { database });
  const row = listLinkedInArchiveImportRows(result.importId, { database, limit: 200 }).rows[4];

  assert.equal(row.matchMethod, "ambiguous-email");
  assert.equal(row.status, "review");
  assert.equal(row.matchedPersonId, null);
});

test("a conflicting company keeps the existing value and records the conflict", () => {
  const database = freshDatabase();
  const personId = seedPerson(database, {
    name: "A. Lovelace",
    email: "ada.lovelace@example.test",
    company: "Difference Engines"
  });

  const result = importLinkedInArchive(fixtureFile, { database });

  const stored = database.prepare("SELECT company, job_title FROM nett_metadata WHERE person_id=?")
    .get(personId) as { company: string; job_title: string | null };
  assert.equal(stored.company, "Difference Engines", "an existing value is never overwritten");
  assert.equal(stored.job_title, "Chief Mathematician", "a blank field is still filled");

  assert.equal(result.conflicts, 1);
  const conflictRow = result.results.find((row) => row.rowNumber === 1);
  assert.deepEqual(conflictRow?.conflicts, [
    { field: "company", existing: "Difference Engines", incoming: "Analytical Engines" }
  ]);

  const detail = listLinkedInArchiveImportRows(result.importId, { database, limit: 200 }).rows[0].detail as {
    previous: Record<string, string | null>;
    applied: Record<string, string>;
    conflicts: { field: string }[];
  };
  assert.deepEqual(detail.conflicts, [
    { field: "company", existing: "Difference Engines", incoming: "Analytical Engines" }
  ]);
  assert.equal(detail.applied.job_title, "Chief Mathematician");
  assert.equal(detail.previous.job_title, null, "the previous value is recorded so the change is reversible");

  const suggestion = database.prepare(`
    SELECT field_name, proposed_value_json, current_value_json, status, model
    FROM inference_suggestions WHERE person_id=?
  `).get(personId) as Record<string, string>;
  assert.equal(suggestion.field_name, "company");
  assert.equal(suggestion.model, LINKEDIN_ARCHIVE_CONNECTOR_ID);
  assert.equal(suggestion.status, "pending");
  assert.equal(JSON.parse(suggestion.proposed_value_json), "Analytical Engines");
  assert.equal(JSON.parse(suggestion.current_value_json), "Difference Engines");
});

test("provenance is written for every fact the archive supplied", () => {
  const database = freshDatabase();
  const result = importLinkedInArchive(fixtureFile, { database });
  const personId = listLinkedInArchiveImportRows(result.importId, { database, limit: 200 }).rows[0].matchedPersonId!;

  const provenance = database.prepare(`
    SELECT field_name, field_value, connector_id, source_record_id, confidence, observed_at
    FROM field_provenance WHERE person_id=? ORDER BY field_name
  `).all(personId) as Record<string, any>[];

  assert.deepEqual(
    provenance.map((row) => row.field_name),
    ["company", "email", "job_title", "linkedin_connected_on", "linkedin_url"]
  );
  assert.ok(provenance.every((row) => row.connector_id === LINKEDIN_ARCHIVE_CONNECTOR_ID));
  assert.ok(provenance.every((row) => row.source_record_id === "https://www.linkedin.com/in/ada-lovelace-synthetic"));
  assert.equal(
    provenance.find((row) => row.field_name === "linkedin_connected_on")?.observed_at,
    "2024-03-21T00:00:00.000Z",
    "the connection date is the observation date for the connection itself"
  );

  const evidence = database.prepare(`
    SELECT raw_json FROM source_records WHERE connector_id=? AND person_id=?
  `).get(LINKEDIN_ARCHIVE_CONNECTOR_ID, personId) as { raw_json: string };
  assert.equal(JSON.parse(evidence.raw_json).raw["Connected On"], "21 Mar 2024");
});

test("the preview reads the file without writing anything", () => {
  const database = freshDatabase();
  const before = snapshot(database);

  const preview = previewLinkedInArchive(fixtureFile, { database });

  assert.deepEqual(snapshot(database), before);
  assert.equal(count(database, "SELECT COUNT(*) AS count FROM imports"), 0);
  assert.equal(preview.rows, 6);
  assert.equal(preview.rowsWithEmail, 3);
  assert.equal(preview.alreadyImported, null);
  assert.equal(preview.sample.length, 6);
  assert.ok(preview.contents.notProvided.includes("Location"));

  importLinkedInArchive(fixtureFile, { database });
  assert.ok(previewLinkedInArchive(fixtureFile, { database }).alreadyImported, "a repeat upload is flagged before it runs");
});

test("the archive's real contents are declared, and absent fields are never invented", () => {
  const database = freshDatabase();
  importLinkedInArchive(fixtureFile, { database });

  const metadata = database.prepare(`
    SELECT location, hometown, languages, institutions, interests, skills, birthday, relationship
    FROM nett_metadata
  `).all() as Record<string, unknown>[];
  for (const row of metadata) {
    for (const [field, value] of Object.entries(row)) {
      assert.equal(value, null, `the Connections export carries no ${field}, so it must stay empty`);
    }
  }
  assert.equal(count(database, "SELECT COUNT(*) AS count FROM contact_methods WHERE kind='phone'"), 0);
  assert.ok(LINKEDIN_ARCHIVE_CONTENTS.notProvided.length > 0);
});
