/**
 * Human-readable bodies for synced messages. Apple stores modern message text
 * in the `attributedBody` typedstream blob, tapbacks as associated-message
 * codes, and WhatsApp media rows carry a base64 content hash instead of text.
 * Everything here turns those into short, readable evidence lines.
 */

const SNIPPET_LIMIT = 500;

/** Extract the text payload from an Apple `attributedBody` typedstream blob. */
export function decodeAttributedBody(blob: Buffer | Uint8Array | null | undefined): string | null {
  if (!blob || !blob.length) return null;
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const marker = buffer.indexOf(Buffer.from("NSString"));
  if (marker === -1) return null;
  // Typedstream layout after "NSString": 0x01 0x94 0x84 0x01 0x2b, then a
  // length (1 byte, or 0x81 + uint16le, or 0x82 + uint32le), then UTF-8 text.
  const plus = buffer.indexOf(0x2b, marker + 8);
  if (plus === -1 || plus > marker + 16) return null;
  let index = plus + 1;
  if (index >= buffer.length) return null;
  let length = buffer[index]!;
  index += 1;
  if (length === 0x81) {
    if (index + 2 > buffer.length) return null;
    length = buffer.readUInt16LE(index);
    index += 2;
  } else if (length === 0x82) {
    if (index + 4 > buffer.length) return null;
    length = buffer.readUInt32LE(index);
    index += 4;
  }
  const end = index + length;
  if (length <= 0 || end > buffer.length) return null;
  const text = buffer.subarray(index, end).toString("utf8").trim();
  return text || null;
}

const TAPBACK_LABELS: Record<number, string> = {
  2000: "Loved a message",
  2001: "Liked a message",
  2002: "Disliked a message",
  2003: "Laughed at a message",
  2004: "Emphasized a message",
  2005: "Questioned a message",
};

export type AppleMessageParts = {
  text?: string | null;
  attributedBody?: Buffer | Uint8Array | null;
  associatedType?: number | null;
  associatedEmoji?: string | null;
  hasAttachments?: number | boolean | null;
};

/** Describe an iMessage row: real text when it exists, otherwise a precise label. */
export function describeAppleMessage(row: AppleMessageParts): string {
  const associated = Number(row.associatedType ?? 0);
  if (associated >= 2000 && associated < 3000) {
    const known = TAPBACK_LABELS[associated];
    if (known) return known;
    const emoji = String(row.associatedEmoji ?? "").trim();
    if (emoji) return `Reacted ${emoji} to a message`;
    if (associated === 2007) return "Sticker reaction";
    return "Reacted to a message";
  }
  if (associated >= 3000 && associated < 4000) return "Removed a reaction";

  // U+FFFC marks an inline attachment; alone it means "attachment only".
  const clean = (value: string | null | undefined) => String(value ?? "").replaceAll("\uFFFC", "").trim();
  const direct = clean(row.text);
  if (direct) return direct.slice(0, SNIPPET_LIMIT);
  const decoded = clean(decodeAttributedBody(row.attributedBody ?? null));
  if (decoded) return decoded.slice(0, SNIPPET_LIMIT);
  if (row.hasAttachments) return "Attachment";
  return "Message";
}

/** WhatsApp media rows carry a base64 content hash where text would be. */
export function looksLikeContentHash(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 20 || trimmed.includes(" ")) return false;
  if (/^[A-Za-z0-9+/]{20,}={0,2}$/.test(trimmed)) return true;
  if (/^[0-9A-F]{12,}$/.test(trimmed)) return true;
  return false;
}

const WHATSAPP_TYPE_LABELS: Record<string, string> = {
  image: "Photo",
  video: "Video",
  gif: "GIF",
  sticker: "Sticker",
  audio: "Voice message",
  ptt: "Voice message",
  document: "Document",
  location: "Location",
  contact: "Contact card",
  reaction: "Reacted to a message",
  system: "System notice",
  group_event: "Group update",
  call: "Call",
};

/** Describe a WhatsApp row: real text when it exists, otherwise the media kind. */
export function describeWhatsAppMessage(text: string | null | undefined, messageType: string | null | undefined): string {
  const type = String(messageType ?? "").trim();
  const trimmed = String(text ?? "").trim();
  const label = WHATSAPP_TYPE_LABELS[type];
  const usableText = trimmed && !looksLikeContentHash(trimmed) ? trimmed.slice(0, SNIPPET_LIMIT) : "";

  // Reactions store the target message id as "text" — never show it.
  if (type === "reaction") return label!;
  if (usableText) {
    // A caption or filename makes media rows far more recognisable.
    if (label && type !== "link") return `${label} — ${usableText.slice(0, 160)}`;
    return usableText;
  }
  if (label) return label;
  if (type && type !== "text") return "WhatsApp update";
  return "Message";
}
