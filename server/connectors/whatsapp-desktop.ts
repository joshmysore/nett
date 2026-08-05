import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  connectorSettings,
  db,
  findExactPerson,
  normalizePhone,
  rollupLastContact,
  setConnectorState,
  updateConnectorSettings,
  upsertInteraction
} from "../db.js";
import { describeWhatsAppMessage } from "./message-body.js";

export type WhatsAppSyncOptions = {
  maxBatches?: number;
  signal?: AbortSignal;
};

export type WhatsAppSyncResult = {
  seen: number;
  linked: number;
  message: string;
  done?: boolean;
  cursor?: number;
  batchesCompleted?: number;
  totalSeen?: number;
};

const execFileAsync = promisify(execFile);

const defaultDesktopSource = path.join(
  homedir(),
  "Library",
  "Group Containers",
  "group.net.whatsapp.WhatsApp.shared"
);
const importsDir = path.resolve(process.cwd(), "data", "imports");
const defaultArchivePath = path.join(importsDir, "wacrawl.db");
const vendoredBinary = path.resolve(process.cwd(), "tools", "bin", "wacrawl");

export type WacrawlDoctor = {
  desktop?: {
    available?: boolean;
    path?: string;
    message_rows?: number;
    chat_rows?: number;
    contact_rows?: number;
    oldest_message?: string;
    newest_message?: string;
  };
  db_path?: string;
};

export type WacrawlStatus = {
  db_path?: string;
  chats?: number;
  contacts?: number;
  messages?: number;
  oldest_message?: string;
  newest_message?: string;
  last_import_at?: string;
  last_source?: string;
};

type WhatsAppMessageRow = {
  rowid: number;
  source_pk: number;
  chat_jid: string;
  chat_name: string | null;
  msg_id: string;
  sender_jid: string | null;
  sender_name: string | null;
  ts: number;
  from_me: number;
  text: string | null;
  message_type: string | null;
  chat_kind: string | null;
};

/** Extract a dialable phone from a WhatsApp user JID. Groups and LIDs return null. */
export function phoneFromWhatsAppJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const trimmed = jid.trim().toLowerCase();
  if (!trimmed.includes("@")) return null;
  const [local, domain] = trimmed.split("@");
  if (!local || !/^\d+$/.test(local)) return null;
  if (domain !== "s.whatsapp.net" && domain !== "c.us") return null;
  return normalizePhone(`+${local}`) || normalizePhone(local) || null;
}

export function isWhatsAppGroupJid(jid: string | null | undefined): boolean {
  return Boolean(jid?.toLowerCase().endsWith("@g.us"));
}

export function resolveWacrawlBinary(): string | null {
  const configured = process.env.NETT_WACRAWL_BIN?.trim();
  if (configured && existsSync(configured)) return configured;
  if (existsSync(vendoredBinary)) return vendoredBinary;
  return null;
}

export function resolveWacrawlArchivePath(): string {
  if (process.env.NETT_WACRAWL_DB?.trim()) return path.resolve(process.env.NETT_WACRAWL_DB.trim());
  return defaultArchivePath;
}

export function resolveWhatsAppDesktopSource(): string {
  if (process.env.NETT_WHATSAPP_SOURCE?.trim()) {
    return path.resolve(process.env.NETT_WHATSAPP_SOURCE.trim());
  }
  return defaultDesktopSource;
}

async function whichBinary(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/which", [name], { timeout: 5_000 });
    const found = stdout.trim();
    return found && existsSync(found) ? found : null;
  } catch {
    return null;
  }
}

export async function findWacrawlBinary(): Promise<string | null> {
  return resolveWacrawlBinary() ?? (await whichBinary("wacrawl"));
}

async function runWacrawlJson<T>(
  binary: string,
  args: string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  const { stdout, stderr } = await execFileAsync(binary, ["--json", ...args], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs ?? 120_000,
    signal: options.signal
  });
  const text = stdout.trim() || stderr.trim();
  if (!text) throw new Error("wacrawl returned empty output");
  return JSON.parse(text) as T;
}

async function runWacrawl(
  binary: string,
  args: string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(binary, args, {
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeoutMs ?? 300_000,
    signal: options.signal
  });
}

