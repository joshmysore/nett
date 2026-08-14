import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { normalizePhoneValue, openDatabase, storedPhoneValue } from "./migrations.js";
import { hometownSuggestionsFromInstitutions } from "./enrichment/hometown.js";
import { normalizeCultureValue } from "./intelligence/culture.js";
import { suggestCultureFromName, suggestGenderFromName } from "./intelligence/traits.js";

export type SourceContact = {
  sourceId: string;
  name: string;
  firstName?: string;
  lastName?: string;
  nickname?: string;
  phones?: string[];
  emails?: string[];
  company?: string;
  jobTitle?: string;
  birthday?: string;
  location?: string;
  notes?: string;
  raw?: unknown;
};

export function createDatabase(databasePath: string): Database.Database {
  return openDatabase(databasePath);
}

export const databasePath = path.resolve(process.env.NETT_DB_PATH || path.join(process.cwd(), "data", "nett.db"));
export const db: Database.Database = createDatabase(databasePath);

const now = () => new Date().toISOString();
export const normalizePhone = normalizePhoneValue;
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const listify = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (!value) return [];
  return String(value).split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
};

const futureConnectors = new Set(["linkedin", "calendar", "mcp"]);
for (const id of ["apple-contacts", "messages", "gmail", "whatsapp", "telegram", "linkedin-public", "csv", "manual", ...futureConnectors]) {
  db.prepare("INSERT OR IGNORE INTO connector_states (connector_id, permission_state, status) VALUES (?, ?, 'idle')")
    .run(id, id === "linkedin-public" ? "user-assisted" : futureConnectors.has(id) ? "future" : "unknown");
}
db.prepare("UPDATE connector_states SET permission_state='unknown' WHERE connector_id IN ('gmail','whatsapp','telegram') AND permission_state='future'").run();

const parse = <T>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};

export function getPeople() {
  const people = db.prepare(`
    SELECT p.*, m.*, p.id AS id,
      (SELECT COUNT(*) FROM memories mm WHERE mm.person_id = p.id) AS memory_count,
      (SELECT COUNT(*) FROM interactions ii WHERE ii.person_id = p.id) AS interaction_count
    FROM people p LEFT JOIN nett_metadata m ON m.person_id = p.id
    ORDER BY m.priority DESC, m.relationship_strength DESC, p.preferred_name ASC
  `).all() as Record<string, any>[];
  return hydratePeople(people);
}

function hydratePerson(row: Record<string, any>) {
  const tags = db.prepare("SELECT t.name FROM tags t JOIN contact_tags ct ON ct.tag_id = t.id WHERE ct.person_id = ? ORDER BY t.name").all(row.id).map((x: any) => x.name);
  const methods = db.prepare("SELECT kind, value, label, is_primary FROM contact_methods WHERE person_id = ? ORDER BY is_primary DESC").all(row.id);
  const sources = db.prepare("SELECT DISTINCT connector_id FROM source_records WHERE person_id = ? UNION SELECT DISTINCT source FROM contact_tags WHERE person_id = ?").all(row.id, row.id).map((x: any) => x.connector_id ?? x.source).filter(Boolean);
  return {
    ...row,
    name: row.preferred_name,
    tags,
    methods,
    sources: Array.from(new Set(["nett", ...sources])),
    hometown: parse(row.hometown, listify(row.hometown)),
    languages: parse(row.languages, listify(row.languages)),
    skills: parse(row.skills, listify(row.skills)),
    interests: parse(row.interests, listify(row.interests)),
    foods: parse(row.foods, listify(row.foods)),
    online_personality: parse(row.online_personality, listify(row.online_personality)),
    institutions: parse(row.institutions, listify(row.institutions)),
    mutuals: parse(row.mutuals, listify(row.mutuals))
  };
}

function hydratePeople(rows: Record<string, any>[]): Record<string, any>[] {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(",");
  const tagRows = db.prepare(`
    SELECT ct.person_id, t.name FROM tags t
    JOIN contact_tags ct ON ct.tag_id=t.id
    WHERE ct.person_id IN (${placeholders}) ORDER BY t.name
  `).all(...ids) as { person_id: string; name: string }[];
  const methodRows = db.prepare(`
    SELECT person_id, kind, value, label, is_primary FROM contact_methods
    WHERE person_id IN (${placeholders}) ORDER BY is_primary DESC
  `).all(...ids) as Record<string, any>[];
  const sourceRows = db.prepare(`
    SELECT person_id, connector_id AS source FROM source_records
    WHERE person_id IN (${placeholders})
    UNION
    SELECT person_id, source FROM contact_tags
    WHERE person_id IN (${placeholders})
  `).all(...ids, ...ids) as { person_id: string; source: string }[];
  const tags = new Map<string, string[]>();
  const methods = new Map<string, Record<string, any>[]>();
  const sources = new Map<string, string[]>();
  for (const row of tagRows) tags.set(row.person_id, [...(tags.get(row.person_id) ?? []), row.name]);
  for (const row of methodRows) methods.set(row.person_id, [...(methods.get(row.person_id) ?? []), row]);
  for (const row of sourceRows) sources.set(row.person_id, [...(sources.get(row.person_id) ?? []), row.source]);
  return rows.map((row) => ({
    ...row,
    name: row.preferred_name,
    tags: tags.get(row.id) ?? [],
    methods: methods.get(row.id) ?? [],
    sources: Array.from(new Set(["nett", ...(sources.get(row.id) ?? [])])),
    hometown: parse(row.hometown, listify(row.hometown)),
    languages: parse(row.languages, listify(row.languages)),
    skills: parse(row.skills, listify(row.skills)),
    interests: parse(row.interests, listify(row.interests)),
    foods: parse(row.foods, listify(row.foods)),
    online_personality: parse(row.online_personality, listify(row.online_personality)),
    institutions: parse(row.institutions, listify(row.institutions)),
    mutuals: parse(row.mutuals, listify(row.mutuals))
  }));
}

