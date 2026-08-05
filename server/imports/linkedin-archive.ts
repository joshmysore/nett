/**
 * Importer for the user's own official LinkedIn "Download your data" archive.
 *
 * The only input is a file the user already downloaded and handed to Nett:
 * either the whole `Basic_LinkedIn_Data_Export_*.zip` or the `Connections.csv`
 * inside it. Nothing in this module touches the network, a browser, a cookie,
 * or a LinkedIn session, and no fact is derived from a profile URL beyond
 * canonicalising the URL itself.
 */
import { createHash, randomUUID } from "node:crypto";
import { parse } from "csv-parse/sync";
import { unzipSync, type UnzipFileInfo } from "fflate";
import type Database from "better-sqlite3";
import { db as sharedDatabase } from "../db.js";
import { normalizeLinkedInProfileUrl } from "../enrichment/linkedin.js";

export const LINKEDIN_ARCHIVE_CONNECTOR_ID = "linkedin-archive";

/** What a Connections export really carries, for honest UI copy. Anything not
 *  listed under `provided` is absent from the file and must not be promised. */
export const LINKEDIN_ARCHIVE_CONTENTS = {
  provided: [
    "First name and last name",
    "Public profile URL",
    "Email address — only for connections who chose to share it, so most rows are blank",
    "Company",
    "Position",
    "The date you connected"
  ],
  notProvided: [
    "Location",
    "Languages",
    "Education, schools, and degrees",
    "Hometown",
    "Interests and skills",
    "Phone numbers",
    "Birthdays",
    "Mutual connections",
    "Messages and InMail",
    "Profile photos",
    "Anything about how well you know the person"
  ]
} as const;

const MAX_ROWS = 50_000;
const MAX_ZIP_ENTRIES = 2_000;
const MAX_CSV_BYTES = 64 * 1024 * 1024;
const MAX_PREAMBLE_LINES = 20;
const MAX_REPORTED_ROWS = 500;

export type LinkedInArchiveFile = {
  filename: string;
  bytes: Uint8Array;
};

export type LinkedInConnectionRow = {
  /** 1-based ordinal among data records, header excluded. */
  rowNumber: number;
  /** The CSV record exactly as it was read, keyed by its original headers. */
  raw: Record<string, string>;
  firstName: string;
  lastName: string;
  fullName: string;
  /** Canonicalised `https://www.linkedin.com/in/<slug>`, or null when the cell
   *  is empty or is not a personal profile URL. */
  profileUrl: string | null;
  rawProfileUrl: string;
  /** Lowercased and trimmed, or null when LinkedIn omitted the address. */
  email: string | null;
  rawEmail: string;
  company: string;
  position: string;
  /** `YYYY-MM-DD`, or null when the cell could not be parsed unambiguously. */
  connectedOn: string | null;
  connectedOnRaw: string;
  contentHash: string;
};

export type LinkedInParseResult = {
  /** Path of the CSV inside the zip, or null when a bare CSV was supplied. */
  entryName: string | null;
  /** Header cells exactly as they appeared. */
  headers: string[];
  /** Junk lines LinkedIn writes above the header. */
  preambleLines: number;
  rows: LinkedInConnectionRow[];
  skippedEmptyRows: number;
  rowsWithEmail: number;
  rowsWithProfileUrl: number;
  rowsWithUnparsedDate: number;
};

export type LinkedInMatchMethod =
  | "existing-identity"
  | "exact-email"
  | "profile-url"
  | "unique-exact-name"
  | "new-person"
  | "ambiguous-email"
  | "ambiguous-profile-url"
  | "ambiguous-exact-name"
  | "duplicate-name-in-file"
  | "duplicate-profile-url-in-file"
  | "no-name"
  | "content-hash-duplicate"
  | "missing-identity";

export type LinkedInRowStatus = "created" | "merged" | "review" | "invalid" | "duplicate-row";

export type LinkedInFieldConflict = {
  field: "company" | "job_title" | "linkedin_url";
  existing: string;
  incoming: string;
};

export type LinkedInMergeCandidate = {
  personId: string;
  name: string;
  reason: string;
  confidence: number;
};

export type LinkedInArchiveRowResult = {
  rowNumber: number;
  name: string;
  status: LinkedInRowStatus;
  method: LinkedInMatchMethod;
  confidence: number;
  personId: string | null;
  profileUrl: string | null;
  conflicts: LinkedInFieldConflict[];
  candidates: LinkedInMergeCandidate[];
  note?: string;
};

export type LinkedInArchiveCounts = {
  rows: number;
  created: number;
  merged: number;
  review: number;
  invalid: number;
  duplicateRows: number;
  conflicts: number;
  emailsPresent: number;
  profileUrlsPresent: number;
  unparsedDates: number;
};

export type LinkedInArchiveImportSummary = LinkedInArchiveCounts & {
  importId: string;
  duplicate: boolean;
  filename: string;
  fileHash: string;
  entryName: string | null;
  startedAt: string;
  completedAt: string;
  /** Rows that need a human: review, invalid, or a kept-existing conflict.
   *  Capped; the full record lives in `imported_rows`. */
  results: LinkedInArchiveRowResult[];
  resultsTruncated: boolean;
  contents: typeof LINKEDIN_ARCHIVE_CONTENTS;
};