function openArchive(archivePath: string): Database.Database {
  const source = new Database(archivePath, { readonly: true, fileMustExist: true });
  source.pragma("query_only = ON");
  const tables = new Set(
    (source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
      .map((row) => row.name)
  );
  for (const required of ["messages", "chats", "contacts"]) {
    if (!tables.has(required)) {
      source.close();
      throw new Error(`Not a wacrawl archive. Missing table: ${required}`);
    }
  }
  return source;
}

function countArchiveMessages(archivePath: string): number {
  const source = openArchive(archivePath);
  try {
    return (source.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count;
  } finally {
    source.close();
  }
}

export async function whatsappDesktopStatus() {
  const binary = await findWacrawlBinary();
  const archivePath = resolveWacrawlArchivePath();
  const sourcePath = resolveWhatsAppDesktopSource();
  const settings = connectorSettings("whatsapp");
  const desktopExists = existsSync(path.join(sourcePath, "ChatStorage.sqlite"));
  let doctor: WacrawlDoctor | null = null;
  let archive: WacrawlStatus | null = null;
  let archiveReadable = false;
  let archiveMessageCount: number | null = null;
  let archiveBytes: number | null = null;
  let error: string | null = null;

  if (existsSync(archivePath)) {
    try {
      archiveMessageCount = countArchiveMessages(archivePath);
      archiveBytes = statSync(archivePath).size;
      archiveReadable = true;
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
  }

  if (!binary) {
    error = error ?? "wacrawl is not installed. Install with: brew install openclaw/tap/wacrawl";
  } else {
    try {
      doctor = await runWacrawlJson<WacrawlDoctor>(binary, [
        "--source", sourcePath,
        "--db", archivePath,
        "--sync", "never",
        "doctor"
      ], { timeoutMs: 30_000 });
    } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
    if (archiveReadable) {
      try {
        archive = await runWacrawlJson<WacrawlStatus>(binary, [
          "--db", archivePath,
          "--sync", "never",
          "status"
        ], { timeoutMs: 30_000 });
      } catch (reason) {
        // Archive is still readable via SQLite even if status JSON fails.
        error = error ?? (reason instanceof Error ? reason.message : String(reason));
      }
    }
  }

  return {
    binary,
    binaryFound: Boolean(binary),
    sourcePath,
    desktopExists,
    desktopAvailable: Boolean(doctor?.desktop?.available ?? desktopExists),
    desktopMessageCount: doctor?.desktop?.message_rows ?? null,
    desktopChatCount: doctor?.desktop?.chat_rows ?? null,
    desktopContactCount: doctor?.desktop?.contact_rows ?? null,
    oldestMessage: doctor?.desktop?.oldest_message ?? archive?.oldest_message ?? null,
    newestMessage: doctor?.desktop?.newest_message ?? archive?.newest_message ?? null,
    archivePath,
    archiveExists: existsSync(archivePath),
    archiveReadable,
    archiveMessageCount,
    archiveBytes,
    lastArchiveImportAt: archive?.last_import_at
      ?? (typeof settings.preparedAt === "string" ? settings.preparedAt : null),
    preparedAt: typeof settings.preparedAt === "string" ? settings.preparedAt : null,
    syncCursor: {
      lastRowId: Number(settings.lastRowId) || 0
    },
    // Import can proceed from an existing archive without wacrawl; refreshing needs the binary.
    readable: Boolean(archiveReadable || (binary && (doctor?.desktop?.available || desktopExists))),
    error
  };
}

/** Snapshot WhatsApp Desktop into Nett's private wacrawl archive. */
export async function prepareWhatsAppArchive(options: {
  resetCursor?: boolean;
  signal?: AbortSignal;
} = {}) {
  const binary = await findWacrawlBinary();
  if (!binary) {
    throw new Error(
      "wacrawl is not installed. Install with `brew install openclaw/tap/wacrawl`, or set NETT_WACRAWL_BIN to the binary path."
    );
  }
  const archivePath = resolveWacrawlArchivePath();
  const sourcePath = resolveWhatsAppDesktopSource();
  if (!existsSync(path.join(sourcePath, "ChatStorage.sqlite"))) {
    throw new Error(
      `WhatsApp Desktop database not found at ${sourcePath}. Open WhatsApp Desktop once so it syncs your chats.`
    );
  }
  mkdirSync(path.dirname(archivePath), { recursive: true });
  await runWacrawl(binary, [
    "--source", sourcePath,
    "--db", archivePath,
    "--sync", "never",
    "sync"
  ], { signal: options.signal, timeoutMs: 600_000 });

  const messageCount = countArchiveMessages(archivePath);
  const bytes = statSync(archivePath).size;
  const preparedAt = new Date().toISOString();
  const settings = connectorSettings("whatsapp");
  const cursorReset = options.resetCursor === true;
  const nextSettings = {
    ...settings,
    preparedAt,
    archivePath,
    sourcePath,
    ...(cursorReset ? { lastRowId: 0, totalSeen: 0, totalLinked: 0 } : {})
  };
  updateConnectorSettings("whatsapp", nextSettings);
  setConnectorState("whatsapp", {
    permission: "granted",
    status: "idle",
    seen: Number(nextSettings.totalSeen) || 0,
    linked: Number(nextSettings.totalLinked) || 0
  });
  return {
    messageCount,
    bytes,
    preparedAt,
    cursorReset,
    archivePath,
    syncCursor: { lastRowId: Number(nextSettings.lastRowId) || 0 },
    message: cursorReset
      ? `Prepared ${messageCount.toLocaleString()} WhatsApp messages via wacrawl and reset the import cursor.`
      : `Updated the local WhatsApp archive (${messageCount.toLocaleString()} messages). New rows can be imported from rowid ${(Number(nextSettings.lastRowId) || 0) + 1}.`
  };
}

function handleExternalId(jid: string): string {
  const phone = phoneFromWhatsAppJid(jid);
  if (phone) return `phone:${phone}`;
  return `jid:${jid.trim().toLowerCase()}`;
}

function displayNameForJid(
  archive: Database.Database,
  jid: string,
  fallback?: string | null
): string {
  const contact = archive.prepare(
    "SELECT full_name, first_name, last_name, phone, business_name FROM contacts WHERE jid = ?"
  ).get(jid) as {
    full_name?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    business_name?: string;
  } | undefined;
  const composed = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ").trim();
  return (
    contact?.full_name?.trim()
    || composed
    || contact?.business_name?.trim()
    || fallback?.trim()
    || contact?.phone?.trim()
    || jid
  );
}

function upsertWhatsAppHandle(
  archive: Database.Database,
  jid: string,
  fallbackName?: string | null
) {
  const externalId = handleExternalId(jid);
  const existing = db.prepare(
    "SELECT id, person_id FROM source_identities WHERE connector_id='whatsapp-handle' AND external_id=?"
  ).get(externalId) as { id: string; person_id: string | null } | undefined;
  const phone = phoneFromWhatsAppJid(jid);
  const contactPhone = archive.prepare("SELECT phone FROM contacts WHERE jid = ?")
    .get(jid) as { phone?: string } | undefined;
  const phones = [phone, contactPhone?.phone].filter(Boolean) as string[];
  const exact = phones.length ? findExactPerson([], phones) : undefined;
  const id = existing?.id ?? randomUUID();
  const personId = existing?.person_id ?? exact?.person_id ?? null;
  const displayName = displayNameForJid(archive, jid, fallbackName);
  const timestamp = new Date().toISOString();
  db.prepare(`
    INSERT INTO source_identities
      (id, person_id, connector_id, external_id, display_name, raw_json, linked_by, confidence, created_at, updated_at)
    VALUES (?, ?, 'whatsapp-handle', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connector_id, external_id) DO UPDATE SET
      person_id=COALESCE(source_identities.person_id, excluded.person_id),
      display_name=excluded.display_name,
      raw_json=excluded.raw_json,
      linked_by=COALESCE(source_identities.linked_by, excluded.linked_by),
      confidence=COALESCE(source_identities.confidence, excluded.confidence),
      updated_at=excluded.updated_at
  `).run(
    id,
    personId,
    externalId,
    displayName,
    JSON.stringify({ jid, phone, phones, normalized: externalId }),
    personId ? "exact-contact-method" : "unlinked",
    personId ? 1 : null,
    timestamp,
    timestamp
  );
  if (personId && phones.length) {
    for (const value of phones) {
      const normalized = normalizePhone(value);
      if (!normalized) continue;
      db.prepare(`
        INSERT INTO contact_methods (id, person_id, kind, value, normalized_value, source_identity_id)
        VALUES (?, ?, 'phone', ?, ?, ?)
        ON CONFLICT(person_id, kind, normalized_value) DO NOTHING
      `).run(randomUUID(), personId, value, normalized, id);
    }
  }
  return { id, personId, jid, handle: phone || jid };
}

function participantJidsForMessage(
  archive: Database.Database,
  row: WhatsAppMessageRow
): string[] {
  const jids = new Set<string>();
  if (isWhatsAppGroupJid(row.chat_jid)) {
    if (row.sender_jid && !row.from_me && !isWhatsAppGroupJid(row.sender_jid)) {
      jids.add(row.sender_jid);
    }
    const members = archive.prepare(`
      SELECT user_jid FROM group_participants
      WHERE group_jid = ? AND is_active = 1
      LIMIT 40
    `).all(row.chat_jid) as { user_jid: string }[];
    for (const member of members) {
      if (member.user_jid && !isWhatsAppGroupJid(member.user_jid)) jids.add(member.user_jid);
    }
  } else if (row.chat_jid) {
    jids.add(row.chat_jid);
  }
  if (row.sender_jid && !row.from_me && !isWhatsAppGroupJid(row.sender_jid)) {
    jids.add(row.sender_jid);
  }
  return [...jids];
}

export const whatsappDesktopConnector = {
  id: "whatsapp" as const,
  label: "WhatsApp",
  permission: "full-disk-access" as const,
  async sync(options: WhatsAppSyncOptions = {}): Promise<WhatsAppSyncResult> {
    setConnectorState(this.id, { status: "syncing", permission: "unknown" });
    const archivePath = resolveWacrawlArchivePath();
    let source: Database.Database | undefined;
    try {
      if (!existsSync(archivePath)) {
        await prepareWhatsAppArchive({ resetCursor: true, signal: options.signal });
      }
      source = openArchive(archivePath);
      const batchSize = Math.min(Math.max(Number(process.env.NETT_WHATSAPP_BATCH_SIZE) || 500, 50), 2000);
      const settings = connectorSettings(this.id);
      let cursor = Number(settings.lastRowId) || 0;
      let totalSeen = Number(settings.totalSeen) || 0;
      let totalLinked = Number(settings.totalLinked) || 0;
      let seen = 0;
      let linked = 0;
      let batchesCompleted = 0;
      let done = true;
      const maxBatches = options.maxBatches
        ? Math.min(Math.max(Math.floor(options.maxBatches), 1), 100)
        : Number.POSITIVE_INFINITY;
      const affectedPeople = new Set<string>();
      const query = source.prepare(`
        SELECT
          m.rowid AS rowid,
          m.source_pk AS source_pk,
          m.chat_jid AS chat_jid,
          m.chat_name AS chat_name,
          m.msg_id AS msg_id,
          m.sender_jid AS sender_jid,
          m.sender_name AS sender_name,
          m.ts AS ts,
          m.from_me AS from_me,
          m.text AS text,
          m.message_type AS message_type,
          c.kind AS chat_kind
        FROM messages m
        LEFT JOIN chats c ON c.jid = m.chat_jid
        WHERE m.rowid > ?
        ORDER BY m.rowid ASC
        LIMIT ?
      `);

      while (true) {
        if (options.signal?.aborted) throw new Error("WhatsApp sync cancelled");
        const rows = query.all(cursor, batchSize) as WhatsAppMessageRow[];
        if (!rows.length) break;
        const linkedBeforeBatch = linked;
        db.transaction(() => {
          for (const row of rows) {
            const externalId = `source_pk:${row.source_pk}`;
            const participantJids = participantJidsForMessage(source!, row);
            const identities = participantJids.map((jid) =>
              upsertWhatsAppHandle(
                source!,
                jid,
                jid === row.sender_jid ? row.sender_name : row.chat_name
              )
            );
            const senderIdentity = row.sender_jid && !row.from_me
              ? identities.find((identity) => identity.jid === row.sender_jid)
              : undefined;
            const conversationExternalId = row.chat_jid;
            const timestamp = new Date().toISOString();
            const occurredAt = new Date(row.ts * 1000).toISOString();
            const isGroup = row.chat_kind === "group" || isWhatsAppGroupJid(row.chat_jid);
            db.prepare(`
              INSERT INTO conversations (id, connector_id, external_id, title, is_group, raw_json, created_at, updated_at)
              VALUES (?, 'whatsapp', ?, ?, ?, ?, ?, ?)
              ON CONFLICT(connector_id, external_id) DO UPDATE SET
                title=excluded.title, is_group=excluded.is_group, raw_json=excluded.raw_json, updated_at=excluded.updated_at
            `).run(
              randomUUID(),
              conversationExternalId,
              row.chat_name,
              isGroup ? 1 : 0,
              JSON.stringify({ participants: participantJids, kind: row.chat_kind }),
              timestamp,
              timestamp
            );
            const conversation = db.prepare(
              "SELECT id FROM conversations WHERE connector_id='whatsapp' AND external_id=?"
            ).get(conversationExternalId) as { id: string };
            for (const identity of identities) {
              db.prepare(
                "INSERT OR IGNORE INTO conversation_participants (conversation_id, source_identity_id, handle) VALUES (?, ?, ?)"
              ).run(conversation.id, identity.id, identity.handle);
            }
            const direction = row.from_me ? "outgoing" : "incoming";
            const snippet = describeWhatsAppMessage(row.text, row.message_type);
            const evidence = {
              jid: row.sender_jid,
              chatJid: row.chat_jid,
              direction,
              thread: conversationExternalId,
              participants: participantJids,
              sourceRowId: row.source_pk,
              archiveRowId: row.rowid,
              messageId: row.msg_id,
              messageType: row.message_type
            };
            const handle = senderIdentity?.handle
              || phoneFromWhatsAppJid(row.chat_jid)
              || row.chat_jid;
            db.prepare(`
              INSERT INTO communications
                (id, connector_id, external_id, guid, source_rowid, conversation_id, sender_identity_id, handle, direction, kind, body, occurred_at, evidence_json, created_at, updated_at)
              VALUES (?, 'whatsapp', ?, ?, ?, ?, ?, ?, ?, 'message', ?, ?, ?, ?, ?)
              ON CONFLICT(connector_id, external_id) DO UPDATE SET
                guid=excluded.guid, source_rowid=excluded.source_rowid, conversation_id=excluded.conversation_id,
                sender_identity_id=excluded.sender_identity_id, handle=excluded.handle, direction=excluded.direction,
                body=excluded.body, occurred_at=excluded.occurred_at, evidence_json=excluded.evidence_json, updated_at=excluded.updated_at
            `).run(
              randomUUID(),
              externalId,
              row.msg_id,
              row.source_pk,
              conversation.id,
              senderIdentity?.id ?? null,
              handle,
              direction,
              snippet,
              occurredAt,
              JSON.stringify(evidence),
              timestamp,
              timestamp
            );
            const communication = db.prepare(
              "SELECT id FROM communications WHERE connector_id='whatsapp' AND external_id=?"
            ).get(externalId) as { id: string };

            const people = new Map<string, string>();
            for (const identity of identities) {
              if (!identity.personId) continue;
              const role = !row.from_me && identity.id === senderIdentity?.id ? "sender" : "participant";
              people.set(identity.personId, role);
            }
            for (const [personId, role] of people) {
              affectedPeople.add(personId);
              db.prepare(`
                INSERT INTO communication_people (communication_id, person_id, role) VALUES (?, ?, ?)
                ON CONFLICT(communication_id, person_id) DO UPDATE SET role=excluded.role
              `).run(communication.id, personId, role);
              upsertInteraction({
                personId,
                kind: "message",
                occurredAt,
                summary: snippet.slice(0, 180),
                sourceConnector: "whatsapp",
                sourceRecordId: externalId,
                evidence
              });
            }
            if (people.size) linked++;
            db.prepare(`
              INSERT INTO source_records (id, connector_id, external_id, person_id, entity_type, raw_json, captured_at)
              VALUES (?, 'whatsapp', ?, ?, 'message', ?, ?)
              ON CONFLICT(connector_id, external_id, entity_type) DO UPDATE SET
                person_id=excluded.person_id, raw_json=excluded.raw_json, captured_at=excluded.captured_at
            `).run(
              randomUUID(),
              externalId,
              people.size === 1 ? [...people.keys()][0] : null,
              JSON.stringify({ ...row, participants: participantJids }),
              timestamp
            );
            cursor = row.rowid;
          }
          rollupLastContact(affectedPeople);
        })();
        seen += rows.length;
        totalSeen += rows.length;
        totalLinked += linked - linkedBeforeBatch;
        batchesCompleted++;
        updateConnectorSettings(this.id, {
          ...settings,
          lastRowId: cursor,
          totalSeen,
          totalLinked,
          archivePath
        });
        if (rows.length < batchSize) break;
        if (batchesCompleted >= maxBatches) {
          done = false;
          break;
        }
      }

      setConnectorState(this.id, {
        permission: "granted",
        status: done ? "success" : "syncing",
        seen: totalSeen,
        linked: totalLinked
      });
      return {
        seen,
        linked,
        done,
        cursor,
        batchesCompleted,
        totalSeen,
        message: done
          ? `WhatsApp import complete. Read ${totalSeen.toLocaleString()} records from the wacrawl archive.`
          : `Imported ${seen.toLocaleString()} more WhatsApp messages. Continuing from rowid ${cursor}.`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "WhatsApp access failed";
      setConnectorState(this.id, { permission: "blocked", status: "error", error: message });
      throw new Error(
        `${message} Install wacrawl, open WhatsApp Desktop, then use Settings → Sources → WhatsApp → Sync archive.`
      );
    } finally {
      source?.close();
    }
  }
};