function getPeopleByIds(ids: string[]): Record<string, any>[] {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return [];
  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT p.*, m.*, p.id AS id,
      (SELECT COUNT(*) FROM memories mm WHERE mm.person_id=p.id) AS memory_count,
      (SELECT COUNT(*) FROM interactions ii WHERE ii.person_id=p.id) AS interaction_count
    FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
    WHERE p.id IN (${placeholders})
  `).all(...uniqueIds) as Record<string, any>[];
  const byId = new Map(hydratePeople(rows).map((person) => [person.id, person]));
  return uniqueIds.flatMap((id) => {
    const person = byId.get(id);
    return person ? [person] : [];
  });
}

/** Country is derived from the trailing segment of the free-text location.
 *  The rule is deliberately simple and is shown to the user in the UI. */
const COUNTRY_ALIASES: Record<string, string> = {
  us: "United States", usa: "United States", "u.s.": "United States", "u.s.a.": "United States",
  america: "United States", "united states of america": "United States",
  uk: "United Kingdom", "u.k.": "United Kingdom", "great britain": "United Kingdom",
  england: "United Kingdom", scotland: "United Kingdom", wales: "United Kingdom",
  schweiz: "Switzerland", suisse: "Switzerland", svizzera: "Switzerland",
  deutschland: "Germany", españa: "Spain", espana: "Spain", brasil: "Brazil",
  nederland: "Netherlands", "the netherlands": "Netherlands", holland: "Netherlands",
  österreich: "Austria", osterreich: "Austria", sverige: "Sweden", norge: "Norway",
  danmark: "Denmark", suomi: "Finland", italia: "Italy", portugal: "Portugal",
  méxico: "Mexico", mexico: "Mexico", uae: "United Arab Emirates",
};

/** US state codes, so "Dallas, TX" resolves to the United States. */
const US_STATES = new Set([
  "al","ak","az","ar","ca","co","ct","de","fl","ga","hi","id","il","in","ia","ks","ky","la","me",
  "md","ma","mi","mn","ms","mo","mt","ne","nv","nh","nj","nm","ny","nc","nd","oh","ok","or","pa",
  "ri","sc","sd","tn","tx","ut","vt","va","wa","wv","wi","wy","dc",
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware",
  "florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana",
  "maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana",
  "nebraska","nevada","new hampshire","new jersey","new mexico","new york","north carolina",
  "north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina",
  "south dakota","tennessee","texas","utah","vermont","virginia","washington","west virginia",
  "wisconsin","wyoming",
]);

export function countryFromLocation(location: unknown): string {
  const raw = String(location ?? "").trim();
  if (!raw) return "";
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  const tail = parts[parts.length - 1];
  const key = tail.toLowerCase();
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  if (US_STATES.has(key)) return "United States";
  // A bare city with no qualifier tells us nothing reliable about the country.
  if (parts.length === 1) return "";
  return tail.replace(/\s+/g, " ");
}

export type PeopleFilters = {
  query?: string;
  filter?: "all" | "strong" | "due" | "cold";
  country?: string;
  industry?: string;
  language?: string;
  relationship?: string;
  tag?: string;
  recency?: "" | "30d" | "90d" | "year" | "never";
  missing?: string;
};

/** Scalar/list metadata columns that may be queried as `missing=<field>`. */
const MISSING_SCALAR_FIELDS = new Set([
  "location", "industry", "company", "spike", "gender", "culture",
  "personality", "birthday", "relationship", "when_met", "where_met", "how_met",
  "last_contact",
]);
const MISSING_LIST_FIELDS = new Set([
  "hometown", "languages", "skills", "interests", "foods", "institutions", "mutuals",
  "online_personality",
]);
const MISSING_NUMERIC_FIELDS = new Set(["relationship_strength"]);

function emptyFieldPredicate(column: string) {
  if (MISSING_LIST_FIELDS.has(column)) {
    return `(NULLIF(TRIM(COALESCE(m.${column},'')),'') IS NULL OR TRIM(m.${column}) IN ('[]','null','""'))`;
  }
  if (MISSING_NUMERIC_FIELDS.has(column)) {
    return `COALESCE(m.${column}, 0) = 0`;
  }
  return `NULLIF(TRIM(COALESCE(m.${column},'')),'') IS NULL`;
}

function buildPeoplePredicate(options: PeopleFilters) {
  const where: string[] = [];
  const values: unknown[] = [];
  const query = String(options.query || "").trim();
  if (query) {
    const like = `%${query}%`;
    where.push(`(
      p.preferred_name LIKE ? OR p.nickname LIKE ? OR m.company LIKE ? OR m.industry LIKE ?
      OR m.location LIKE ? OR m.hometown LIKE ? OR m.notes LIKE ? OR m.quick_memories LIKE ?
      OR m.institutions LIKE ? OR m.interests LIKE ? OR m.mutuals LIKE ?
      OR EXISTS (
        SELECT 1 FROM memories mm WHERE mm.person_id=p.id AND mm.raw_text LIKE ?
      )
      OR EXISTS (
        SELECT 1 FROM contact_tags ct JOIN tags t ON t.id=ct.tag_id
        WHERE ct.person_id=p.id AND t.name LIKE ?
      )
    )`);
    values.push(...Array(13).fill(like));
  }
  const filter = options.filter || "all";
  if (filter === "strong") where.push("COALESCE(m.relationship_strength, 0) >= 75");
  if (filter === "due") where.push("m.follow_up_date IS NOT NULL AND date(m.follow_up_date) <= date('now')");
  if (filter === "cold") where.push("m.last_contact IS NOT NULL AND julianday('now') - julianday(m.last_contact) > 90");

  if (options.industry) { where.push("TRIM(LOWER(m.industry)) = ?"); values.push(options.industry.trim().toLowerCase()); }
  if (options.relationship) { where.push("TRIM(LOWER(m.relationship)) = ?"); values.push(options.relationship.trim().toLowerCase()); }
  if (options.language) { where.push("LOWER(COALESCE(m.languages,'')) LIKE ?"); values.push(`%${options.language.trim().toLowerCase()}%`); }
  if (options.country) {
    // Match any location whose text contains the country or, for the US, a state.
    where.push("TRIM(COALESCE(m.location,'')) <> ''");
  }
  if (options.tag) {
    where.push("EXISTS (SELECT 1 FROM contact_tags ct JOIN tags t ON t.id=ct.tag_id WHERE ct.person_id=p.id AND LOWER(t.name)=?)");
    values.push(options.tag.trim().toLowerCase());
  }
  if (options.recency === "30d") where.push("m.last_contact IS NOT NULL AND julianday('now') - julianday(m.last_contact) <= 30");
  if (options.recency === "90d") where.push("m.last_contact IS NOT NULL AND julianday('now') - julianday(m.last_contact) <= 90");
  if (options.recency === "year") where.push("m.last_contact IS NOT NULL AND julianday('now') - julianday(m.last_contact) <= 365");
  if (options.recency === "never") where.push("m.last_contact IS NULL");
  if (options.missing === "context") {
    where.push(`NULLIF(TRIM(COALESCE(m.relationship,'')),'') IS NULL
      AND NULLIF(TRIM(COALESCE(m.notes,'')),'') IS NULL
      AND NOT EXISTS (SELECT 1 FROM memories mm WHERE mm.person_id=p.id)`);
  } else if (options.missing === "tags") {
    where.push("NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.person_id=p.id)");
  } else if (options.missing && (
    MISSING_SCALAR_FIELDS.has(options.missing)
    || MISSING_LIST_FIELDS.has(options.missing)
    || MISSING_NUMERIC_FIELDS.has(options.missing)
  )) {
    where.push(emptyFieldPredicate(options.missing));
  }
  return { predicate: where.length ? `WHERE ${where.join(" AND ")}` : "", values };
}

export function getPeoplePage(options: PeopleFilters & { page?: number; limit?: number } = {}) {
  const limit = Math.min(Math.max(Number(options.limit || 50), 1), 100);
  const page = Math.max(Number(options.page || 1), 1);
  const { predicate, values } = buildPeoplePredicate(options);
  const country = String(options.country || "").trim();

  // Country is a derived value, so it is applied after the indexed predicates.
  // Only rows that already have a location reach this filter (23 of 1,616 today).
  if (country) {
    const candidates = db.prepare(`
      SELECT p.*, m.*, p.id AS id
      FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
      ${predicate}
      ORDER BY m.priority DESC, m.relationship_strength DESC, p.preferred_name ASC
    `).all(...values) as Record<string, any>[];
    const matched = candidates.filter((row) => countryFromLocation(row.location) === country);
    const slice = matched.slice((page - 1) * limit, (page - 1) * limit + limit);
    return { people: hydratePeople(slice), total: matched.length, page, limit };
  }

  const total = (db.prepare(`
    SELECT COUNT(*) AS count FROM people p
    LEFT JOIN nett_metadata m ON m.person_id=p.id
    ${predicate}
  `).get(...values) as { count: number }).count;
  const rows = db.prepare(`
    SELECT p.*, m.*, p.id AS id,
      (SELECT COUNT(*) FROM memories mm WHERE mm.person_id=p.id) AS memory_count
    FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
    ${predicate}
    ORDER BY m.priority DESC, m.relationship_strength DESC, p.preferred_name ASC
    LIMIT ? OFFSET ?
  `).all(...values, limit, (page - 1) * limit) as Record<string, any>[];
  return { people: hydratePeople(rows), total, page, limit };
}

export type Facet = { value: string; count: number };

/** Facet counts for the current result set. Values that do not occur are not
 *  listed: an empty facet is a real answer, not an "Unknown" bucket. */
export function peopleFacets(options: PeopleFilters = {}) {
  const { predicate, values } = buildPeoplePredicate({ ...options, country: "" });
  const scalar = (column: "industry" | "relationship") => db.prepare(`
    SELECT TRIM(m.${column}) AS value, COUNT(*) AS count
    FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
    ${predicate}${predicate ? " AND" : "WHERE"} NULLIF(TRIM(COALESCE(m.${column},'')),'') IS NOT NULL
    GROUP BY LOWER(TRIM(m.${column}))
    ORDER BY count DESC, value ASC LIMIT 24
  `).all(...values) as Facet[];

  const located = db.prepare(`
    SELECT m.location AS location FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
    ${predicate}${predicate ? " AND" : "WHERE"} NULLIF(TRIM(COALESCE(m.location,'')),'') IS NOT NULL
  `).all(...values) as { location: string }[];
  const countryCounts = new Map<string, number>();
  for (const row of located) {
    const country = countryFromLocation(row.location);
    if (country) countryCounts.set(country, (countryCounts.get(country) ?? 0) + 1);
  }

  const languageRows = db.prepare(`
    SELECT m.languages AS languages FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
    ${predicate}${predicate ? " AND" : "WHERE"} NULLIF(TRIM(COALESCE(m.languages,'')),'') IS NOT NULL
  `).all(...values) as { languages: string }[];
  const languageCounts = new Map<string, number>();
  for (const row of languageRows) {
    for (const language of parse(row.languages, listify(row.languages))) {
      const label = String(language).trim();
      if (label) languageCounts.set(label, (languageCounts.get(label) ?? 0) + 1);
    }
  }

  const tags = db.prepare(`
    SELECT t.name AS value, COUNT(*) AS count
    FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
    JOIN contact_tags ct ON ct.person_id=p.id JOIN tags t ON t.id=ct.tag_id
    ${predicate}
    GROUP BY LOWER(t.name) ORDER BY count DESC, value ASC LIMIT 24
  `).all(...values) as Facet[];

  const gapFields = [
    "hometown", "location", "industry", "company", "spike", "languages", "skills",
    "interests", "foods", "gender", "culture", "online_personality", "birthday",
    "relationship", "when_met", "where_met", "how_met", "institutions", "mutuals",
    "last_contact",
  ] as const;
  const gapSelect = gapFields
    .map((field) => `SUM(CASE WHEN ${emptyFieldPredicate(field)} THEN 1 ELSE 0 END) AS no_${field}`)
    .join(",\n      ");
  const recencyRow = db.prepare(`
    SELECT
      SUM(CASE WHEN m.last_contact IS NOT NULL AND julianday('now')-julianday(m.last_contact) <= 30 THEN 1 ELSE 0 END) AS d30,
      SUM(CASE WHEN m.last_contact IS NOT NULL AND julianday('now')-julianday(m.last_contact) <= 90 THEN 1 ELSE 0 END) AS d90,
      SUM(CASE WHEN m.last_contact IS NOT NULL AND julianday('now')-julianday(m.last_contact) <= 365 THEN 1 ELSE 0 END) AS year,
      SUM(CASE WHEN m.last_contact IS NULL THEN 1 ELSE 0 END) AS never,
      SUM(CASE WHEN NULLIF(TRIM(COALESCE(m.relationship,'')),'') IS NULL
        AND NULLIF(TRIM(COALESCE(m.notes,'')),'') IS NULL
        AND NOT EXISTS (SELECT 1 FROM memories mm WHERE mm.person_id=p.id)
        THEN 1 ELSE 0 END) AS no_context,
      ${gapSelect}
    FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
    ${predicate}
  `).get(...values) as Record<string, number | null>;

  const sorted = (map: Map<string, number>) => [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, 24);

  return {
    countries: sorted(countryCounts),
    industries: scalar("industry"),
    languages: sorted(languageCounts),
    relationships: scalar("relationship"),
    tags,
    recency: [
      { value: "30d", count: recencyRow.d30 ?? 0 },
      { value: "90d", count: recencyRow.d90 ?? 0 },
      { value: "year", count: recencyRow.year ?? 0 },
      { value: "never", count: recencyRow.never ?? 0 },
    ].filter((entry) => entry.count > 0),
    missing: [
      { value: "context", count: recencyRow.no_context ?? 0 },
      ...gapFields.map((field) => ({
        value: field,
        count: recencyRow[`no_${field}`] ?? 0,
      })),
      {
        value: "tags",
        count: (db.prepare(`
          SELECT COUNT(*) AS count FROM people p
          LEFT JOIN nett_metadata m ON m.person_id=p.id
          ${predicate ? `${predicate} AND` : "WHERE"}
          NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.person_id=p.id)
        `).get(...values) as { count: number }).count,
      },
    ].filter((entry) => entry.count > 0),
  };
}

export function getPerson(id: string) {
  const row = db.prepare("SELECT p.*, m.*, p.id AS id FROM people p LEFT JOIN nett_metadata m ON m.person_id = p.id WHERE p.id = ?").get(id) as Record<string, any> | undefined;
  if (!row) return null;
  const person = hydratePerson(row);
  const memories = db.prepare("SELECT * FROM memories WHERE person_id = ? ORDER BY occurred_at DESC").all(id).map((m: any) => ({ ...m, structured: parse(m.structured_json, {}) }));
  const interactions = db.prepare("SELECT * FROM interactions WHERE person_id = ? ORDER BY occurred_at DESC LIMIT 40").all(id).map((i: any) => ({ ...i, evidence: parse(i.evidence_json, {}) }));
  const provenance = db.prepare("SELECT * FROM field_provenance WHERE person_id = ? ORDER BY observed_at DESC").all(id);
  const identities = db.prepare("SELECT id, connector_id, external_id, display_name, linked_by, confidence, updated_at FROM source_identities WHERE person_id = ?").all(id);
  return { ...person, memories, interactions, provenance, identities };
}

export function findExactPerson(emails: string[] = [], phones: string[] = []) {
  const normalizedEmails = emails.map(normalizeEmail).filter(Boolean);
  const normalizedPhones = phones.map((phone) => normalizePhone(phone)).filter(Boolean);
  const clauses: string[] = [];
  const values: string[] = [];
  if (normalizedEmails.length) {
    clauses.push(`(kind = 'email' AND normalized_value IN (${normalizedEmails.map(() => "?").join(",")}))`);
    values.push(...normalizedEmails);
  }
  if (normalizedPhones.length) {
    clauses.push(`(kind = 'phone' AND normalized_value IN (${normalizedPhones.map(() => "?").join(",")}))`);
    values.push(...normalizedPhones);
  }
  if (!clauses.length) return null;
  return db.prepare(`SELECT person_id FROM contact_methods WHERE ${clauses.join(" OR ")} LIMIT 1`)
    .get(...values) as { person_id: string } | undefined;
}

export function createPerson(name: string, source = "nett") {
  const id = randomUUID();
  const parts = name.trim().split(/\s+/);
  const timestamp = now();
  db.prepare("INSERT INTO people (id, preferred_name, first_name, last_name, avatar_seed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, name.trim(), parts[0] ?? "", parts.slice(1).join(" "), id, timestamp, timestamp);
  db.prepare("INSERT INTO nett_metadata (person_id, source_confidence, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, source === "nett" ? 1 : 0.7, timestamp, timestamp);
  // Gender and culture auto-fill from name tables when unambiguous. Provenance
  // records them as name inference so the source stays visible and editable.
  const personName = { preferred_name: name.trim(), first_name: parts[0], last_name: parts.slice(1).join(" ") };
  const inferredGender = suggestGenderFromName({ ...personName, gender: "" });
  if (inferredGender) {
    db.prepare("UPDATE nett_metadata SET gender=?, updated_at=? WHERE person_id=?").run(String(inferredGender.value), timestamp, id);
    db.prepare("INSERT INTO field_provenance (id, person_id, field_name, field_value, connector_id, confidence, observed_at) VALUES (?, ?, 'gender', ?, 'name-inference', ?, ?)")
      .run(randomUUID(), id, String(inferredGender.value), inferredGender.confidence, timestamp);
  }
  const inferredCulture = suggestCultureFromName({ ...personName, culture: "" });
  if (inferredCulture) {
    db.prepare("UPDATE nett_metadata SET culture=?, updated_at=? WHERE person_id=?").run(String(inferredCulture.value), timestamp, id);
    db.prepare("INSERT INTO field_provenance (id, person_id, field_name, field_value, connector_id, confidence, observed_at) VALUES (?, ?, 'culture', ?, 'name-inference', ?, ?)")
      .run(randomUUID(), id, String(inferredCulture.value), inferredCulture.confidence, timestamp);
  }
  return id;
}

export function upsertSourceContacts(connectorId: string, contacts: SourceContact[]) {
  let linked = 0;
  let created = 0;
  const timestamp = now();
  const tx = db.transaction(() => {
    for (const contact of contacts) {
      const existing = db.prepare("SELECT id, person_id FROM source_identities WHERE connector_id = ? AND external_id = ?").get(connectorId, contact.sourceId) as { id: string; person_id: string | null } | undefined;
      let personId = existing?.person_id ?? findExactPerson(contact.emails, contact.phones)?.person_id ?? null;
      let linkedBy = existing?.person_id ? "existing" : personId ? "exact-contact-method" : null;
      if (!personId) {
        personId = createPerson(contact.name || "Unnamed contact", connectorId);
        linkedBy = "new-person";
        created++;
      } else linked++;
      const identityId = existing?.id ?? randomUUID();
      db.prepare(`INSERT INTO source_identities (id, person_id, connector_id, external_id, display_name, raw_json, linked_by, confidence, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(connector_id, external_id) DO UPDATE SET person_id=excluded.person_id, display_name=excluded.display_name, raw_json=excluded.raw_json, linked_by=excluded.linked_by, confidence=excluded.confidence, updated_at=excluded.updated_at`)
        .run(identityId, personId, connectorId, contact.sourceId, contact.name, JSON.stringify(contact.raw ?? contact), linkedBy, linkedBy === "exact-contact-method" ? 1 : 0.8, timestamp, timestamp);
      db.prepare(`INSERT INTO source_records (id, connector_id, external_id, source_identity_id, person_id, entity_type, raw_json, captured_at)
        VALUES (?, ?, ?, ?, ?, 'contact', ?, ?) ON CONFLICT(connector_id, external_id, entity_type) DO UPDATE SET source_identity_id=excluded.source_identity_id, person_id=excluded.person_id, raw_json=excluded.raw_json, captured_at=excluded.captured_at`)
        .run(randomUUID(), connectorId, contact.sourceId, identityId, personId, JSON.stringify(contact.raw ?? contact), timestamp);
      [...(contact.emails ?? []).map((v) => ["email", v, normalizeEmail(v)]), ...(contact.phones ?? []).map((v) => ["phone", v, storedPhoneValue(v)])].forEach(([kind, value, normalized]) => {
        if (normalized) db.prepare("INSERT OR IGNORE INTO contact_methods (id, person_id, kind, value, normalized_value, source_identity_id, is_primary) VALUES (?, ?, ?, ?, ?, ?, 0)").run(randomUUID(), personId, kind, value, normalized, identityId);
      });
      const fields: [string, string | undefined][] = [["company", contact.company], ["job_title", contact.jobTitle], ["birthday", contact.birthday], ["location", contact.location], ["apple_note", contact.notes]];
      db.prepare("DELETE FROM field_provenance WHERE person_id=? AND connector_id=? AND source_record_id=? AND field_name IN ('company','job_title','birthday','location','apple_note')")
        .run(personId, connectorId, contact.sourceId);
      fields.forEach(([field, value]) => {
        if (value) db.prepare("INSERT INTO field_provenance (id, person_id, field_name, field_value, connector_id, source_record_id, confidence, observed_at) VALUES (?, ?, ?, ?, ?, ?, 0.95, ?)").run(randomUUID(), personId, field, value, connectorId, contact.sourceId, timestamp);
      });
      db.prepare("UPDATE people SET preferred_name=CASE WHEN preferred_name LIKE 'Unnamed%' THEN ? ELSE preferred_name END, nickname=COALESCE(nickname, ?), updated_at=? WHERE id=?").run(contact.name, contact.nickname ?? null, timestamp, personId);
      db.prepare("UPDATE nett_metadata SET company=COALESCE(company, ?), birthday=COALESCE(birthday, ?), location=COALESCE(location, ?), updated_at=? WHERE person_id=?").run(contact.company ?? null, contact.birthday ?? null, contact.location ?? null, timestamp, personId);
    }
  });
  tx();
  return { seen: contacts.length, linked, created };
}

export function addMemory(personId: string, rawText: string, structured: Record<string, unknown> = {}, source = "manual") {
  const id = randomUUID();
  const timestamp = now();
  db.prepare("INSERT INTO memories (id, person_id, raw_text, structured_json, source, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, personId, rawText, JSON.stringify(structured), source, timestamp, timestamp);
  const tags = Array.isArray(structured.tags) ? structured.tags as string[] : [];
  tags.forEach((tag) => {
    const tagId = `tag-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    db.prepare("INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)").run(tagId, tag);
    db.prepare("INSERT OR IGNORE INTO contact_tags (person_id, tag_id, source) VALUES (?, ?, ?)").run(personId, tagId, source);
  });
  const followUp = structured.followUpDate ?? structured.follow_up_date;
  if (followUp) db.prepare("UPDATE nett_metadata SET follow_up_date=?, updated_at=? WHERE person_id=?").run(followUp, timestamp, personId);

  // Approved capture proposals become person fields. List values merge; scalars
  // fill empty slots only so an accepted fact never silently clobbers one.
  const person = getPerson(personId) as Record<string, any> | null;
  if (person) {
    const listFields = [
      "hometown", "languages", "skills", "interests", "foods", "institutions", "mutuals",
      "online_personality",
    ] as const;
    const scalarFields = [
      "location", "industry", "company", "spike", "relationship", "when_met", "where_met",
      "how_met", "gender", "culture", "personality", "birthday",
    ] as const;
    const update: Record<string, unknown> = {};
    for (const field of listFields) {
      const incoming = structured[field];
      if (incoming === undefined || incoming === null || incoming === "") continue;
      const additions = listify(incoming).map((item) => item.trim()).filter(Boolean);
      if (!additions.length) continue;
      const current = listify(person[field]);
      const seen = new Set(current.map((item) => item.toLocaleLowerCase()));
      const combined = [...current];
      for (const item of additions) {
        const key = item.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        combined.push(item);
      }
      if (combined.length !== current.length) update[field] = combined;
    }
    for (const field of scalarFields) {
      const incoming = structured[field];
      if (incoming === undefined || incoming === null) continue;
      const value = Array.isArray(incoming) ? incoming.map(String).filter(Boolean).join(", ") : String(incoming).trim();
      if (!value) continue;
      const current = person[field];
      if (current == null || current === "" || (Array.isArray(current) && current.length === 0)) {
        update[field] = value;
      }
    }
    if (Object.keys(update).length) updatePerson(personId, update, source);
  }

  return getPerson(personId);
}

