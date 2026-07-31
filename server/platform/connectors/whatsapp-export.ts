import { createHash, randomUUID } from "node:crypto";
import type {
  IngestionCursor,
  NormalizedConversation,
  NormalizedInteraction,
  NormalizedSourceBundle,
  NormalizedSourceIdentity
} from "../domain.js";

export interface WhatsAppExportOptions {
  accountId: string;
  conversationExternalId: string;
  conversationTitle?: string;
  selfNames?: string[];
  selfPhones?: string[];
  dateOrder?: "DMY" | "MDY" | "YMD";
  sourceFileName?: string;
  capturedAt?: string;
}

export interface WhatsAppTextEntry {
  name: string;
  text: string;
}

/**
 * Archive extraction is intentionally injected. The parent may implement this
 * with its chosen zip library while enforcing archive size and path limits.
 */
export interface WhatsAppZipExtractionPort {
  extractTextEntries(
    archive: Uint8Array,
    options?: { signal?: AbortSignal; maxEntries?: number; maxUncompressedBytes?: number }
  ): Promise<WhatsAppTextEntry[]>;
}

interface ParsedRecord {
  occurredAt: string;
  author?: string;
  text: string;
  raw: string;
}

function hash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function canonicalName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function normalizePhone(value: string): string | undefined {
  const compact = value.replace(/[^\d+]/g, "");
  const digits = compact.replace(/\D/g, "");
  if (digits.length < 7) return undefined;
  return `+${digits}`;
}

function parseDateTime(rawDate: string, rawTime: string, order?: "DMY" | "MDY" | "YMD"): string | undefined {
  const numbers = rawDate.trim().split(/[./-]/).map(Number);
  if (numbers.length !== 3 || numbers.some((value) => !Number.isInteger(value))) return undefined;
  let selectedOrder = order;
  if (!selectedOrder) {
    if (numbers[0] >= 1000) selectedOrder = "YMD";
    else if (numbers[0] > 12) selectedOrder = "DMY";
    else if (numbers[1] > 12) selectedOrder = "MDY";
    else selectedOrder = "DMY";
  }
  const positions = selectedOrder === "DMY"
    ? { day: 0, month: 1, year: 2 }
    : selectedOrder === "MDY"
      ? { day: 1, month: 0, year: 2 }
      : { day: 2, month: 1, year: 0 };
  const day = numbers[positions.day];
  const month = numbers[positions.month];
  let year = numbers[positions.year];
  if (year < 100) year += year <= 69 ? 2000 : 1900;

  const timeMatch = /^\s*(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap]\.?m\.?)?\s*$/i.exec(rawTime);
  if (!timeMatch) return undefined;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? 0);
  const meridiem = timeMatch[4]?.replaceAll(".", "").toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  }
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) return undefined;
  return date.toISOString();
}

function splitRecordLine(
  line: string,
  dateOrder?: "DMY" | "MDY" | "YMD"
): { occurredAt: string; body: string } | undefined {
  const clean = line.replace(/^[\u200e\u200f\u202a-\u202e]+/, "");
  const bracketed = /^\[([^\],]+),\s*([^\]]+)\]\s*(.*)$/.exec(clean);
  const dashed = /^(\d{1,4}[./-]\d{1,2}[./-]\d{1,4}),?\s+(\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\s+-\s+(.*)$/i.exec(clean);
  const match = bracketed ?? dashed;
  if (!match) return undefined;
  const occurredAt = parseDateTime(match[1], match[2], dateOrder);
  return occurredAt ? { occurredAt, body: match[3] } : undefined;
}

function parseRecords(input: string, dateOrder?: "DMY" | "MDY" | "YMD"): ParsedRecord[] {
  const normalized = input.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const records: ParsedRecord[] = [];
  let current: ParsedRecord | undefined;
  for (const line of normalized.split("\n")) {
    const next = splitRecordLine(line, dateOrder);
    if (next) {
      if (current) records.push(current);
      const separator = next.body.indexOf(": ");
      const author = separator > 0 ? next.body.slice(0, separator).trim() : undefined;
      const text = separator > 0 ? next.body.slice(separator + 2) : next.body;
      current = {
        occurredAt: next.occurredAt,
        author,
        text,
        raw: line
      };
    } else if (current) {
      current.text += `\n${line}`;
      current.raw += `\n${line}`;
    }
  }
  if (current) records.push(current);
  return records;
}

function identityFor(accountId: string, author: string, selfNames: Set<string>, selfPhones: Set<string>): NormalizedSourceIdentity {
  const phone = normalizePhone(author);
  const normalizedName = canonicalName(author);
  const identityKey = phone ?? normalizedName;
  const isSelf = (phone ? selfPhones.has(phone) : false) || selfNames.has(normalizedName);
  return {
    source: "whatsapp-export",
    externalId: identityKey,
    stableId: `whatsapp:${hash(accountId, "identity", identityKey)}`,
    displayName: author.trim(),
    isSelf,
    addresses: phone
      ? [{ kind: "phone", value: author.trim(), normalized: phone }]
      : [{ kind: "platform", value: author.trim(), normalized: normalizedName }]
  };
}

