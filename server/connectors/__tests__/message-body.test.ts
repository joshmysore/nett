import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeAttributedBody,
  describeAppleMessage,
  describeWhatsAppMessage,
  looksLikeContentHash,
} from "../message-body.js";

function typedstreamWithText(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const header = Buffer.from("streamtyped junk NSString", "utf8");
  const glue = Buffer.from([0x01, 0x94, 0x84, 0x01, 0x2b]);
  const length =
    payload.length < 0x81
      ? Buffer.from([payload.length])
      : Buffer.concat([Buffer.from([0x81]), (() => { const b = Buffer.alloc(2); b.writeUInt16LE(payload.length); return b; })()]);
  const trailer = Buffer.from([0x86, 0x84]);
  return Buffer.concat([header, glue, length, payload, trailer]);
}

test("decodeAttributedBody extracts short text", () => {
  assert.equal(decodeAttributedBody(typedstreamWithText("Have heard of this guy")), "Have heard of this guy");
});

test("decodeAttributedBody extracts long text via two-byte length", () => {
  const long = "a".repeat(300) + " end";
  assert.equal(decodeAttributedBody(typedstreamWithText(long)), long);
});

test("decodeAttributedBody returns null for garbage", () => {
  assert.equal(decodeAttributedBody(Buffer.from("no marker here")), null);
  assert.equal(decodeAttributedBody(null), null);
  assert.equal(decodeAttributedBody(Buffer.alloc(0)), null);
});

test("apple: plain text wins", () => {
  assert.equal(describeAppleMessage({ text: "hello there" }), "hello there");
});

test("apple: attributedBody text used when text column empty", () => {
  assert.equal(
    describeAppleMessage({ text: null, attributedBody: typedstreamWithText("hidden text") }),
    "hidden text",
  );
});

test("apple: tapbacks map to named reactions", () => {
  assert.equal(describeAppleMessage({ associatedType: 2000 }), "Loved a message");
  assert.equal(describeAppleMessage({ associatedType: 2001 }), "Liked a message");
  assert.equal(describeAppleMessage({ associatedType: 2003 }), "Laughed at a message");
  assert.equal(describeAppleMessage({ associatedType: 2006, associatedEmoji: "🔥" }), "Reacted 🔥 to a message");
  assert.equal(describeAppleMessage({ associatedType: 3001 }), "Removed a reaction");
});

test("apple: attachments and empty fallbacks", () => {
  assert.equal(describeAppleMessage({ text: "", hasAttachments: 1 }), "Attachment");
  assert.equal(describeAppleMessage({ text: "" }), "Message");
  // U+FFFC is the inline-attachment placeholder — alone it is not text.
  assert.equal(
    describeAppleMessage({ attributedBody: typedstreamWithText("\uFFFC"), hasAttachments: 1 }),
    "Attachment",
  );
  assert.equal(describeAppleMessage({ text: "\uFFFC look at this", hasAttachments: 1 }), "look at this");
});

test("content hash detection", () => {
  assert.equal(looksLikeContentHash("m8EFjleV59UDOle5RFdGkpPlLlXttbjJMp3byQUA+KY="), true);
  assert.equal(looksLikeContentHash("3A2EAFC1EFADAA34192C"), true);
  assert.equal(looksLikeContentHash("yes yes lol i get it"), false);
  assert.equal(looksLikeContentHash("Sorry fell asleep"), false);
});

test("whatsapp: media hashes replaced by kind labels", () => {
  assert.equal(describeWhatsAppMessage("m8EFjleV59UDOle5RFdGkpPlLlXttbjJMp3byQUA+KY=", "image"), "Photo");
  assert.equal(describeWhatsAppMessage("oj2h0qKSEE+rdZMH5kKPbd1EBv5+mF8DqvboJ0NI80E=", "audio"), "Voice message");
  assert.equal(describeWhatsAppMessage("3A2EAFC1EFADAA34192C", "reaction"), "Reacted to a message");
});

test("whatsapp: captions and filenames survive", () => {
  assert.equal(describeWhatsAppMessage("Have a great day!", "gif"), "GIF — Have a great day!");
  assert.equal(describeWhatsAppMessage("Mysore-Stat110-PSET1", "document"), "Document — Mysore-Stat110-PSET1");
  assert.equal(describeWhatsAppMessage("https://example.org/", "link"), "https://example.org/");
  assert.equal(describeWhatsAppMessage("plain text", "text"), "plain text");
});

test("whatsapp: unknown types degrade politely", () => {
  assert.equal(describeWhatsAppMessage(null, "type_59"), "WhatsApp update");
  assert.equal(describeWhatsAppMessage("", "system"), "System notice");
  assert.equal(describeWhatsAppMessage(null, "text"), "Message");
});