/** Gender is a two-option field. Shorthand normalises to male/female; anything unrecognised clears to empty rather than storing free text. */
export function normalizeGenderValue(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";
  if (["m", "male", "man", "boy", "he", "him"].includes(raw)) return "male";
  if (["f", "female", "woman", "girl", "she", "her"].includes(raw)) return "female";
  return "";
}

export function updatePerson(id: string, input: Record<string, unknown>, source = "nett") {
  const timestamp = now();
  if (input.name) db.prepare("UPDATE people SET preferred_name=?, updated_at=? WHERE id=?").run(String(input.name), timestamp, id);
  if ("gender" in input) input = { ...input, gender: normalizeGenderValue(input.gender) };
  if ("culture" in input) input = { ...input, culture: normalizeCultureValue(input.culture) };
  if ("tags" in input) {
    const tags = (Array.isArray(input.tags) ? input.tags : String(input.tags ?? "").split(","))
      .map((tag) => String(tag).trim())
      .filter(Boolean);
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM contact_tags WHERE person_id=? AND source=?").run(id, source);
      for (const tag of tags) {
        const tagId = `tag-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
        db.prepare("INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)").run(tagId, tag);
        db.prepare("INSERT OR IGNORE INTO contact_tags (person_id, tag_id, source) VALUES (?, ?, ?)").run(id, tagId, source);
      }
      db.prepare("INSERT INTO field_provenance (id, person_id, field_name, field_value, connector_id, confidence, observed_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
        .run(randomUUID(), id, "tags", tags.join(", "), source, timestamp);
    });
    tx();
  }
  const allowed = [
    "hometown", "location", "industry", "company", "spike", "languages", "skills", "interests",
    "foods", "gender", "culture", "personality", "online_personality", "birthday",
    "relationship_strength", "relationship", "when_met", "where_met", "how_met", "institutions",
    "mutuals", "last_contact", "notes", "quick_memories", "follow_up_date", "priority", "warmth",
    "intro_potential", "source_confidence", "linkedin_url", "headline", "job_title",
  ];
  const entries = Object.entries(input).filter(([key]) => allowed.includes(key));
  if (entries.length) {
    const values = entries.map(([, value]) => Array.isArray(value) ? JSON.stringify(value) : value);
    db.prepare(`UPDATE nett_metadata SET ${entries.map(([key]) => `${key}=?`).join(",")}, updated_at=? WHERE person_id=?`).run(...values, timestamp, id);
    entries.forEach(([key, value]) => db.prepare("INSERT INTO field_provenance (id, person_id, field_name, field_value, connector_id, confidence, observed_at) VALUES (?, ?, ?, ?, ?, 1, ?)").run(randomUUID(), id, key, Array.isArray(value) ? value.join(", ") : String(value ?? ""), source, timestamp));
  }
  return getPerson(id);
}

export function connectorStates() {
  return db.prepare("SELECT * FROM connector_states ORDER BY CASE permission_state WHEN 'future' THEN 2 ELSE 1 END, connector_id").all().map((row: any) => ({ ...row, settings: parse(row.settings_json, {}) }));
}

export function mergeReviewQueue() {
  const rows = db.prepare(`
    SELECT ms.id AS suggestion_id, si.id AS source_identity_id, ms.candidate_person_id,
      ms.reason, ms.confidence, ms.status, si.display_name, si.connector_id,
      si.raw_json, p.preferred_name AS candidate_name, m.company AS candidate_company
    FROM source_identities si
    LEFT JOIN merge_suggestions ms ON ms.source_identity_id = si.id AND ms.status = 'pending'
    LEFT JOIN people p ON p.id = ms.candidate_person_id
    LEFT JOIN nett_metadata m ON m.person_id = p.id
    WHERE ms.status = 'pending'
      OR (
        si.person_id IS NULL
        AND COALESCE(json_extract(si.raw_json, '$.isSelf'), 0) = 0
      )
    ORDER BY si.created_at DESC, ms.confidence DESC
  `).all() as Record<string, any>[];
  const groups = new Map<string, any>();
  rows.forEach((row) => {
    if (!groups.has(row.source_identity_id)) groups.set(row.source_identity_id, { sourceIdentityId: row.source_identity_id, displayName: row.display_name, connectorId: row.connector_id, raw: parse(row.raw_json, {}), candidates: [] });
    if (row.suggestion_id) groups.get(row.source_identity_id).candidates.push({ suggestionId: row.suggestion_id, personId: row.candidate_person_id, name: row.candidate_name, company: row.candidate_company, confidence: row.confidence, reason: row.reason });
  });
  return [...groups.values()];
}

export function resolveMerge(sourceIdentityId: string, personId?: string, createNew = false) {
  const identity = db.prepare("SELECT * FROM source_identities WHERE id = ?").get(sourceIdentityId) as Record<string, any> | undefined;
  if (!identity) throw new Error("Source identity not found");
  const raw = parse<Record<string, any>>(identity.raw_json, {});
  const createdNew = createNew;
  let resolvedPersonId = personId;
  if (createNew) resolvedPersonId = createPerson(raw.name || identity.display_name || "Imported person", identity.connector_id);
  if (!resolvedPersonId || !getPerson(resolvedPersonId)) throw new Error("Choose a valid person or create a new one");
  const timestamp = now();
  const tx = db.transaction(() => {
    db.prepare("UPDATE source_identities SET person_id=?, linked_by='manual-review', confidence=1, updated_at=? WHERE id=?").run(resolvedPersonId, timestamp, sourceIdentityId);
    db.prepare("UPDATE source_records SET person_id=? WHERE source_identity_id=?").run(resolvedPersonId, sourceIdentityId);
    db.prepare("UPDATE merge_suggestions SET status=CASE WHEN candidate_person_id=? THEN 'accepted' ELSE 'rejected' END WHERE source_identity_id=?").run(resolvedPersonId, sourceIdentityId);
    db.prepare(`
      UPDATE imported_rows
      SET matched_person_id=?, match_method='manual-review', confidence=1, status='merged'
      WHERE (source_identity_id=? OR (source_identity_id IS NULL AND raw_json=?)) AND status='review'
    `).run(resolvedPersonId, sourceIdentityId, identity.raw_json);
    const current = getPerson(resolvedPersonId!) as Record<string, any>;
    const update: Record<string, unknown> = {};
    const listFields = new Set([
      "hometown", "languages", "skills", "interests", "foods", "institutions", "mutuals",
      "online_personality",
    ]);
    [
      "hometown", "location", "industry", "company", "spike", "languages", "skills", "interests",
      "foods", "gender", "culture", "personality", "online_personality", "birthday",
      "relationship_strength", "relationship", "when_met", "where_met", "how_met", "institutions",
      "mutuals", "last_contact", "notes", "quick_memories", "follow_up_date", "priority", "warmth",
      "intro_potential", "source_confidence", "linkedin_url", "headline", "job_title",
    ].forEach((field) => {
      if (raw[field] === undefined || raw[field] === "") return;
      if (listFields.has(field)) {
        const currentValues = listify(current[field]);
        const combined = [...new Set([...currentValues, ...listify(raw[field])])];
        if (createdNew || combined.length !== currentValues.length) update[field] = combined;
      } else if (createdNew || current[field] == null || current[field] === "") {
        update[field] = raw[field];
      }
    });
    updatePerson(resolvedPersonId!, update, identity.connector_id);
    if (raw.quick_memories) {
      const memoryExists = db.prepare(`
        SELECT 1 FROM memories
        WHERE person_id=? AND source=? AND json_extract(structured_json, '$.sourceIdentityId')=?
      `).get(resolvedPersonId, identity.connector_id, sourceIdentityId);
      if (!memoryExists) {
        addMemory(
          resolvedPersonId!,
          raw.quick_memories,
          { imported: true, sourceIdentityId },
          identity.connector_id
        );
      }
    }
    const addresses = Array.isArray(raw.addresses) ? raw.addresses as Record<string, any>[] : [];
    for (const address of addresses) {
      const addressKind = String(address.kind || "platform");
      const kind = addressKind === "email" || addressKind === "phone"
        ? addressKind
        : `${identity.connector_id}:${addressKind}`;
      const value = String(address.value || "");
      const normalized = addressKind === "email"
        ? normalizeEmail(String(address.normalized || value))
        : addressKind === "phone"
          ? normalizePhone(String(address.normalized || value))
          : String(address.normalized || value).trim().toLocaleLowerCase();
      if (!value || !normalized) continue;
      const methodExists = db.prepare(`
        SELECT 1 FROM contact_methods
        WHERE person_id=? AND kind=? AND normalized_value=?
      `).get(resolvedPersonId, kind, normalized);
      if (methodExists) continue;
      db.prepare(`
        INSERT INTO contact_methods
          (id, person_id, kind, value, normalized_value, label, source_identity_id, is_primary)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).run(randomUUID(), resolvedPersonId, kind, value, normalized, identity.connector_id, sourceIdentityId);
    }
    const communications = db.prepare(`
      SELECT DISTINCT c.*,
        CASE WHEN c.sender_identity_id = ? THEN 'sender' ELSE 'participant' END AS role
      FROM communications c
      LEFT JOIN conversation_participants cp ON cp.conversation_id = c.conversation_id
      WHERE c.sender_identity_id = ? OR cp.source_identity_id = ?
    `).all(sourceIdentityId, sourceIdentityId, sourceIdentityId) as Record<string, any>[];
    for (const communication of communications) {
      db.prepare(`
        INSERT INTO communication_people (communication_id, person_id, role) VALUES (?, ?, ?)
        ON CONFLICT(communication_id, person_id) DO UPDATE SET role=excluded.role
      `).run(communication.id, resolvedPersonId, communication.role);
      upsertInteraction({
        personId: resolvedPersonId!,
        kind: communication.kind,
        occurredAt: communication.occurred_at,
        summary: communication.body,
        sourceConnector: communication.connector_id,
        sourceRecordId: communication.external_id,
        evidence: parse(communication.evidence_json, {})
      });
    }
    rollupLastContact([resolvedPersonId!]);
  });
  tx();
  return getPerson(resolvedPersonId);
}