export type LinkedInArchivePreview = {
  filename: string;
  fileHash: string;
  entryName: string | null;
  headers: string[];
  preambleLines: number;
  rows: number;
  rowsWithEmail: number;
  rowsWithProfileUrl: number;
  rowsWithUnparsedDate: number;
  skippedEmptyRows: number;
  /** A previous committed import of these exact bytes, if there is one. */
  alreadyImported: { importId: string; completedAt: string | null } | null;
  sample: LinkedInConnectionRow[];
  contents: typeof LINKEDIN_ARCHIVE_CONTENTS;
};

export type LinkedInArchiveOptions = {
  database?: Database.Database;
  /** Injectable clock, for deterministic tests. */
  now?: () => string;
};

/* ------------------------------------------------------------------ parsing */

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

function isConnectionsEntry(name: string): boolean {
  if (name.startsWith("__MACOSX/") || name.includes("/._") || name.startsWith("._")) return false;
  return /(?:^|\/)connections\.csv$/i.test(name);
}

function extractConnectionsCsv(bytes: Uint8Array): { name: string; data: Uint8Array } {
  const seen: string[] = [];
  const files = unzipSync(bytes, {
    filter: (file: UnzipFileInfo) => {
      seen.push(file.name);
      if (seen.length > MAX_ZIP_ENTRIES) {
        throw new Error("That archive contains too many files to be a LinkedIn data export");
      }
      if (!isConnectionsEntry(file.name)) return false;
      if (file.originalSize > MAX_CSV_BYTES) {
        throw new Error("Connections.csv in that archive is larger than 64 MB");
      }
      return true;
    }
  });
  const names = Object.keys(files)
    .sort((left, right) => left.split("/").length - right.split("/").length || left.localeCompare(right));
  if (!names.length) {
    const listed = seen.slice(0, 8).join(", ");
    throw new Error(
      `That zip does not contain Connections.csv${listed ? ` (found: ${listed})` : ""}. ` +
      "Request 'Connections' from LinkedIn's Get a copy of your data page, or upload Connections.csv directly."
    );
  }
  return { name: names[0], data: files[names[0]] };
}

type ArchiveField = "firstName" | "lastName" | "profileUrl" | "email" | "company" | "position" | "connectedOn";

const HEADER_ALIASES: Record<string, ArchiveField> = {
  first_name: "firstName",
  firstname: "firstName",
  last_name: "lastName",
  lastname: "lastName",
  url: "profileUrl",
  profile_url: "profileUrl",
  email_address: "email",
  email: "email",
  company: "company",
  position: "position",
  connected_on: "connectedOn"
};

