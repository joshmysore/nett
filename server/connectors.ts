import Database from "better-sqlite3";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  connectorSettings,
  db,
  findExactPerson,
  normalizeEmail,
  normalizePhone,
  rollupLastContact,
  setConnectorState,
  type SourceContact,
  updateConnectorSettings,
  upsertInteraction,
  upsertSourceContacts
} from "./db.js";
import { whatsappDesktopConnector } from "./connectors/whatsapp-desktop.js";
import { describeAppleMessage } from "./connectors/message-body.js";

export {
  findWacrawlBinary,
  phoneFromWhatsAppJid,
  prepareWhatsAppArchive,
  resolveWacrawlArchivePath,
  resolveWacrawlBinary,
  resolveWhatsAppDesktopSource,
  whatsappDesktopStatus
} from "./connectors/whatsapp-desktop.js";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const swiftExporter = path.join(here, "macos", "export-contacts.swift");
const messagesImportDir = path.resolve(process.cwd(), "data", "imports");
const localMessagesCopy = path.join(messagesImportDir, "messages.db");
const systemMessagesDb = path.join(homedir(), "Library", "Messages", "chat.db");

function removeSqliteSidecars(databasePath: string) {
  for (const suffix of ["-wal", "-shm"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

function quoteSqliteCliPath(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

type MessagesProbe = { messageCount: number; bytes: number };
type ProbeCacheEntry = { key: string; result: MessagesProbe } | { key: string; error: Error };

/** `quick_check` scans the entire Messages database. It is a connect-time
 *  integrity gate, not something status polling can afford, so the result is
 *  cached against the file's size and mtime. */
let messagesProbeCache: ProbeCacheEntry | null = null;

function messagesProbeKey(databasePath: string) {
  try {
    const stats = statSync(databasePath);
    return `${databasePath}:${stats.size}:${stats.mtimeMs}`;
  } catch {
    return `${databasePath}:missing`;
  }
}

export function invalidateMessagesProbe() {
  messagesProbeCache = null;
}

function inspectMessagesDatabase(databasePath: string, options: { deep?: boolean } = {}): MessagesProbe {
  const key = messagesProbeKey(databasePath);
  if (!options.deep && messagesProbeCache && messagesProbeCache.key === key) {
    if ("error" in messagesProbeCache) throw messagesProbeCache.error;
    return messagesProbeCache.result;
  }
  try {
    const result = readMessagesDatabase(databasePath, options.deep !== false);
    messagesProbeCache = { key, result };
    return result;
  } catch (reason) {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    messagesProbeCache = { key, error };
    throw error;
  }
}

function readMessagesDatabase(databasePath: string, deep: boolean): MessagesProbe {
  const source = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    source.pragma("query_only = ON");
    const tables = new Set(
      (source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
        .map((row) => row.name)
    );
    const required = ["message", "handle", "chat"];
    const missingTables = required.filter((table) => !tables.has(table));
    if (missingTables.length) {
      throw new Error(`Not an Apple Messages database. Missing: ${missingTables.join(", ")}`);
    }
    if (deep) {
      const integrity = source.pragma("quick_check") as { quick_check: string }[];
      if (!integrity.every((row) => row.quick_check === "ok")) {
        throw new Error("The Messages database failed SQLite integrity checks");
      }
    }
    const messageCount = (source.prepare("SELECT COUNT(*) AS count FROM message").get() as { count: number }).count;
    return { messageCount, bytes: statSync(databasePath).size };
  } finally {
    source.close();
  }
}

export function resolveMessagesDatabasePath(): string {
  if (process.env.NETT_MESSAGES_DB && existsSync(process.env.NETT_MESSAGES_DB)) {
    return process.env.NETT_MESSAGES_DB;
  }
  if (existsSync(localMessagesCopy)) return localMessagesCopy;
  return systemMessagesDb;
}

export function messagesDatabaseStatus() {
  const activePath = resolveMessagesDatabasePath();
  const usingLocalCopy = activePath === localMessagesCopy;
  const usingEnv = Boolean(process.env.NETT_MESSAGES_DB && activePath === process.env.NETT_MESSAGES_DB);
  const settings = connectorSettings("messages");
  let readable = false;
  let messageCount: number | null = null;
  let bytes: number | null = null;
  let error: string | null = null;
  try {
    const inspected = inspectMessagesDatabase(activePath, { deep: false });
    messageCount = inspected.messageCount;
    bytes = inspected.bytes;
    readable = true;
  } catch (reason) {
    error = reason instanceof Error ? reason.message : String(reason);
  }
  return {
    source: usingLocalCopy ? "local_copy" : usingEnv ? "environment" : existsSync(activePath) ? "system" : "none",
    usingLocalCopy,
    usingEnv,
    localCopyExists: existsSync(localMessagesCopy),
    systemExists: existsSync(systemMessagesDb),
    readable,
    messageCount,
    bytes,
    preparedAt: typeof settings.preparedAt === "string" ? settings.preparedAt : null,
    syncCursor: {
      lastRowId: Number(settings.lastRowId) || 0,
      lastGuid: typeof settings.lastGuid === "string" ? settings.lastGuid : null
    },
    error
  };
}

/** Prefer sqlite3 .backup so Terminal/FDA can copy when Node cannot open chat.db directly. */
export async function prepareLocalMessagesCopy(
  uploadedPath?: string,
  options: { resetCursor?: boolean } = {}
) {
  mkdirSync(messagesImportDir, { recursive: true });
  chmodSync(messagesImportDir, 0o700);
  const sourcePath = uploadedPath || systemMessagesDb;
  if (!existsSync(sourcePath)) throw new Error("Messages database was not found");
  const resetCursor = options.resetCursor ?? Boolean(uploadedPath);
  const stagingPath = path.join(messagesImportDir, `messages-${randomUUID()}.pending.db`);
  try {
    removeSqliteSidecars(stagingPath);
    if (uploadedPath) {
      const uploaded = new Database(uploadedPath, { readonly: true, fileMustExist: true });
      try {
        uploaded.pragma("query_only = ON");
        await uploaded.backup(stagingPath);
      } finally {
        uploaded.close();
      }
    } else {
      await execFileAsync("sqlite3", [
        systemMessagesDb,
        `.backup ${quoteSqliteCliPath(stagingPath)}`
      ], { timeout: 120_000 });
    }
    const inspected = inspectMessagesDatabase(stagingPath, { deep: true });
    removeSqliteSidecars(localMessagesCopy);
    renameSync(stagingPath, localMessagesCopy);
    chmodSync(localMessagesCopy, 0o600);
    invalidateMessagesProbe();

    const preparedAt = new Date().toISOString();
    const settings = connectorSettings("messages");
    const nextSettings: Record<string, unknown> = resetCursor
      ? {
          ...settings,
          lastRowId: 0,
          lastGuid: null,
          totalSeen: 0,
          totalLinked: 0,
          preparedAt,
          source: uploadedPath ? "upload" : "backup",
          messageCount: inspected.messageCount,
          bytes: inspected.bytes
        }
      : {
          ...settings,
          preparedAt,
          source: uploadedPath ? "upload" : "backup",
          messageCount: inspected.messageCount,
          bytes: inspected.bytes
        };
    updateConnectorSettings("messages", nextSettings);
    setConnectorState("messages", {
      permission: "granted",
      status: "idle",
      error: null,
      seen: resetCursor ? 0 : Number(settings.totalSeen) || undefined,
      linked: resetCursor ? 0 : Number(settings.totalLinked) || undefined
    });
    process.env.NETT_MESSAGES_DB = localMessagesCopy;
    return {
      path: localMessagesCopy,
      messageCount: inspected.messageCount,
      bytes: inspected.bytes,
      preparedAt,
      cursorReset: resetCursor,
      syncCursor: {
        lastRowId: Number(nextSettings.lastRowId) || 0,
        lastGuid: typeof nextSettings.lastGuid === "string" ? nextSettings.lastGuid : null
      }
    };
  } catch (reason) {
    rmSync(stagingPath, { force: true });
    removeSqliteSidecars(stagingPath);
    if (uploadedPath) throw reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const host = process.env.TERM_PROGRAM || process.title || "the app running Nett";
    throw new Error(
      `Could not prepare the Messages copy (${message}). Grant Full Disk Access to ${host} in System Settings, restart Nett, and retry. You can also upload a database created with sqlite3 .backup.`
    );
  }
}

export interface ConnectorResult {
  seen: number;
  linked: number;
  created?: number;
  message: string;
  done?: boolean;
  cursor?: number;
  batchesCompleted?: number;
  totalSeen?: number;
}
export interface ConnectorSyncOptions {
  maxBatches?: number;
  signal?: AbortSignal;
}
export interface NettConnector {
  id: string;
  label: string;
  permission: "macos-automation" | "full-disk-access" | "file" | "future";
  sync(options?: ConnectorSyncOptions): Promise<ConnectorResult>;
}

const notesScript = `
  const Contacts = Application('Contacts');
  const people = Contacts.people;
  function safe(fn, fallback) { try { const v = fn(); return v == null ? fallback : v; } catch (_) { return fallback; } }
  const ids = safe(() => people.id(), []);
  let noteValues = [];
  let restricted = 0;
  try {
    noteValues = people.note();
  } catch (_) {
    restricted = ids.length;
  }
  const result = ids.map((sourceId, index) => ({
    sourceId,
    notes: noteValues[index] || ''
  }));
  JSON.stringify({ contacts: result, restricted });
`;

async function exportAppleContactsViaSwift(): Promise<SourceContact[]> {
  const { stdout } = await execFileAsync("swift", [swiftExporter], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120000
  });
  return JSON.parse(stdout.trim()) as SourceContact[];
}

async function exportAppleContactNotes(): Promise<{ notes: Map<string, string>; restricted: number }> {
  const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", notesScript], {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120000
  });
  const payload = JSON.parse(stdout.trim()) as { contacts: { sourceId: string; notes: string }[]; restricted: number };
  return {
    notes: new Map(payload.contacts.filter((row) => row.sourceId && row.notes).map((row) => [row.sourceId, row.notes])),
    restricted: payload.restricted
  };
}

export const appleContactsConnector: NettConnector = {
  id: "apple-contacts",
  label: "Apple Contacts",
  permission: "macos-automation",
  async sync() {
    setConnectorState(this.id, { status: "syncing", permission: "unknown" });
    try {
      if (process.platform !== "darwin") throw new Error("Apple Contacts import is only available on macOS.");
      const contacts = await exportAppleContactsViaSwift();
      let notes = new Map<string, string>();
      let noteStatus = "Notes unavailable: Contacts.app Automation permission was not granted.";
      let notesPermission: "granted" | "restricted" = "restricted";
      try {
        const noteResult = await exportAppleContactNotes();
        notes = noteResult.notes;
        notesPermission = noteResult.restricted ? "restricted" : "granted";
        noteStatus = noteResult.restricted
          ? `Read ${notes.size} Contacts.app notes; ${noteResult.restricted} were restricted by macOS.`
          : `Read ${notes.size} Contacts.app notes as source evidence.`;
      } catch (notesError) {
        const detail = notesError instanceof Error ? notesError.message : String(notesError);
        noteStatus = `Notes restricted (${detail.slice(0, 140)}). Grant Contacts.app Automation access to include them.`;
      }
      const usable = contacts.filter((c) => c.sourceId && (c.name || c.firstName || c.lastName || c.company));
      const normalized = usable.map((c) => ({
        ...c,
        name: c.name || [c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || "Unnamed contact",
        notes: notes.get(c.sourceId)
      }));
      const result = upsertSourceContacts(this.id, normalized);
      updateConnectorSettings(this.id, { notesPermission, notesCount: notes.size });
      setConnectorState(this.id, { permission: "granted", status: "success", seen: result.seen, linked: result.linked });
      return {
        ...result,
        message: `Read ${result.seen} Apple Contacts (${result.created ?? 0} new people, ${result.linked} linked). ${noteStatus} Editable Nett notes were left unchanged.`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Contacts access failed";
      setConnectorState(this.id, { permission: "blocked", status: "error", error: message });
      throw new Error(`${message} Open System Settings > Privacy & Security > Contacts and allow Terminal or Cursor to access Contacts.`);
    }
  }
};

type MessageRow = {
  message_id: number;
  guid: string | null;
  handle: string | null;
  text: string | null;
  attributed_body: Buffer | null;
  associated_type: number | null;
  associated_emoji: string | null;
  has_attachments: number | null;
  sent_at: string;
  is_from_me: number;
  chat_id: string | null;
  chat_title: string | null;
  participants: string | null;
};

function handleExternalId(handle: string): string {
  if (handle.includes("@")) return `email:${normalizeEmail(handle)}`;
  const phone = normalizePhone(handle);
  return phone ? `phone:${phone}` : `raw:${handle.trim().toLowerCase()}`;
}

function upsertMessageHandle(handle: string) {
  const externalId = handleExternalId(handle);
  const existing = db.prepare(
    "SELECT id, person_id FROM source_identities WHERE connector_id='messages-handle' AND external_id=?"
  ).get(externalId) as { id: string; person_id: string | null } | undefined;
  const exact = handle.includes("@") ? findExactPerson([handle], []) : findExactPerson([], [handle]);
  const id = existing?.id ?? randomUUID();
  const personId = existing?.person_id ?? exact?.person_id ?? null;
  const timestamp = new Date().toISOString();
  db.prepare(`
    INSERT INTO source_identities
      (id, person_id, connector_id, external_id, display_name, raw_json, linked_by, confidence, created_at, updated_at)
    VALUES (?, ?, 'messages-handle', ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connector_id, external_id) DO UPDATE SET
      person_id=COALESCE(source_identities.person_id, excluded.person_id),
      display_name=excluded.display_name,
      raw_json=excluded.raw_json,
      linked_by=COALESCE(source_identities.linked_by, excluded.linked_by),
      confidence=COALESCE(source_identities.confidence, excluded.confidence),
      updated_at=excluded.updated_at
  `).run(id, personId, externalId, handle, JSON.stringify({ handle, normalized: externalId }), personId ? "exact-contact-method" : "unlinked", personId ? 1 : null, timestamp, timestamp);
  return { id, personId, handle };
}

export const messagesConnector: NettConnector = {
  id: "messages",
  label: "Messages",
  permission: "full-disk-access",
  async sync(options = {}) {
    setConnectorState(this.id, { status: "syncing", permission: "unknown" });
    const file = resolveMessagesDatabasePath();
    let source: Database.Database | undefined;
    try {
      source = new Database(file, { readonly: true, fileMustExist: true });
      source.pragma("query_only = ON");
      const batchSize = Math.min(Math.max(Number(process.env.NETT_MESSAGES_BATCH_SIZE) || 500, 50), 2000);
      const settings = connectorSettings(this.id);
      let cursor = Number(settings.lastRowId) || 0;
      let lastGuid = typeof settings.lastGuid === "string" ? settings.lastGuid : null;
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
      // Newer macOS versions move message text into `attributedBody` and mark
      // tapbacks/attachments with dedicated columns. Older databases (and the
      // smoke-test fixture) lack them, so select only what exists.
      const messageColumns = new Set(
        (source.prepare("PRAGMA table_info(message)").all() as { name: string }[]).map((column) => column.name)
      );
      const optionalColumns = [
        messageColumns.has("attributedBody") ? "m.attributedBody AS attributed_body" : "NULL AS attributed_body",
        messageColumns.has("associated_message_type") ? "m.associated_message_type AS associated_type" : "NULL AS associated_type",
        messageColumns.has("associated_message_emoji") ? "m.associated_message_emoji AS associated_emoji" : "NULL AS associated_emoji",
        messageColumns.has("cache_has_attachments") ? "m.cache_has_attachments AS has_attachments" : "0 AS has_attachments",
      ].join(",\n          ");
      const query = source.prepare(`
        SELECT
          m.ROWID AS message_id,
          m.guid,
          h.id AS handle,
          m.text,
          ${optionalColumns},
          strftime('%Y-%m-%dT%H:%M:%fZ', m.date / 1000000000 + 978307200, 'unixepoch') AS sent_at,
          m.is_from_me,
          COALESCE(c.guid, c.chat_identifier, CAST(c.ROWID AS TEXT)) AS chat_id,
          c.display_name AS chat_title,
          (
            SELECT GROUP_CONCAT(DISTINCT hp.id)
            FROM chat_handle_join chj
            JOIN handle hp ON hp.ROWID = chj.handle_id
            WHERE chj.chat_id = c.ROWID
          ) AS participants
        FROM message m
        LEFT JOIN handle h ON h.ROWID = m.handle_id
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE m.ROWID > ? AND m.date > 0
        GROUP BY m.ROWID
        ORDER BY m.ROWID ASC
        LIMIT ?
      `);

      while (true) {
        if (options.signal?.aborted) throw new Error("Messages sync cancelled");
        const rows = query.all(cursor, batchSize) as MessageRow[];
        if (!rows.length) break;
        const linkedBeforeBatch = linked;
        db.transaction(() => {
          for (const row of rows) {
            const externalId = row.guid || `rowid:${row.message_id}`;
            const participantHandles = [...new Set([
              ...(row.participants?.split(",").filter(Boolean) ?? []),
              ...(row.handle ? [row.handle] : [])
            ])];
            const identities = participantHandles.map(upsertMessageHandle);
            const senderIdentity = row.handle ? identities.find((identity) => identity.handle === row.handle) : undefined;
            const conversationExternalId = row.chat_id || `direct:${handleExternalId(row.handle || "unknown")}`;
            const timestamp = new Date().toISOString();
            db.prepare(`
              INSERT INTO conversations (id, connector_id, external_id, title, is_group, raw_json, created_at, updated_at)
              VALUES (?, 'messages', ?, ?, ?, ?, ?, ?)
              ON CONFLICT(connector_id, external_id) DO UPDATE SET
                title=excluded.title, is_group=excluded.is_group, raw_json=excluded.raw_json, updated_at=excluded.updated_at
            `).run(randomUUID(), conversationExternalId, row.chat_title, participantHandles.length > 1 ? 1 : 0, JSON.stringify({ participants: participantHandles }), timestamp, timestamp);
            const conversation = db.prepare(
              "SELECT id FROM conversations WHERE connector_id='messages' AND external_id=?"
            ).get(conversationExternalId) as { id: string };
            for (const identity of identities) {
              db.prepare("INSERT OR IGNORE INTO conversation_participants (conversation_id, source_identity_id, handle) VALUES (?, ?, ?)")
                .run(conversation.id, identity.id, identity.handle);
            }
            const direction = row.is_from_me ? "outgoing" : "incoming";
            const snippet = describeAppleMessage({
              text: row.text,
              attributedBody: row.attributed_body,
              associatedType: row.associated_type,
              associatedEmoji: row.associated_emoji,
              hasAttachments: row.has_attachments,
            });
            const evidence = {
              handle: row.handle,
              direction,
              thread: conversationExternalId,
              participants: participantHandles,
              sourceRowId: row.message_id,
              guid: row.guid
            };
            db.prepare(`
              INSERT INTO communications
                (id, connector_id, external_id, guid, source_rowid, conversation_id, sender_identity_id, handle, direction, kind, body, occurred_at, evidence_json, created_at, updated_at)
              VALUES (?, 'messages', ?, ?, ?, ?, ?, ?, ?, 'message', ?, ?, ?, ?, ?)
              ON CONFLICT(connector_id, external_id) DO UPDATE SET
                guid=excluded.guid, source_rowid=excluded.source_rowid, conversation_id=excluded.conversation_id,
                sender_identity_id=excluded.sender_identity_id, handle=excluded.handle, direction=excluded.direction,
                body=excluded.body, occurred_at=excluded.occurred_at, evidence_json=excluded.evidence_json, updated_at=excluded.updated_at
            `).run(randomUUID(), externalId, row.guid, row.message_id, conversation.id, senderIdentity?.id ?? null, row.handle, direction, snippet, row.sent_at, JSON.stringify(evidence), timestamp, timestamp);
            const communication = db.prepare(
              "SELECT id FROM communications WHERE connector_id='messages' AND external_id=?"
            ).get(externalId) as { id: string };

            const people = new Map<string, string>();
            for (const identity of identities) {
              if (identity.personId) people.set(identity.personId, !row.is_from_me && identity.id === senderIdentity?.id ? "sender" : "participant");
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
                occurredAt: row.sent_at,
                summary: snippet.slice(0, 180),
                sourceConnector: "messages",
                sourceRecordId: externalId,
                evidence
              });
            }
            if (people.size) linked++;
            db.prepare(`
              INSERT INTO source_records (id, connector_id, external_id, person_id, entity_type, raw_json, captured_at)
              VALUES (?, 'messages', ?, ?, 'message', ?, ?)
              ON CONFLICT(connector_id, external_id, entity_type) DO UPDATE SET
                person_id=excluded.person_id, raw_json=excluded.raw_json, captured_at=excluded.captured_at
            `).run(randomUUID(), externalId, people.size === 1 ? [...people.keys()][0] : null, JSON.stringify({ ...row, participants: participantHandles }), timestamp);
            cursor = row.message_id;
            lastGuid = row.guid;
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
          lastGuid,
          totalSeen,
          totalLinked
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
      const sourceLabel = file === localMessagesCopy ? "local Messages copy" : "Messages database";
      return {
        seen,
        linked,
        done,
        cursor,
        batchesCompleted,
        totalSeen,
        message: done
          ? `Messages import complete. Read ${totalSeen.toLocaleString()} records from the ${sourceLabel}.`
          : `Imported ${seen.toLocaleString()} more messages. Continuing from ROWID ${cursor}.`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Messages access failed";
      setConnectorState(this.id, { permission: "blocked", status: "error", error: message });
      throw new Error(
        `${message} Use Settings → Sources → Prepare Messages copy, upload a chat.db, or grant Full Disk Access and restart Nett.`
      );
    } finally {
      source?.close();
    }
  }
};

export const connectors = new Map<string, NettConnector>([
  [appleContactsConnector.id, appleContactsConnector],
  [messagesConnector.id, messagesConnector],
  [whatsappDesktopConnector.id, whatsappDesktopConnector]
]);