export function unmergeIdentity(sourceIdentityId: string) {
  const identity = db.prepare("SELECT * FROM source_identities WHERE id = ?").get(sourceIdentityId) as Record<string, any> | undefined;
  if (!identity) throw new Error("Source identity not found");
  const raw = parse<Record<string, any>>(identity.raw_json, {});
  const newPersonId = createPerson(raw.name || identity.display_name || "Separated person", identity.connector_id);
  db.prepare("UPDATE source_identities SET person_id=?, linked_by='manual-unmerge', confidence=1, updated_at=? WHERE id=?").run(newPersonId, now(), sourceIdentityId);
  db.prepare("UPDATE source_records SET person_id=? WHERE source_identity_id=?").run(newPersonId, sourceIdentityId);
  return getPerson(newPersonId);
}

export function autofillSuggestions(personId: string) {
  const person = getPerson(personId) as any;
  if (!person) throw new Error("Person not found");
  const memoryText = person.memories.map((memory: any) => `${memory.raw_text} ${JSON.stringify(memory.structured)}`).join(" ").toLowerCase();
  const interactionCount = person.interactions.length;
  const suggestions: { field: string; value: unknown; confidence: number; reason: string; source: string }[] = [];
  const add = (field: string, value: unknown, confidence: number, reason: string, source = "Nett inference") => {
    if (value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length)) suggestions.push({ field, value, confidence, reason, source });
  };
  const keywordMap: Record<string, string[]> = {
    "Artificial Intelligence": ["ai", "model evaluation", "machine learning", "developer tools"],
    "Public Policy": ["policy", "government", "regulation", "geopolitics"],
    "Venture Capital": ["venture", "fundraising", "seed companies", "investor"],
    "Robotics": ["robotics", "embodied ai", "automation"],
    "Digital Health": ["health", "care delivery"],
    "Finance": ["finance", "capital flows", "market structure"]
  };
  if (!person.industry) {
    const inferred = Object.entries(keywordMap).find(([, words]) => words.some((word) => memoryText.includes(word)));
    if (inferred) add("industry", inferred[0], 0.76, `Matched relationship context: ${inferred[1].find((word) => memoryText.includes(word))}`, "Memory inference");
  }
  const inferredInterests = [...new Set(Object.values(keywordMap).flat().filter((word) => memoryText.includes(word)))];
  const combinedInterests = [...new Set([...(person.interests || []), ...inferredInterests])];
  if (combinedInterests.length > person.interests.length) add("interests", combinedInterests, 0.82, "Combined explicit memory topics with existing interests", "Memories");
  if (!person.relationship_strength && interactionCount) add("relationship_strength", Math.min(85, 38 + interactionCount * 5), 0.62, `Estimated from ${interactionCount} recorded interactions`);
  if (!person.warmth && person.last_contact) {
    const age = Math.max(0, (Date.now() - Date.parse(person.last_contact)) / 86400000);
    add("warmth", Math.max(20, Math.round(90 - age * 0.22)), 0.64, "Estimated from contact recency");
  }
  if (!person.follow_up_date) {
    const followMemory = person.memories.find((memory: any) => memory.structured?.followUpDate);
    if (followMemory) add("follow_up_date", followMemory.structured.followUpDate, 0.96, "Explicit follow-up extracted from a memory", sourceLabelForInference(followMemory.source));
  }
  if (!person.company) {
    const companyFact = person.provenance.find((fact: any) => fact.field_name === "company");
    if (companyFact) add("company", companyFact.field_value, companyFact.confidence || 0.9, "Available from an underlying source record", companyFact.connector_id);
  }
  if (!person.location) {
    const locationFact = person.provenance.find((fact: any) => fact.field_name === "location");
    if (locationFact) add("location", locationFact.field_value, locationFact.confidence || 0.9, "Available from an underlying source record", locationFact.connector_id);
  }
  if (!person.hometown?.length) {
    const hometownGuess = hometownSuggestionsFromInstitutions(person.institutions, person.hometown)[0];
    if (hometownGuess) {
      add("hometown", [hometownGuess.value], hometownGuess.confidence, hometownGuess.reason, "Education inference");
    }
  }
  if (!person.quick_memories && person.memories[0]) add("quick_memories", person.memories[0].raw_text, 1, "Most recent relationship memory", person.memories[0].source);
  return suggestions;
}