function normalizeHeaderCell(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCsvLine(line: string): string[] {
  try {
    const records = parse(line, {
      columns: false,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: true
    }) as string[][];
    return records[0] ?? [];
  } catch {
    return [];
  }
}

/** LinkedIn writes two to four "Notes:" lines above the real header, and the
 *  count has changed between exports, so the header is detected rather than
 *  assumed to sit at a fixed offset. */
function looksLikeHeader(cells: string[]): boolean {
  if (cells.length < 3) return false;
  const mapped = new Set(
    cells.map((cell) => HEADER_ALIASES[normalizeHeaderCell(cell)]).filter(Boolean) as string[]
  );
  if (mapped.size < 3) return false;
  return mapped.has("firstName") || mapped.has("lastName") || mapped.has("profileUrl");
}

function findHeader(text: string): { offset: number; cells: string[]; preambleLines: number } {
  let offset = 0;
  for (let line = 0; line < MAX_PREAMBLE_LINES; line++) {
    const newline = text.indexOf("\n", offset);
    const raw = (newline === -1 ? text.slice(offset) : text.slice(offset, newline)).replace(/\r$/, "");
    const cells = parseCsvLine(raw);
    if (looksLikeHeader(cells)) return { offset, cells, preambleLines: line };
    if (newline === -1) break;
    offset = newline + 1;
  }
  throw new Error(
    "Could not find a LinkedIn Connections header row. Expected columns such as " +
    "First Name, Last Name, URL, Email Address, Company, Position, Connected On."
  );
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/** LinkedIn writes "21 Mar 2024" in most locales and "03/21/24" in some US
 *  exports. Slash dates are read as month-first — LinkedIn's US convention —
 *  and only flipped when the first component cannot be a month. Anything else
 *  returns null; the raw cell is always kept alongside. */
export function parseLinkedInConnectedOn(value: string): string | null {
  const text = value.trim();
  if (!text) return null;

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = /^(\d{1,2})\s+([\p{L}]{3,})\.?\s+(\d{4})$/u.exec(text);
  if (match) {
    const month = MONTHS[match[2].slice(0, 3).toLocaleLowerCase()];
    return month ? isoDate(Number(match[3]), month, Number(match[1])) : null;
  }

  match = /^([\p{L}]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/u.exec(text);
  if (match) {
    const month = MONTHS[match[1].slice(0, 3).toLocaleLowerCase()];
    return month ? isoDate(Number(match[3]), month, Number(match[2])) : null;
  }

  match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    let year = Number(match[3]);
    if (match[3].length === 2) year += year < 70 ? 2000 : 1900;
    const [month, day] = first > 12 && second <= 12 ? [second, first] : [first, second];
    return isoDate(year, month, day);
  }

  return null;
}

/** Canonicalisation only. A profile URL is never read for anything else. */
export function canonicalizeArchiveProfileUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  try {
    return normalizeLinkedInProfileUrl(raw.replace(/^http:\/\//i, "https://"));
  } catch {
    return null;
  }
}

function decodeCsv(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
}

export function parseLinkedInConnections(file: LinkedInArchiveFile): LinkedInParseResult {
  const bytes = file.bytes;
  if (!bytes.length) throw new Error("That file is empty");
  const zipped = looksLikeZip(bytes) || /\.zip$/i.test(file.filename);
  const source = zipped ? extractConnectionsCsv(bytes) : { name: null, data: bytes };
  if (!zipped && bytes.length > MAX_CSV_BYTES) throw new Error("That CSV is larger than 64 MB");

  const text = decodeCsv(source.data);
  const header = findHeader(text);
  const records = parse(text.slice(header.offset), {
    columns: false,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true
  }) as string[][];

  const headers = (records[0] ?? []).map((cell) => cell.replace(/^\uFEFF/, ""));
  const fieldIndex = new Map<string, number>();
  headers.forEach((cell, index) => {
    const field = HEADER_ALIASES[normalizeHeaderCell(cell)];
    if (field && !fieldIndex.has(field)) fieldIndex.set(field, index);
  });

  const rows: LinkedInConnectionRow[] = [];
  let skippedEmptyRows = 0;
  for (let index = 1; index < records.length; index++) {
    const cells = records[index];
    if (!cells.some((cell) => cell.trim())) {
      skippedEmptyRows++;
      continue;
    }
    if (rows.length >= MAX_ROWS) {
      throw new Error(`That export has more than ${MAX_ROWS.toLocaleString()} connections; split it before importing`);
    }
    const raw: Record<string, string> = {};
    headers.forEach((name, position) => {
      raw[name || `column_${position + 1}`] = cells[position] ?? "";
    });
    const cell = (field: string) => {
      const position = fieldIndex.get(field);
      return position === undefined ? "" : (cells[position] ?? "");
    };
    const firstName = cell("firstName").trim();
    const lastName = cell("lastName").trim();
    const rawProfileUrl = cell("profileUrl").trim();
    const rawEmail = cell("email").trim();
    const company = cell("company").trim();
    const position = cell("position").trim();
    const connectedOnRaw = cell("connectedOn").trim();
    const profileUrl = canonicalizeArchiveProfileUrl(rawProfileUrl);
    const email = rawEmail ? rawEmail.toLocaleLowerCase() : null;
    const connectedOn = parseLinkedInConnectedOn(connectedOnRaw);
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
    rows.push({
      rowNumber: rows.length + 1,
      raw,
      firstName,
      lastName,
      fullName,
      profileUrl,
      rawProfileUrl,
      email,
      rawEmail,
      company,
      position,
      connectedOn,
      connectedOnRaw,
      contentHash: createHash("sha256").update(JSON.stringify({
        fullName,
        profileUrl,
        email,
        company,
        position,
        connectedOn: connectedOn ?? connectedOnRaw
      })).digest("hex")
    });
  }

  return {
    entryName: source.name,
    headers,
    preambleLines: header.preambleLines,
    rows,
    skippedEmptyRows,
    rowsWithEmail: rows.filter((row) => row.email).length,
    rowsWithProfileUrl: rows.filter((row) => row.profileUrl).length,
    rowsWithUnparsedDate: rows.filter((row) => row.connectedOnRaw && !row.connectedOn).length
  };
}

/* ----------------------------------------------------------------- matching */

/** Mirrors the private name key used by the spreadsheet import in
 *  `server/index.ts`: accents folded, punctuation dropped, case ignored. */
function personNameKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function addToIndex(index: Map<string, Set<string>>, key: string, personId: string): void {
  if (!key) return;
  const bucket = index.get(key);
  if (bucket) bucket.add(personId);
  else index.set(key, new Set([personId]));
}

type MatchIndexes = {
  byProfileUrl: Map<string, Set<string>>;
  byName: Map<string, Set<string>>;
  personNames: Map<string, string>;
  appliedContentHashes: Map<string, string | null>;
};

function buildMatchIndexes(database: Database.Database): MatchIndexes {
  const byProfileUrl = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  const personNames = new Map<string, string>();

  const people = database.prepare(
    "SELECT id, preferred_name, nickname FROM people"
  ).all() as { id: string; preferred_name: string; nickname: string | null }[];
  for (const person of people) {
    personNames.set(person.id, person.preferred_name);
    addToIndex(byName, personNameKey(person.preferred_name ?? ""), person.id);
    if (person.nickname) addToIndex(byName, personNameKey(person.nickname), person.id);
  }

  const identities = database.prepare(`
    SELECT external_id, person_id FROM source_identities
    WHERE person_id IS NOT NULL AND connector_id IN ('linkedin-archive', 'linkedin-public', 'linkedin')
  `).all() as { external_id: string; person_id: string }[];
  for (const identity of identities) {
    const url = canonicalizeArchiveProfileUrl(identity.external_id);
    if (url) addToIndex(byProfileUrl, url, identity.person_id);
  }

  const recorded = database.prepare(`
    SELECT person_id, linkedin_url FROM nett_metadata
    WHERE linkedin_url IS NOT NULL AND TRIM(linkedin_url) <> ''
  `).all() as { person_id: string; linkedin_url: string }[];
  for (const row of recorded) {
    const url = canonicalizeArchiveProfileUrl(row.linkedin_url);
    if (url) addToIndex(byProfileUrl, url, row.person_id);
  }

  const appliedContentHashes = new Map<string, string | null>();
  const applied = database.prepare(`
    SELECT content_hash, matched_person_id FROM imported_rows
    WHERE content_hash IS NOT NULL AND status IN ('created', 'merged')
  `).all() as { content_hash: string; matched_person_id: string | null }[];
  for (const row of applied) {
    if (!appliedContentHashes.has(row.content_hash)) {
      appliedContentHashes.set(row.content_hash, row.matched_person_id);
    }
  }

  return { byProfileUrl, byName, personNames, appliedContentHashes };
}

type Resolution = {
  personId: string | null;
  status: Exclude<LinkedInRowStatus, "duplicate-row">;
  method: LinkedInMatchMethod;
  confidence: number;
  candidateIds: string[];
};

function resolveRow(
  database: Database.Database,
  row: LinkedInConnectionRow,
  indexes: MatchIndexes,
  duplicateNamesInFile: Set<string>,
  duplicateUrlsInFile: Set<string>
): Resolution {
  if (!row.fullName && !row.email && !row.profileUrl) {
    return { personId: null, status: "invalid", method: "missing-identity", confidence: 0, candidateIds: [] };
  }

  // 0. An identity this importer already linked. Not a match heuristic — a
  //    decision that was made and recorded on an earlier run.
  if (row.profileUrl) {
    const existing = database.prepare(`
      SELECT person_id FROM source_identities WHERE connector_id = ? AND external_id = ?
    `).get(LINKEDIN_ARCHIVE_CONNECTOR_ID, row.profileUrl) as { person_id: string | null } | undefined;
    if (existing?.person_id) {
      return {
        personId: existing.person_id,
        status: "merged",
        method: "existing-identity",
        confidence: 1,
        candidateIds: []
      };
    }
  }

  // 1. Exact normalised email.
  if (row.email) {
    const owners = database.prepare(`
      SELECT DISTINCT person_id FROM contact_methods
      WHERE kind = 'email' AND normalized_value = ? LIMIT 3
    `).all(row.email) as { person_id: string }[];
    if (owners.length === 1) {
      return {
        personId: owners[0].person_id,
        status: "merged",
        method: "exact-email",
        confidence: 1,
        candidateIds: []
      };
    }
    if (owners.length > 1) {
      return {
        personId: null,
        status: "review",
        method: "ambiguous-email",
        confidence: 0,
        candidateIds: owners.map((owner) => owner.person_id)
      };
    }
  }

  // 2. A profile URL already recorded for a person.
  if (row.profileUrl) {
    if (duplicateUrlsInFile.has(row.profileUrl)) {
      return {
        personId: null,
        status: "review",
        method: "duplicate-profile-url-in-file",
        confidence: 0,
        candidateIds: [...(indexes.byProfileUrl.get(row.profileUrl) ?? [])]
      };
    }
    const owners = [...(indexes.byProfileUrl.get(row.profileUrl) ?? [])];
    if (owners.length === 1) {
      return { personId: owners[0], status: "merged", method: "profile-url", confidence: 1, candidateIds: [] };
    }
    if (owners.length > 1) {
      return {
        personId: null,
        status: "review",
        method: "ambiguous-profile-url",
        confidence: 0,
        candidateIds: owners
      };
    }
  }

  // 3. An exact full-name match that is unique in the file and in the database.
  const nameKey = personNameKey(row.fullName);
  if (!nameKey) {
    return { personId: null, status: "review", method: "no-name", confidence: 0, candidateIds: [] };
  }
  const nameOwners = [...(indexes.byName.get(nameKey) ?? [])];
  if (duplicateNamesInFile.has(nameKey)) {
    return {
      personId: null,
      status: "review",
      method: "duplicate-name-in-file",
      confidence: 0,
      candidateIds: nameOwners
    };
  }
  if (nameOwners.length === 1) {
    return {
      personId: nameOwners[0],
      status: "merged",
      method: "unique-exact-name",
      confidence: 0.9,
      candidateIds: []
    };
  }
  if (nameOwners.length > 1) {
    return {
      personId: null,
      status: "review",
      method: "ambiguous-exact-name",
      confidence: 0,
      candidateIds: nameOwners
    };
  }

  // 4. Nobody plausible. A new person is safe: no existing record is touched.
  return { personId: null, status: "created", method: "new-person", confidence: 0.8, candidateIds: [] };
}

/* ------------------------------------------------------------------ writing */

const CONFLICT_FIELDS = ["company", "job_title", "linkedin_url"] as const;
const PROVENANCE_FIELDS = ["company", "job_title", "linkedin_url", "email", "linkedin_connected_on"];

function createArchivePerson(
  database: Database.Database,
  row: LinkedInConnectionRow,
  timestamp: string
): string {
  const id = randomUUID();
  const name = row.fullName || row.email || "Unnamed connection";
  database.prepare(`
    INSERT INTO people (id, preferred_name, first_name, last_name, avatar_seed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, row.firstName || null, row.lastName || null, id, timestamp, timestamp);
  database.prepare(`
    INSERT INTO nett_metadata (person_id, source_confidence, created_at, updated_at)
    VALUES (?, 0.7, ?, ?)
  `).run(id, timestamp, timestamp);
  return id;
}

function identityPayload(row: LinkedInConnectionRow, importId: string) {
  return {
    // Keys the merge review queue understands, so a human resolution applies
    // exactly the same facts this importer would have applied automatically.
    name: row.fullName,
    company: row.company,
    job_title: row.position,
    linkedin_url: row.profileUrl ?? "",
    addresses: row.email ? [{ kind: "email", value: row.rawEmail, normalized: row.email }] : [],
    connectedOn: row.connectedOn,
    connectedOnRaw: row.connectedOnRaw,
    source: LINKEDIN_ARCHIVE_CONNECTOR_ID,
    importId,
    rowNumber: row.rowNumber,
    raw: row.raw
  };
}

function externalIdFor(row: LinkedInConnectionRow): string {
  return row.profileUrl ?? `row:${row.contentHash}`;
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function sameText(left: unknown, right: unknown): boolean {
  return String(left ?? "").trim().toLocaleLowerCase() === String(right ?? "").trim().toLocaleLowerCase();
}

/* ------------------------------------------------------------------- public */

export function previewLinkedInArchive(
  file: LinkedInArchiveFile,
  options: LinkedInArchiveOptions = {}
): LinkedInArchivePreview {
  const database = options.database ?? sharedDatabase;
  const fileHash = createHash("sha256").update(file.bytes).digest("hex");
  const parsed = parseLinkedInConnections(file);
  const prior = database.prepare(`
    SELECT id, completed_at FROM imports WHERE file_hash = ? AND status = 'committed'
  `).get(fileHash) as { id: string; completed_at: string | null } | undefined;
  return {
    filename: file.filename,
    fileHash,
    entryName: parsed.entryName,
    headers: parsed.headers,
    preambleLines: parsed.preambleLines,
    rows: parsed.rows.length,
    rowsWithEmail: parsed.rowsWithEmail,
    rowsWithProfileUrl: parsed.rowsWithProfileUrl,
    rowsWithUnparsedDate: parsed.rowsWithUnparsedDate,
    skippedEmptyRows: parsed.skippedEmptyRows,
    alreadyImported: prior ? { importId: prior.id, completedAt: prior.completed_at } : null,
    sample: parsed.rows.slice(0, 10),
    contents: LINKEDIN_ARCHIVE_CONTENTS
  };
}

/**
 * Parse and apply a LinkedIn Connections export.
 *
 * Raw rows are written first, in their own transaction, so an export that
 * fails part-way through still leaves a complete, auditable record of what was
 * in the file. Nothing that already exists is overwritten: blank fields are
 * filled, and a differing value is kept and raised as a pending suggestion.
 */
export function importLinkedInArchive(
  file: LinkedInArchiveFile,
  options: LinkedInArchiveOptions = {}
): LinkedInArchiveImportSummary {
  const database = options.database ?? sharedDatabase;
  const clock = options.now ?? (() => new Date().toISOString());
  const startedAt = clock();
  const fileHash = createHash("sha256").update(file.bytes).digest("hex");

  const prior = database.prepare(`
    SELECT id, summary_json FROM imports WHERE file_hash = ? AND status = 'committed'
  `).get(fileHash) as { id: string; summary_json: string } | undefined;
  if (prior) {
    let priorSummary: Partial<LinkedInArchiveImportSummary> = {};
    try { priorSummary = JSON.parse(prior.summary_json) as Partial<LinkedInArchiveImportSummary>; } catch { /* keep counts at zero */ }
    return {
      ...emptyCounts(),
      ...priorSummary,
      importId: prior.id,
      duplicate: true,
      filename: file.filename,
      fileHash,
      entryName: priorSummary.entryName ?? null,
      startedAt,
      completedAt: priorSummary.completedAt ?? startedAt,
      results: priorSummary.results ?? [],
      resultsTruncated: priorSummary.resultsTruncated ?? false,
      contents: LINKEDIN_ARCHIVE_CONTENTS
    };
  }

  const parsed = parseLinkedInConnections(file);
  if (!parsed.rows.length) throw new Error("That Connections export does not contain any rows");

  const importId = randomUUID();

  // Phase one: the file, verbatim, before a single fact is interpreted.
  database.transaction(() => {
    database.prepare(`
      INSERT INTO imports (id, filename, file_hash, row_count, status, summary_json, created_at)
      VALUES (?, ?, ?, ?, 'processing', ?, ?)
    `).run(
      importId,
      file.filename,
      fileHash,
      parsed.rows.length,
      JSON.stringify({ entryName: parsed.entryName, headers: parsed.headers, preambleLines: parsed.preambleLines }),
      startedAt
    );
    const insertRow = database.prepare(`
      INSERT INTO imported_rows (id, import_id, row_number, raw_json, content_hash, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `);
    for (const row of parsed.rows) {
      insertRow.run(randomUUID(), importId, row.rowNumber, JSON.stringify(row.raw), row.contentHash, startedAt);
    }
  })();

  try {
    return applyRows(database, { file, fileHash, importId, parsed, startedAt, clock });
  } catch (error) {
    database.prepare(`
      UPDATE imports SET status = 'failed', summary_json = ?, completed_at = ? WHERE id = ?
    `).run(
      JSON.stringify({
        entryName: parsed.entryName,
        error: error instanceof Error ? error.message : String(error)
      }),
      clock(),
      importId
    );
    throw error;
  }
}

function emptyCounts(): LinkedInArchiveCounts {
  return {
    rows: 0, created: 0, merged: 0, review: 0, invalid: 0,
    duplicateRows: 0, conflicts: 0, emailsPresent: 0, profileUrlsPresent: 0, unparsedDates: 0
  };
}

function applyRows(
  database: Database.Database,
  context: {
    file: LinkedInArchiveFile;
    fileHash: string;
    importId: string;
    parsed: LinkedInParseResult;
    startedAt: string;
    clock: () => string;
  }
): LinkedInArchiveImportSummary {
  const { importId, parsed, startedAt, clock } = context;
  const indexes = buildMatchIndexes(database);

  const nameCounts = new Map<string, number>();
  const urlCounts = new Map<string, number>();
  for (const row of parsed.rows) {
    const key = personNameKey(row.fullName);
    if (key) nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    if (row.profileUrl) urlCounts.set(row.profileUrl, (urlCounts.get(row.profileUrl) ?? 0) + 1);
  }
  const duplicateNamesInFile = new Set([...nameCounts].filter(([, count]) => count > 1).map(([key]) => key));
  const duplicateUrlsInFile = new Set([...urlCounts].filter(([, count]) => count > 1).map(([key]) => key));

  const counts = emptyCounts();
  counts.rows = parsed.rows.length;
  counts.emailsPresent = parsed.rowsWithEmail;
  counts.profileUrlsPresent = parsed.rowsWithProfileUrl;
  counts.unparsedDates = parsed.rowsWithUnparsedDate;
  const attention: LinkedInArchiveRowResult[] = [];
  let attentionTruncated = false;
  const report = (result: LinkedInArchiveRowResult) => {
    if (attention.length < MAX_REPORTED_ROWS) attention.push(result);
    else attentionTruncated = true;
  };

  const finishRow = database.prepare(`
    UPDATE imported_rows
    SET source_identity_id = ?, matched_person_id = ?, match_method = ?, confidence = ?,
        status = ?, previous_values_json = ?
    WHERE import_id = ? AND row_number = ?
  `);

  database.transaction(() => {
    for (const row of parsed.rows) {
      const timestamp = clock();
      const externalId = externalIdFor(row);

      const alreadyApplied = indexes.appliedContentHashes.get(row.contentHash);
      if (alreadyApplied !== undefined) {
        counts.duplicateRows++;
        finishRow.run(
          null, alreadyApplied, "content-hash-duplicate", 1, "duplicate-row",
          JSON.stringify({ reason: "An identical row was already applied by an earlier import" }),
          importId, row.rowNumber
        );
        report({
          rowNumber: row.rowNumber,
          name: row.fullName,
          status: "duplicate-row",
          method: "content-hash-duplicate",
          confidence: 1,
          personId: alreadyApplied,
          profileUrl: row.profileUrl,
          conflicts: [],
          candidates: [],
          note: "Identical to a row already imported; nothing was changed."
        });
        continue;
      }

      const resolution = resolveRow(database, row, indexes, duplicateNamesInFile, duplicateUrlsInFile);

      if (resolution.status === "invalid") {
        counts.invalid++;
        finishRow.run(
          null, null, resolution.method, 0, "invalid",
          JSON.stringify({ reason: "The row has no name, email address, or profile URL" }),
          importId, row.rowNumber
        );
        report({
          rowNumber: row.rowNumber,
          name: "",
          status: "invalid",
          method: resolution.method,
          confidence: 0,
          personId: null,
          profileUrl: null,
          conflicts: [],
          candidates: [],
          note: "No name, email address, or profile URL."
        });
        continue;
      }

      let personId = resolution.personId;
      if (resolution.status === "created") {
        personId = createArchivePerson(database, row, timestamp);
        indexes.personNames.set(personId, row.fullName);
        addToIndex(indexes.byName, personNameKey(row.fullName), personId);
        if (row.profileUrl) addToIndex(indexes.byProfileUrl, row.profileUrl, personId);
      }

      const payload = JSON.stringify(identityPayload(row, importId));
      database.prepare(`
        INSERT INTO source_identities
          (id, person_id, connector_id, external_id, display_name, raw_json, linked_by, confidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(connector_id, external_id) DO UPDATE SET
          person_id = excluded.person_id, display_name = excluded.display_name,
          raw_json = excluded.raw_json, linked_by = excluded.linked_by,
          confidence = excluded.confidence, updated_at = excluded.updated_at
      `).run(
        randomUUID(),
        personId,
        LINKEDIN_ARCHIVE_CONNECTOR_ID,
        externalId,
        row.fullName || row.email || externalId,
        payload,
        resolution.status === "review" ? "unlinked" : resolution.method,
        resolution.confidence,
        timestamp,
        timestamp
      );
      const identityId = (database.prepare(
        "SELECT id FROM source_identities WHERE connector_id = ? AND external_id = ?"
      ).get(LINKEDIN_ARCHIVE_CONNECTOR_ID, externalId) as { id: string }).id;

      database.prepare(`
        INSERT INTO source_records
          (id, connector_id, external_id, source_identity_id, person_id, entity_type, raw_json, captured_at)
        VALUES (?, ?, ?, ?, ?, 'linkedin-connection', ?, ?)
        ON CONFLICT(connector_id, external_id, entity_type) DO UPDATE SET
          source_identity_id = excluded.source_identity_id, person_id = excluded.person_id,
          raw_json = excluded.raw_json, captured_at = excluded.captured_at
      `).run(randomUUID(), LINKEDIN_ARCHIVE_CONNECTOR_ID, externalId, identityId, personId, payload, timestamp);

      if (resolution.status === "review") {
        counts.review++;
        const candidates: LinkedInMergeCandidate[] = [];
        for (const candidateId of resolution.candidateIds.slice(0, 3)) {
          const name = indexes.personNames.get(candidateId)
            ?? (database.prepare("SELECT preferred_name FROM people WHERE id = ?").get(candidateId) as { preferred_name: string } | undefined)?.preferred_name
            ?? "";
          candidates.push({ personId: candidateId, name, reason: resolution.method, confidence: 0 });
          const pending = database.prepare(`
            SELECT 1 FROM merge_suggestions
            WHERE source_identity_id = ? AND candidate_person_id = ? AND status = 'pending'
          `).get(identityId, candidateId);
          if (!pending) {
            database.prepare(`
              INSERT INTO merge_suggestions
                (id, source_identity_id, candidate_person_id, reason, confidence, status, created_at)
              VALUES (?, ?, ?, ?, 0, 'pending', ?)
            `).run(randomUUID(), identityId, candidateId, resolution.method, timestamp);
          }
        }
        finishRow.run(
          identityId, null, resolution.method, 0, "review",
          JSON.stringify({ reason: reviewReason(resolution.method) }),
          importId, row.rowNumber
        );
        report({
          rowNumber: row.rowNumber,
          name: row.fullName,
          status: "review",
          method: resolution.method,
          confidence: 0,
          personId: null,
          profileUrl: row.profileUrl,
          conflicts: [],
          candidates,
          note: reviewReason(resolution.method)
        });
        continue;
      }

      if (resolution.status === "created") counts.created++;
      else counts.merged++;

      if (row.email) {
        database.prepare(`
          INSERT OR IGNORE INTO contact_methods
            (id, person_id, kind, value, normalized_value, label, source_identity_id, is_primary)
          VALUES (?, ?, 'email', ?, ?, 'linkedin-archive', ?, 0)
        `).run(randomUUID(), personId, row.rawEmail, row.email, identityId);
      }

      const current = database.prepare(`
        SELECT company, job_title, linkedin_url FROM nett_metadata WHERE person_id = ?
      `).get(personId) as { company: string | null; job_title: string | null; linkedin_url: string | null } | undefined;
      const incoming: Record<(typeof CONFLICT_FIELDS)[number], string> = {
        company: row.company,
        job_title: row.position,
        linkedin_url: row.profileUrl ?? ""
      };
      const applied: Record<string, string> = {};
      const previous: Record<string, string | null> = {};
      const conflicts: LinkedInFieldConflict[] = [];
      for (const field of CONFLICT_FIELDS) {
        const value = incoming[field];
        if (!value) continue;
        const existing = current?.[field] ?? null;
        if (blank(existing)) {
          applied[field] = value;
          previous[field] = existing;
        } else if (!sameText(existing, value)) {
          conflicts.push({ field, existing: String(existing), incoming: value });
        }
      }
      if (Object.keys(applied).length) {
        const assignments = Object.keys(applied).map((field) => `${field} = ?`).join(", ");
        database.prepare(`UPDATE nett_metadata SET ${assignments}, updated_at = ? WHERE person_id = ?`)
          .run(...Object.values(applied), timestamp, personId);
        database.prepare("UPDATE people SET updated_at = ? WHERE id = ?").run(timestamp, personId);
      }

      for (const conflict of conflicts) {
        counts.conflicts++;
        const proposed = JSON.stringify(conflict.incoming);
        const duplicate = database.prepare(`
          SELECT 1 FROM inference_suggestions
          WHERE person_id = ? AND field_name = ? AND model = ? AND status = 'pending' AND proposed_value_json = ?
        `).get(personId, conflict.field, LINKEDIN_ARCHIVE_CONNECTOR_ID, proposed);
        if (duplicate) continue;
        database.prepare(`
          INSERT INTO inference_suggestions
            (id, person_id, field_name, proposed_value_json, current_value_json, evidence_json,
             rationale, confidence, model, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0.6, ?, 'pending', ?)
        `).run(
          randomUUID(),
          personId,
          conflict.field,
          proposed,
          JSON.stringify(conflict.existing),
          JSON.stringify([`${LINKEDIN_ARCHIVE_CONNECTOR_ID}:${externalId}`]),
          `Your LinkedIn archive lists “${conflict.incoming}”. Nett already records “${conflict.existing}”, which was kept.`,
          LINKEDIN_ARCHIVE_CONNECTOR_ID,
          timestamp
        );
      }

      database.prepare(`
        DELETE FROM field_provenance
        WHERE person_id = ? AND connector_id = ? AND source_record_id = ?
          AND field_name IN (${PROVENANCE_FIELDS.map(() => "?").join(", ")})
      `).run(personId, LINKEDIN_ARCHIVE_CONNECTOR_ID, externalId, ...PROVENANCE_FIELDS);
      const insertProvenance = database.prepare(`
        INSERT INTO field_provenance
          (id, person_id, field_name, field_value, connector_id, source_record_id, confidence, observed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const observed: [string, string, number, string][] = [];
      if (row.company) observed.push(["company", row.company, 0.9, timestamp]);
      if (row.position) observed.push(["job_title", row.position, 0.9, timestamp]);
      if (row.profileUrl) observed.push(["linkedin_url", row.profileUrl, 1, timestamp]);
      if (row.email) observed.push(["email", row.email, 1, timestamp]);
      if (row.connectedOn || row.connectedOnRaw) {
        observed.push([
          "linkedin_connected_on",
          row.connectedOn ?? row.connectedOnRaw,
          row.connectedOn ? 1 : 0.3,
          row.connectedOn ? `${row.connectedOn}T00:00:00.000Z` : timestamp
        ]);
      }
      for (const [field, value, confidence, observedAt] of observed) {
        insertProvenance.run(randomUUID(), personId, field, value, LINKEDIN_ARCHIVE_CONNECTOR_ID, externalId, confidence, observedAt);
      }

      indexes.appliedContentHashes.set(row.contentHash, personId);
      finishRow.run(
        identityId,
        personId,
        resolution.method,
        resolution.confidence,
        resolution.status,
        JSON.stringify({ previous, applied, conflicts }),
        importId,
        row.rowNumber
      );
      if (conflicts.length) {
        report({
          rowNumber: row.rowNumber,
          name: row.fullName,
          status: resolution.status,
          method: resolution.method,
          confidence: resolution.confidence,
          personId,
          profileUrl: row.profileUrl,
          conflicts,
          candidates: [],
          note: "Existing values were kept; the archive's values are waiting for review."
        });
      }
    }

    database.prepare(`
      INSERT INTO connector_states
        (connector_id, permission_state, status, last_sync_at, last_error, records_seen, records_linked)
      VALUES (?, 'user-assisted', 'idle', ?, NULL, ?, ?)
      ON CONFLICT(connector_id) DO UPDATE SET
        permission_state = 'user-assisted', status = 'idle', last_sync_at = excluded.last_sync_at,
        last_error = NULL,
        records_seen = connector_states.records_seen + excluded.records_seen,
        records_linked = connector_states.records_linked + excluded.records_linked
    `).run(LINKEDIN_ARCHIVE_CONNECTOR_ID, startedAt, counts.rows, counts.created + counts.merged);
  })();

  const completedAt = clock();
  const summary: LinkedInArchiveImportSummary = {
    ...counts,
    importId,
    duplicate: false,
    filename: context.file.filename,
    fileHash: context.fileHash,
    entryName: parsed.entryName,
    startedAt,
    completedAt,
    results: attention,
    resultsTruncated: attentionTruncated,
    contents: LINKEDIN_ARCHIVE_CONTENTS
  };
  database.prepare(`
    UPDATE imports SET status = 'committed', summary_json = ?, completed_at = ? WHERE id = ?
  `).run(JSON.stringify(summary), completedAt, importId);
  return summary;
}

function reviewReason(method: LinkedInMatchMethod): string {
  switch (method) {
    case "ambiguous-email": return "More than one person already has this email address.";
    case "ambiguous-profile-url": return "More than one person already has this LinkedIn profile.";
    case "ambiguous-exact-name": return "More than one person already has this exact name.";
    case "duplicate-name-in-file": return "This name appears more than once in the export.";
    case "duplicate-profile-url-in-file": return "This profile URL appears more than once in the export.";
    case "no-name": return "The row has no name, so it cannot be matched automatically.";
    default: return "Needs a human decision.";
  }
}

export function getLinkedInArchiveImport(
  importId: string,
  options: LinkedInArchiveOptions = {}
): {
  id: string;
  filename: string;
  fileHash: string;
  rowCount: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
  summary: Partial<LinkedInArchiveImportSummary>;
} | null {
  const database = options.database ?? sharedDatabase;
  const row = database.prepare(`
    SELECT id, filename, file_hash, row_count, status, summary_json, created_at, completed_at
    FROM imports WHERE id = ?
  `).get(importId) as {
    id: string; filename: string; file_hash: string; row_count: number;
    status: string; summary_json: string; created_at: string; completed_at: string | null;
  } | undefined;
  if (!row) return null;
  let summary: Partial<LinkedInArchiveImportSummary> = {};
  try { summary = JSON.parse(row.summary_json) as Partial<LinkedInArchiveImportSummary>; } catch { /* summary is best-effort */ }
  return {
    id: row.id,
    filename: row.filename,
    fileHash: row.file_hash,
    rowCount: row.row_count,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    summary
  };
}

export type LinkedInArchiveImportedRow = {
  rowNumber: number;
  raw: Record<string, string>;
  status: string;
  matchMethod: string | null;
  matchedPersonId: string | null;
  matchedPersonName: string | null;
  confidence: number | null;
  sourceIdentityId: string | null;
  detail: Record<string, unknown>;
};

/** Paginated access to the stored rows of an import. The browser never loads
 *  a whole export; the review surfaces page through this. */
export function listLinkedInArchiveImportRows(
  importId: string,
  options: LinkedInArchiveOptions & { status?: string; limit?: number; offset?: number } = {}
): { rows: LinkedInArchiveImportedRow[]; total: number } {
  const database = options.database ?? sharedDatabase;
  const limit = Math.min(Math.max(Number(options.limit ?? 50), 1), 200);
  const offset = Math.max(Number(options.offset ?? 0), 0);
  const clauses = ["ir.import_id = ?"];
  const values: unknown[] = [importId];
  if (options.status) {
    clauses.push("ir.status = ?");
    values.push(options.status);
  }
  const where = `WHERE ${clauses.join(" AND ")}`;
  const total = (database.prepare(
    `SELECT COUNT(*) AS count FROM imported_rows ir ${where}`
  ).get(...values) as { count: number }).count;
  const rows = database.prepare(`
    SELECT ir.row_number, ir.raw_json, ir.status, ir.match_method, ir.matched_person_id,
           ir.confidence, ir.source_identity_id, ir.previous_values_json,
           p.preferred_name AS matched_person_name
    FROM imported_rows ir
    LEFT JOIN people p ON p.id = ir.matched_person_id
    ${where}
    ORDER BY ir.row_number
    LIMIT ? OFFSET ?
  `).all(...values, limit, offset) as Record<string, any>[];
  const readJson = <T>(value: string | null, fallback: T): T => {
    if (!value) return fallback;
    try { return JSON.parse(value) as T; } catch { return fallback; }
  };
  return {
    total,
    rows: rows.map((row) => ({
      rowNumber: row.row_number,
      raw: readJson<Record<string, string>>(row.raw_json, {}),
      status: row.status,
      matchMethod: row.match_method,
      matchedPersonId: row.matched_person_id,
      matchedPersonName: row.matched_person_name ?? null,
      confidence: row.confidence,
      sourceIdentityId: row.source_identity_id,
      detail: readJson<Record<string, unknown>>(row.previous_values_json, {})
    }))
  };
}
