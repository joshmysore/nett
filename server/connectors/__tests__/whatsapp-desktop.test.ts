import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nett-whatsapp-"));
const archivePath = path.join(temporaryDirectory, "wacrawl.db");
process.env.NETT_DB_PATH = path.join(temporaryDirectory, "nett.db");
process.env.NETT_WACRAWL_DB = archivePath;
process.env.NETT_WACRAWL_BIN = "/nonexistent/wacrawl";

const {
  phoneFromWhatsAppJid,
  isWhatsAppGroupJid,
  whatsappDesktopConnector
} = await import("../whatsapp-desktop.js");
const { createPerson, db, findExactPerson, getPerson, normalizePhone } = await import("../../db.js");

test.after(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("phoneFromWhatsAppJid extracts E.164-capable phones from user JIDs", () => {
  assert.equal(phoneFromWhatsAppJid("14155550100@s.whatsapp.net"), normalizePhone("+14155550100"));
  assert.equal(phoneFromWhatsAppJid("918588976477@s.whatsapp.net"), normalizePhone("+918588976477"));
  assert.equal(phoneFromWhatsAppJid("120363158426018029@g.us"), null);
  assert.equal(phoneFromWhatsAppJid("status@broadcast"), null);
  assert.equal(phoneFromWhatsAppJid("11923013783672@lid"), null);
  assert.equal(isWhatsAppGroupJid("120363158426018029@g.us"), true);
  assert.equal(isWhatsAppGroupJid("14155550100@s.whatsapp.net"), false);
});

test("WhatsApp desktop connector links DMs by phone and is cursor-idempotent", async () => {
  const personId = createPerson("Alice Fixture");
  const phone = phoneFromWhatsAppJid("14155550100@s.whatsapp.net");
  assert.ok(phone);
  db.prepare(`
    INSERT INTO contact_methods (id, person_id, kind, value, normalized_value)
    VALUES (?, ?, 'phone', ?, ?)
  `).run("method-alice-phone", personId, "+14155550100", phone);
  assert.ok(findExactPerson([], ["+14155550100"])?.person_id);

  const archive = new Database(archivePath);
  archive.exec(`
    CREATE TABLE chats (
      jid TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT,
      last_message_at INTEGER,
      unread_count INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      removed INTEGER NOT NULL DEFAULT 0,
      hidden INTEGER NOT NULL DEFAULT 0,
      raw_session_type INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE contacts (
      jid TEXT PRIMARY KEY,
      phone TEXT,
      full_name TEXT,
      first_name TEXT,
      last_name TEXT,
      business_name TEXT,
      username TEXT,
      lid TEXT,
      about_text TEXT,
      updated_at INTEGER
    );
    CREATE TABLE group_participants (
      group_jid TEXT NOT NULL,
      user_jid TEXT NOT NULL,
      contact_name TEXT,
      first_name TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(group_jid, user_jid)
    );
    CREATE TABLE messages (
      rowid INTEGER PRIMARY KEY,
      source_pk INTEGER NOT NULL,
      chat_jid TEXT NOT NULL,
      chat_name TEXT,
      msg_id TEXT NOT NULL,
      sender_jid TEXT,
      sender_name TEXT,
      ts INTEGER NOT NULL,
      from_me INTEGER NOT NULL,
      text TEXT,
      raw_type INTEGER NOT NULL DEFAULT 0,
      message_type TEXT,
      media_type TEXT,
      media_title TEXT,
      media_path TEXT,
      media_url TEXT,
      media_size INTEGER,
      starred INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO chats (jid, kind, name) VALUES
      ('14155550100@s.whatsapp.net', 'dm', 'Alice Fixture'),
      ('120363158426018029@g.us', 'group', 'Fixture Group');
    INSERT INTO contacts (jid, phone, full_name) VALUES
      ('14155550100@s.whatsapp.net', '+14155550100', 'Alice Fixture'),
      ('14155550999@s.whatsapp.net', '+14155550999', 'Unknown Contact');
    INSERT INTO group_participants (group_jid, user_jid, is_active) VALUES
      ('120363158426018029@g.us', '14155550100@s.whatsapp.net', 1),
      ('120363158426018029@g.us', '14155550999@s.whatsapp.net', 1);
    INSERT INTO messages (rowid, source_pk, chat_jid, chat_name, msg_id, sender_jid, sender_name, ts, from_me, text, message_type) VALUES
      (1, 100, '14155550100@s.whatsapp.net', 'Alice Fixture', 'm1', '14155550100@s.whatsapp.net', 'Alice', 1700000000, 0, 'Incoming WhatsApp', 'text'),
      (2, 101, '14155550100@s.whatsapp.net', 'Alice Fixture', 'm2', '14155550100@s.whatsapp.net', 'Alice', 1700000060, 1, 'Outgoing WhatsApp', 'text'),
      (3, 102, '120363158426018029@g.us', 'Fixture Group', 'm3', '14155550100@s.whatsapp.net', 'Alice', 1700000120, 0, 'Group WhatsApp', 'text');
  `);
  archive.close();

  const first = await whatsappDesktopConnector.sync();
  assert.equal(first.seen, 3);
  assert.ok(first.linked >= 2, "DM and group messages for Alice should link");
  const second = await whatsappDesktopConnector.sync();
  assert.equal(second.seen, 0, "rowid cursor must make repeated sync idempotent");

  assert.ok(getPerson(personId));
  const interactions = db.prepare(
    "SELECT COUNT(*) AS count FROM interactions WHERE person_id=? AND source_connector='whatsapp'"
  ).get(personId) as { count: number };
  assert.ok(interactions.count >= 2);

  const communications = db.prepare(
    "SELECT COUNT(*) AS count FROM communications WHERE connector_id='whatsapp'"
  ).get() as { count: number };
  assert.equal(communications.count, 3);
});