export function parseWhatsAppExport(input: string, options: WhatsAppExportOptions): NormalizedSourceBundle {
  const records = parseRecords(input, options.dateOrder);
  const selfNames = new Set((options.selfNames ?? []).map(canonicalName));
  const selfPhones = new Set((options.selfPhones ?? []).map(normalizePhone).filter((value): value is string => Boolean(value)));
  const identities = new Map<string, NormalizedSourceIdentity>();
  for (const record of records) {
    if (!record.author) continue;
    const normalized = identityFor(options.accountId, record.author, selfNames, selfPhones);
    identities.set(normalized.stableId, normalized);
  }
  for (const name of options.selfNames ?? []) {
    const normalized = identityFor(options.accountId, name, selfNames, selfPhones);
    identities.set(normalized.stableId, normalized);
  }
  for (const phone of options.selfPhones ?? []) {
    const normalized = identityFor(options.accountId, phone, selfNames, selfPhones);
    identities.set(normalized.stableId, normalized);
  }

  const conversationStableId = `whatsapp:${hash(options.accountId, "conversation", options.conversationExternalId)}`;
  const participantIds = [...identities.values()].map((item) => item.stableId);
  const duplicateCounts = new Map<string, number>();
  const interactions = records.map((record): NormalizedInteraction => {
    const sender = record.author
      ? identityFor(options.accountId, record.author, selfNames, selfPhones)
      : undefined;
    const fingerprint = hash(
      options.accountId,
      options.conversationExternalId,
      record.occurredAt,
      record.author ?? "",
      record.text,
      record.raw
    );
    const duplicate = duplicateCounts.get(fingerprint) ?? 0;
    duplicateCounts.set(fingerprint, duplicate + 1);
    const externalId = `${fingerprint}:${duplicate}`;
    return {
      source: "whatsapp-export",
      externalId,
      stableId: `whatsapp:${hash(options.accountId, "message", externalId)}`,
      conversationStableId,
      senderIdentityStableId: sender?.stableId,
      participantIdentityStableIds: participantIds,
      direction: !sender ? "system" : sender.isSelf ? "outgoing" : "incoming",
      kind: !sender ? "system" : "message",
      occurredAt: record.occurredAt,
      text: record.text,
      attachments: /<media omitted>|<attached:.*>/i.test(record.text)
        ? [{ name: record.text, remoteRef: options.sourceFileName }]
        : undefined,
      rawRef: options.sourceFileName
    };
  });
  const conversation: NormalizedConversation = {
    source: "whatsapp-export",
    externalId: options.conversationExternalId,
    stableId: conversationStableId,
    title: options.conversationTitle,
    kind: identities.size > 2 ? "group" : "direct",
    participants: [...identities.values()].map((item) => ({
      identityStableId: item.stableId,
      role: item.isSelf ? "self" : "member",
      displayName: item.displayName
    })),
    startedAt: interactions[0]?.occurredAt,
    updatedAt: interactions.at(-1)?.occurredAt,
    rawRef: options.sourceFileName
  };
  const last = interactions.at(-1);
  const cursor: IngestionCursor = {
    connectorId: "whatsapp-export",
    scope: `${options.accountId}:${options.conversationExternalId}`,
    value: last ? `${last.occurredAt}:${last.externalId}` : "empty",
    version: 1,
    observedAt: options.capturedAt ?? new Date().toISOString()
  };
  return {
    connectorId: "whatsapp-export",
    accountId: options.accountId,
    batchId: randomUUID(),
    capturedAt: options.capturedAt ?? new Date().toISOString(),
    identities: [...identities.values()],
    conversations: [conversation],
    interactions,
    nextCursor: cursor,
    completeSnapshot: true
  };
}

export async function parseWhatsAppArchive(
  archive: Uint8Array,
  extractor: WhatsAppZipExtractionPort,
  optionsForEntry: (entry: WhatsAppTextEntry) => WhatsAppExportOptions,
  limits: { signal?: AbortSignal; maxEntries?: number; maxUncompressedBytes?: number } = {}
): Promise<NormalizedSourceBundle[]> {
  const entries = await extractor.extractTextEntries(archive, {
    signal: limits.signal,
    maxEntries: limits.maxEntries ?? 100,
    maxUncompressedBytes: limits.maxUncompressedBytes ?? 64 * 1024 * 1024
  });
  return entries
    .filter((entry) => entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => {
      const options = optionsForEntry(entry);
      return parseWhatsAppExport(entry.text, {
        ...options,
        sourceFileName: options.sourceFileName ?? entry.name
      });
    });
}
