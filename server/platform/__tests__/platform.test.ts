import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { InMemoryCredentialVault } from "../security/credential-vault.js";
import { parseWhatsAppExport } from "../connectors/whatsapp-export.js";
import { openDatabase } from "../../migrations.js";
import { SqliteAtomicIngestion } from "../sqlite-ingestion.js";
import type { NormalizedSourceBundle } from "../domain.js";

test("in-memory vault copies and deletes secrets", async () => {
  const vault = new InMemoryCredentialVault();
  const source = new TextEncoder().encode("secret");
  await vault.set("token", source);
  source.fill(0);
  assert.equal(await vault.getString("token"), "secret");

  const first = await vault.get("token");
  first?.fill(0);
  assert.equal(await vault.getString("token"), "secret");
  assert.equal(await vault.delete("token"), true);
  assert.equal(await vault.get("token"), undefined);
});

test("WhatsApp exports normalize multiline records idempotently", () => {
  const text = [
    "[31/12/2025, 23:59:01] Josh: Happy new year",
    "from Nett",
    "[01/01/2026, 00:01:02] Alex: Thanks!",
    "[01/01/2026, 00:02:00] Messages are end-to-end encrypted."
  ].join("\n");
  const options = {
    accountId: "personal",
    conversationExternalId: "alex",
    selfNames: ["Josh"],
    dateOrder: "DMY" as const,
    capturedAt: "2026-01-01T00:05:00.000Z"
  };
  const first = parseWhatsAppExport(text, options);
  const second = parseWhatsAppExport(text, options);

  assert.equal(first.interactions.length, 3);
  assert.match(first.interactions[0].text ?? "", /from Nett/);
  assert.equal(first.interactions[0].direction, "outgoing");
  assert.equal(first.interactions[1].direction, "incoming");
  assert.equal(first.interactions[2].direction, "system");
  assert.deepEqual(
    first.interactions.map((item) => item.stableId),
    second.interactions.map((item) => item.stableId)
  );
});

test("SQLite ingestion links exact identities and remains idempotent", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nett-ingestion-"));
  const database = openDatabase(path.join(directory, "test.db"));
  try {
    database.prepare(`
      INSERT INTO people
        (id, preferred_name, first_name, last_name, avatar_seed, created_at, updated_at)
      VALUES ('person-alex', 'Alex Example', 'Alex', 'Example', 'alex', datetime('now'), datetime('now'))
    `).run();
    database.prepare(`
      INSERT INTO nett_metadata (person_id, created_at, updated_at)
      VALUES ('person-alex', datetime('now'), datetime('now'))
    `).run();
    database.prepare(`
      INSERT INTO contact_methods
        (id, person_id, kind, value, normalized_value, label, is_primary)
      VALUES ('method-alex', 'person-alex', 'email', 'alex@example.com', 'alex@example.com', 'test', 1)
    `).run();
    const bundle: NormalizedSourceBundle = {
      connectorId: "test-mail",
      accountId: "primary",
      batchId: "batch-1",
      capturedAt: "2026-07-15T12:00:00.000Z",
      identities: [
        {
          stableId: "identity-self",
          externalId: "self@example.com",
          source: "test-mail",
          displayName: "Self",
          addresses: [{ kind: "email", value: "self@example.com", normalized: "self@example.com" }],
          isSelf: true
        },
        {
          stableId: "identity-alex",
          externalId: "alex@example.com",
          source: "test-mail",
          displayName: "Alex Example",
          addresses: [{ kind: "email", value: "Alex@Example.com", normalized: "alex@example.com" }]
        }
      ],
      conversations: [{
        stableId: "conversation-1",
        externalId: "thread-1",
        source: "test-mail",
        kind: "direct",
        participants: [
          { identityStableId: "identity-self", role: "self" },
          { identityStableId: "identity-alex", role: "member" }
        ]
      }],
      interactions: [{
        stableId: "message-1",
        externalId: "message-1",
        conversationStableId: "conversation-1",
        senderIdentityStableId: "identity-alex",
        participantIdentityStableIds: ["identity-self", "identity-alex"],
        direction: "incoming",
        kind: "email",
        source: "test-mail",
        text: "Coffee next Tuesday?",
        occurredAt: "2026-07-14T18:30:00.000Z",
        attachments: []
      }],
      tombstones: [],
      nextCursor: {
        connectorId: "test-mail",
        scope: "primary",
        value: "cursor-1",
        version: 1,
        observedAt: "2026-07-15T12:00:00.000Z"
      },
      completeSnapshot: true
    };
    const ingestion = new SqliteAtomicIngestion(database);
    await ingestion.ingest(bundle);
    await ingestion.ingest({ ...bundle, batchId: "batch-2" });

    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM communications").get() as { count: number }).count, 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM interactions").get() as { count: number }).count, 1);
    assert.equal((database.prepare("SELECT person_id FROM source_identities WHERE external_id='alex@example.com'").get() as { person_id: string }).person_id, "person-alex");
    assert.equal((database.prepare("SELECT last_contact FROM nett_metadata WHERE person_id='person-alex'").get() as { last_contact: string }).last_contact, "2026-07-14T18:30:00.000Z");
    assert.equal((await ingestion.readCursor("test-mail", "primary"))?.value, "cursor-1");
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