export function pendingInferenceSuggestions(limit = 80) {
  const rows = db.prepare(`
    SELECT s.id, s.person_id, s.field_name, s.proposed_value_json, s.current_value_json,
           s.rationale, s.confidence, s.created_at, p.preferred_name AS person_name
    FROM inference_suggestions s
    JOIN people p ON p.id = s.person_id
    WHERE s.status = 'pending'
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(limit, 200))) as Record<string, any>[];
  return rows.map((row) => ({
    id: String(row.id),
    personId: String(row.person_id),
    personName: String(row.person_name || ""),
    fieldName: String(row.field_name),
    proposedValue: parse(row.proposed_value_json, null),
    currentValue: parse(row.current_value_json, null),
    rationale: String(row.rationale || ""),
    confidence: typeof row.confidence === "number" ? row.confidence : Number(row.confidence) || null,
    createdAt: String(row.created_at || ""),
  }));
}

export function reviewCounts() {
  const merges = (db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT si.id
      FROM source_identities si
      LEFT JOIN merge_suggestions ms ON ms.source_identity_id = si.id AND ms.status = 'pending'
      WHERE ms.status = 'pending'
        OR (
          si.person_id IS NULL
          AND COALESCE(json_extract(si.raw_json, '$.isSelf'), 0) = 0
        )
      GROUP BY si.id
    )
  `).get() as { n: number }).n;
  const suggestions = (db.prepare(
    "SELECT COUNT(*) AS n FROM inference_suggestions WHERE status='pending'",
  ).get() as { n: number }).n;
  return { merges, suggestions, total: merges + suggestions };
}

