// One-shot maintenance: repair unreadable message bodies already stored in
// communications and interactions.
//
// - Messages rows that were saved as the generic "Attachment or tapback" are
//   re-read from chat.db: real text is recovered from attributedBody, tapbacks
//   become named reactions, attachments become "Attachment".
// - WhatsApp media rows whose body is a base64 content hash (or a bracketed
//   "[image]"-style placeholder) are relabelled from their message type.
//
// Raw payloads in source_records and the source databases are never touched.
//
// Run with: npx tsx scripts/backfill-message-bodies.ts [--dry-run]

import Database from "better-sqlite3";
import { db } from "../server/db.js";
import { resolveMessagesDatabasePath } from "../server/connectors.js";
import {
  describeAppleMessage,
  describeWhatsAppMessage,
  looksLikeContentHash,
} from "../server/connectors/message-body.js";

const dryRun = process.argv.includes("--dry-run");

const updateCommunication = db.prepare("UPDATE communications SET body=? WHERE id=?");
const updateInteractions = db.prepare(
  "UPDATE interactions SET summary=? WHERE source_connector=? AND source_record_id=?",
);

function applyFix(connector: string, communicationId: string, externalId: string, body: string) {
  if (dryRun) return;
  updateCommunication.run(body, communicationId);
  updateInteractions.run(body.slice(0, 180), connector, externalId);
}

// --- Messages ---------------------------------------------------------------

let messagesFixed = 0;
let messagesMissing = 0;
try {
  const source = new Database(resolveMessagesDatabasePath(), { readonly: true, fileMustExist: true });
  source.pragma("query_only = ON");
  const columns = new Set(
    (source.prepare("PRAGMA table_info(message)").all() as { name: string }[]).map((column) => column.name),
  );
  const lookup = source.prepare(`
    SELECT
      text,
      ${columns.has("attributedBody") ? "attributedBody" : "NULL"} AS attributed_body,
      ${columns.has("associated_message_type") ? "associated_message_type" : "NULL"} AS associated_type,
      ${columns.has("associated_message_emoji") ? "associated_message_emoji" : "NULL"} AS associated_emoji,
      ${columns.has("cache_has_attachments") ? "cache_has_attachments" : "0"} AS has_attachments
    FROM message WHERE guid = ? OR ROWID = ?
  `);

  const placeholders = db.prepare(`
    SELECT id, external_id, guid, source_rowid
    FROM communications
    WHERE connector_id='messages' AND body='Attachment or tapback'
  `).all() as { id: string; external_id: string; guid: string | null; source_rowid: number | null }[];

  console.log(`Messages: ${placeholders.length} placeholder rows to repair`);
  const counts = new Map<string, number>();
  db.transaction(() => {
    for (const row of placeholders) {
      const original = lookup.get(row.guid ?? "", row.source_rowid ?? -1) as
        | { text: string | null; attributed_body: Buffer | null; associated_type: number | null; associated_emoji: string | null; has_attachments: number | null }
        | undefined;
      if (!original) {
        messagesMissing += 1;
        continue;
      }
      const body = describeAppleMessage({
        text: original.text,
        attributedBody: original.attributed_body,
        associatedType: original.associated_type,
        associatedEmoji: original.associated_emoji,
        hasAttachments: original.has_attachments,
      });
      if (body === "Attachment or tapback") continue;
      applyFix("messages", row.id, row.external_id, body);
      messagesFixed += 1;
      const isLabel = body === "Attachment" || body === "Message" || body === "Removed a reaction"
        || / a message$/.test(body) || body === "Sticker reaction";
      const kind = isLabel ? body : "(recovered text)";
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
  })();
  source.close();
  console.log("Messages breakdown:", Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1])));
} catch (error) {
  console.error("Messages backfill skipped:", error instanceof Error ? error.message : error);
}

// --- WhatsApp ---------------------------------------------------------------

const whatsappRows = db.prepare(`
  SELECT id, external_id, body, json_extract(evidence_json, '$.messageType') AS message_type
  FROM communications
  WHERE connector_id='whatsapp'
    AND COALESCE(json_extract(evidence_json, '$.messageType'), 'text') != 'text'
`).all() as { id: string; external_id: string; body: string; message_type: string | null }[];

let whatsappFixed = 0;
db.transaction(() => {
  for (const row of whatsappRows) {
    const isPlaceholder = /^\[[a-z0-9_]+\]$/i.test(row.body) || row.body === "WhatsApp message";
    const isHash = looksLikeContentHash(row.body);
    const isReaction = row.message_type === "reaction";
    if (!isPlaceholder && !isHash && !isReaction) continue;
    const body = describeWhatsAppMessage(isHash || isPlaceholder || isReaction ? null : row.body, row.message_type);
    if (body === row.body) continue;
    applyFix("whatsapp", row.id, row.external_id, body);
    whatsappFixed += 1;
  }
})();

console.log(`${dryRun ? "[dry-run] " : ""}Fixed ${messagesFixed} Messages bodies (${messagesMissing} no longer in chat.db) and ${whatsappFixed} WhatsApp bodies.`);