export function mergeReviewQueuePage(limit = 40, offset = 0) {
  const start = Math.max(0, offset);
  const size = Math.max(1, Math.min(limit, 100));
  const total = reviewCounts().merges;
  const identityIds = (db.prepare(`
    SELECT si.id AS id
    FROM source_identities si
    LEFT JOIN merge_suggestions ms ON ms.source_identity_id = si.id AND ms.status = 'pending'
    WHERE ms.status = 'pending'
      OR (
        si.person_id IS NULL
        AND COALESCE(json_extract(si.raw_json, '$.isSelf'), 0) = 0
      )
    GROUP BY si.id
    ORDER BY MAX(si.created_at) DESC
    LIMIT ? OFFSET ?
  `).all(size, start) as { id: string }[]).map((row) => row.id);
  if (!identityIds.length) {
    return { items: [] as ReturnType<typeof mergeReviewQueue>, total, limit: size, offset: start };
  }
  const placeholders = identityIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT ms.id AS suggestion_id, si.id AS source_identity_id, ms.candidate_person_id,
      ms.reason, ms.confidence, ms.status, si.display_name, si.connector_id,
      si.raw_json, p.preferred_name AS candidate_name, m.company AS candidate_company
    FROM source_identities si
    LEFT JOIN merge_suggestions ms ON ms.source_identity_id = si.id AND ms.status = 'pending'
    LEFT JOIN people p ON p.id = ms.candidate_person_id
    LEFT JOIN nett_metadata m ON m.person_id = p.id
    WHERE si.id IN (${placeholders})
    ORDER BY si.created_at DESC, ms.confidence DESC
  `).all(...identityIds) as Record<string, any>[];
  const groups = new Map<string, any>();
  for (const id of identityIds) {
    groups.set(id, null);
  }
  rows.forEach((row) => {
    if (!groups.get(row.source_identity_id)) {
      groups.set(row.source_identity_id, {
        sourceIdentityId: row.source_identity_id,
        displayName: row.display_name,
        connectorId: row.connector_id,
        raw: parse(row.raw_json, {}),
        candidates: [],
      });
    }
    if (row.suggestion_id) {
      groups.get(row.source_identity_id).candidates.push({
        suggestionId: row.suggestion_id,
        personId: row.candidate_person_id,
        name: row.candidate_name,
        company: row.candidate_company,
        confidence: row.confidence,
        reason: row.reason,
      });
    }
  });
  return {
    items: identityIds.map((id) => groups.get(id)).filter(Boolean),
    total,
    limit: size,
    offset: start,
  };
}

function sourceLabelForInference(source: string) { return source === "manual" ? "Nett" : source; }

export function setConnectorState(id: string, state: { permission?: string; status?: string; error?: string | null; seen?: number; linked?: number }) {
  const existing = db.prepare(`
    SELECT permission_state, status, records_seen, records_linked
    FROM connector_states WHERE connector_id=?
  `).get(id) as {
    permission_state: string;
    status: string;
    records_seen: number;
    records_linked: number;
  } | undefined;
  db.prepare(`INSERT INTO connector_states (connector_id, permission_state, status, last_sync_at, last_error, records_seen, records_linked)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(connector_id) DO UPDATE SET permission_state=excluded.permission_state, status=excluded.status, last_sync_at=excluded.last_sync_at, last_error=excluded.last_error, records_seen=excluded.records_seen, records_linked=excluded.records_linked`)
    .run(
      id,
      state.permission ?? existing?.permission_state ?? "unknown",
      state.status ?? existing?.status ?? "idle",
      state.status === "success" ? now() : null,
      state.error ?? null,
      state.seen ?? existing?.records_seen ?? 0,
      state.linked ?? existing?.records_linked ?? 0
    );
}

export function connectorSettings(id: string): Record<string, unknown> {
  const row = db.prepare("SELECT settings_json FROM connector_states WHERE connector_id=?").get(id) as { settings_json: string } | undefined;
  return parse(row?.settings_json ?? null, {});
}

export function updateConnectorSettings(id: string, settings: Record<string, unknown>) {
  db.prepare("INSERT INTO connector_states (connector_id, settings_json) VALUES (?, ?) ON CONFLICT(connector_id) DO UPDATE SET settings_json=excluded.settings_json")
    .run(id, JSON.stringify(settings));
}

export function upsertInteraction(input: {
  personId: string;
  kind: string;
  occurredAt: string;
  summary?: string | null;
  sourceConnector: string;
  sourceRecordId: string;
  evidence?: Record<string, unknown>;
}) {
  db.prepare(`
    INSERT INTO interactions (id, person_id, kind, occurred_at, summary, source_connector, source_record_id, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_connector, source_record_id, person_id) WHERE source_record_id IS NOT NULL
    DO UPDATE SET kind=excluded.kind, occurred_at=excluded.occurred_at, summary=excluded.summary, evidence_json=excluded.evidence_json
  `).run(randomUUID(), input.personId, input.kind, input.occurredAt, input.summary ?? null, input.sourceConnector, input.sourceRecordId, JSON.stringify(input.evidence ?? {}));
}

export function rollupLastContact(personIds?: Iterable<string>) {
  const ids = personIds ? [...new Set(personIds)] : (db.prepare("SELECT id FROM people").all() as { id: string }[]).map((row) => row.id);
  const update = db.prepare(`
    UPDATE nett_metadata SET
      last_contact=(SELECT MAX(occurred_at) FROM interactions WHERE person_id=?),
      updated_at=?
    WHERE person_id=?
  `);
  const timestamp = now();
  for (const personId of ids) update.run(personId, timestamp, personId);
}

export function getPersonCommunications(personId: string, options: { limit?: number; cursor?: string } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const separator = options.cursor?.lastIndexOf("|") ?? -1;
  const cursorTime = separator > 0 ? options.cursor!.slice(0, separator) : null;
  const cursorId = separator > 0 ? options.cursor!.slice(separator + 1) : null;
  const rows = db.prepare(`
    SELECT c.*, cp.role, cv.external_id AS thread_external_id, cv.title AS thread_title, cv.is_group
    FROM communication_people cp
    JOIN communications c ON c.id = cp.communication_id
    LEFT JOIN conversations cv ON cv.id = c.conversation_id
    WHERE cp.person_id = ? AND (
      ? IS NULL OR c.occurred_at < ? OR (c.occurred_at = ? AND c.id < ?)
    )
    ORDER BY c.occurred_at DESC, c.id DESC
    LIMIT ?
  `).all(personId, cursorTime, cursorTime, cursorTime, cursorId, limit + 1) as Record<string, any>[];
  const hasMore = rows.length > limit;
  const items: Record<string, any>[] = rows.slice(0, limit).map((row) => ({ ...row, evidence: parse(row.evidence_json, {}) }));
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? `${last.occurred_at}|${last.id}` : null };
}

export function overview() {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN COALESCE(m.relationship_strength, 0) >= 75 THEN 1 ELSE 0 END) AS strong_ties,
      SUM(CASE WHEN m.last_contact IS NOT NULL
        AND julianday('now') - julianday(m.last_contact) > 90 THEN 1 ELSE 0 END) AS cold,
      SUM(CASE WHEN m.follow_up_date IS NOT NULL
        AND date(m.follow_up_date) <= date('now') THEN 1 ELSE 0 END) AS due
    FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
  `).get() as { total: number; strong_ties: number | null; cold: number | null; due: number | null };
  const grouped = (field: "location" | "industry") => db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(m.${field}), ''), 'Unknown') AS label, COUNT(*) AS count
    FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
    GROUP BY label
    ORDER BY count DESC, label ASC
    LIMIT 20
  `).all().map((row: any) => [row.label, row.count] as [string, number]);
  const ids = (sql: string) => (db.prepare(sql).all() as { id: string }[]).map((row) => row.id);
  const topIds = ids(`
    SELECT p.id FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
    ORDER BY COALESCE(m.priority, 0) DESC, COALESCE(m.relationship_strength, 0) DESC,
      p.preferred_name ASC LIMIT 140
  `);
  const dueIds = ids(`
    SELECT p.id FROM people p JOIN nett_metadata m ON m.person_id=p.id
    WHERE m.follow_up_date IS NOT NULL AND date(m.follow_up_date) <= date('now')
    ORDER BY date(m.follow_up_date) ASC, COALESCE(m.priority, 0) DESC LIMIT 50
  `);
  const coldIds = ids(`
    SELECT p.id FROM people p JOIN nett_metadata m ON m.person_id=p.id
    WHERE m.last_contact IS NOT NULL AND julianday('now') - julianday(m.last_contact) > 90
    ORDER BY datetime(m.last_contact) ASC, COALESCE(m.relationship_strength, 0) DESC LIMIT 50
  `);
  const birthdayIds = ids(`
    SELECT p.id FROM people p JOIN nett_metadata m ON m.person_id=p.id
    WHERE NULLIF(m.birthday, '') IS NOT NULL
    ORDER BY
      CASE WHEN strftime('%m-%d', m.birthday) >= strftime('%m-%d', 'now') THEN 0 ELSE 1 END,
      strftime('%m-%d', m.birthday) ASC LIMIT 40
  `);
  const recentIds = ids(`
    SELECT p.id FROM people p JOIN nett_metadata m ON m.person_id=p.id
    WHERE m.last_contact IS NOT NULL ORDER BY datetime(m.last_contact) DESC LIMIT 40
  `);
  const gapIds = ids(`
    SELECT p.id FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
    WHERE NULLIF(TRIM(m.location), '') IS NULL
      OR NULLIF(TRIM(m.company), '') IS NULL
      OR NULLIF(TRIM(m.industry), '') IS NULL
    ORDER BY COALESCE(m.priority, 0) DESC, p.preferred_name ASC LIMIT 40
  `);
  const orderedIds = [...new Set([...topIds, ...dueIds, ...coldIds, ...birthdayIds, ...recentIds, ...gapIds])];
  const people = summarizePeople(orderedIds);
  const byId = new Map(people.map((person) => [person.id, person]));
  return {
    total: stats.total,
    strongTies: stats.strong_ties ?? 0,
    cold: stats.cold ?? 0,
    due: stats.due ?? 0,
    locations: grouped("location"),
    industries: grouped("industry"),
    people,
    coldPeople: coldIds.flatMap((id) => byId.get(id) ? [byId.get(id)] : []),
    duePeople: dueIds.flatMap((id) => byId.get(id) ? [byId.get(id)] : []),
    connectors: connectorStates()
  };
}

/** Slim projection for the fuzzy search index. Selecting only searchable and
 *  displayable columns keeps the in-memory index small and the response small;
 *  hydrating full people for this cost 1.78 MB per rebuild. */
export function searchIndexRows(): Record<string, any>[] {
  const rows = db.prepare(`
    SELECT p.id AS id, p.preferred_name AS name, p.nickname,
      m.company, m.job_title, m.headline, m.industry, m.location, m.hometown,
      m.relationship, m.last_contact, m.follow_up_date, m.institutions, m.mutuals,
      m.interests, m.quick_memories, m.notes
    FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
  `).all() as Record<string, any>[];
  const tagRows = db.prepare(`
    SELECT ct.person_id, group_concat(t.name, ' ') AS tags
    FROM contact_tags ct JOIN tags t ON t.id=ct.tag_id GROUP BY ct.person_id
  `).all() as { person_id: string; tags: string }[];
  const tags = new Map(tagRows.map((row) => [row.person_id, row.tags]));
  return rows.map((row) => ({ ...row, tags: tags.get(row.id) ?? "" }));
}

/** Summary rows for overview surfaces. Deliberately excludes tags, contact
 *  methods, and source records: the dashboard renders none of them, and
 *  hydrating them cost 1.4 MB on every application load. */
export function summarizePeople(ids: string[]): Record<string, any>[] {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return [];
  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT p.id AS id, p.preferred_name, p.nickname,
      m.company, m.job_title, m.headline, m.location, m.industry, m.relationship,
      m.last_contact, m.follow_up_date, m.relationship_strength, m.priority, m.birthday,
      m.notes, m.quick_memories,
      (SELECT COUNT(*) FROM memories mm WHERE mm.person_id=p.id) AS memory_count
    FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
    WHERE p.id IN (${placeholders})
  `).all(...uniqueIds) as Record<string, any>[];
  const byId = new Map(rows.map((row) => [row.id, { ...row, name: row.preferred_name }]));
  return uniqueIds.flatMap((id) => {
    const person = byId.get(id);
    return person ? [person] : [];
  });
}
