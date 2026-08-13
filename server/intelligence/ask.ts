import { db } from "../db.js";
import type { EvidenceDocument } from "./evidence-index.js";

export type AskCitation = {
  personId: string;
  label: string;
  field: string;
  value: string;
  source: string;
  evidenceId?: string;
};

export type AskMatch = {
  field: string;
  source: string;
  excerpt: string;
  evidenceId?: string;
  occurredAt?: string | null;
};

export type AskPerson = {
  personId: string;
  name: string;
  location: string | null;
  hometown: string | null;
  company: string | null;
  jobTitle: string | null;
  industry: string | null;
  foods: string | null;
  interests: string | null;
  skills: string | null;
  notes: string | null;
  lastContact: string | null;
  score: number;
  groups: Set<string>;
  matches: AskMatch[];
};

export type AskIntent = {
  question: string;
  places: string[];
  topics: string[];
  expansions: string[];
  sources: string[];
  recencyDays: number | null;
  foodIntent: boolean;
};

export type AskRetrieval = {
  intent: AskIntent;
  people: AskPerson[];
  provider: "local-people-index" | "local-evidence";
};

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "on", "at", "to", "for", "of", "with",
  "as", "by", "from", "in", "into", "about", "over", "than", "then", "also",
  "who", "whom", "whose", "what", "which", "where", "when", "why", "how",
  "do", "does", "did", "doing", "done",
  "i", "me", "my", "mine", "we", "our", "you", "your", "they", "them", "their",
  "know", "knows", "knew", "anyone", "anybody", "someone", "somebody",
  "people", "person", "persons", "contacts", "network", "ones",
  "like", "likes", "liked", "liking", "love", "loves", "loved",
  "might", "may", "maybe", "perhaps", "would", "could", "should", "can",
  "be", "is", "am", "are", "was", "were", "been", "being",
  "interested", "interest",
  "tell", "show", "find", "list", "give", "get", "ask", "looking",
  "that", "this", "these", "those", "there", "here",
  "have", "has", "had", "having", "please", "something", "anything",
  "who", "working", "work", "works", "based",
]);

const GENERIC_FOOD_WORDS = new Set([
  "food", "foods", "eat", "eats", "eating", "cuisine", "dish", "dishes",
  "restaurant", "restaurants", "hungry", "meal", "meals",
]);

const FOOD_ALIASES: Record<string, string[]> = {
  spicy: [
    "spice", "chili", "chilli", "chiles", "sichuan", "szechuan", "szechwan",
    "hot pot", "hotpot", "gochujang", "kimchi", "sriracha", "jalapeno", "jalapeño",
    "wasabi", "harissa", "cayenne", "peppercorn",
  ],
  spice: ["spicy", "chili", "chilli", "sichuan", "szechuan"],
};

const TOPIC_ALIASES: Record<string, string[]> = {
  "legal tech": [
    "legaltech", "legal technology", "lawtech", "law tech", "lawyer", "lawyers",
    "attorney", "attorneys", "counsel", "litigation", "law firm", "law",
  ],
  legal: ["legaltech", "lawyer", "lawyers", "attorney", "counsel", "litigation", "law"],
  tech: ["technology", "software", "startup"],
  ai: ["artificial intelligence", "machine learning", "llm"],
  climate: ["sustainability", "carbon", "climate change", "energy"],
};

const PLACE_STOP = /^(who|that|which|with|and|or|to|for|about|like|likes|interested|working|based|who)\b/i;

const PERSON_LIMIT = 12;
const CANDIDATE_LIMIT = 48;
const EVIDENCE_PER_PERSON = 3;

function sanitizeNeedle(value: string): string {
  return value.replace(/[%_]/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function listText(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "[]" || trimmed === "null") return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String).join(", ");
  } catch {
    // Stored as a plain string.
  }
  return trimmed;
}

function looksLikePlace(span: string): boolean {
  const needle = `%${sanitizeNeedle(span)}%`;
  if (needle.length < 4) return false;
  const row = db.prepare(`
    SELECT 1 AS ok FROM nett_metadata
    WHERE lower(COALESCE(location, '')) LIKE ?
       OR lower(COALESCE(hometown, '')) LIKE ?
    LIMIT 1
  `).get(needle, needle) as { ok: number } | undefined;
  return Boolean(row);
}

function tokenize(text: string): string[] {
  return [...new Set((text.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []))]
    .filter((token) => !STOPWORDS.has(token));
}

function expandTerm(term: string): string[] {
  const key = term.toLocaleLowerCase();
  const extra = [
    ...(FOOD_ALIASES[key] ?? []),
    ...(TOPIC_ALIASES[key] ?? []),
  ];
  return [...new Set([term, ...extra])];
}

function recencyDaysFrom(question: string): number | null {
  if (/\b(today|yesterday)\b/i.test(question)) return 2;
  if (/\blast\s+week\b|\bthis\s+week\b/i.test(question)) return 7;
  if (/\blast\s+month\b|\bthis\s+month\b/i.test(question)) return 31;
  if (/\b(recent|recently|lately|most recently)\b/i.test(question)) return 90;
  return null;
}

function sourcesFrom(question: string): string[] {
  const sources: string[] = [];
  if (/\b(gmail|e-?mails?|mail)\b/i.test(question)) sources.push("gmail");
  if (/\b(imessage|i-message|texted|texts|sms)\b/i.test(question)) sources.push("messages");
  if (/\bmessages?\b/i.test(question) && !sources.includes("messages")) sources.push("messages");
  if (/\bwhatsapp\b/i.test(question)) sources.push("whatsapp");
  return [...new Set(sources)];
}

export function parseAskIntent(question: string): AskIntent {
  const places: string[] = [];
  const consumed = new Set<string>();
  const placePattern = /\b(?:in|from|around|near)\s+/gi;
  let match: RegExpExecArray | null;
  while ((match = placePattern.exec(question))) {
    const after = question.slice(match.index + match[0].length);
    const tokens: string[] = [];
    for (const raw of after.split(/\s+/)) {
      const clean = raw.replace(/[?.!,;:"“”]+$/g, "");
      if (!clean || PLACE_STOP.test(clean) || STOPWORDS.has(clean.toLocaleLowerCase())) break;
      tokens.push(clean);
      if (tokens.length >= 4) break;
    }
    const span = tokens.join(" ").trim();
    if (span.length < 2) continue;
    if (looksLikePlace(span)) {
      places.push(span);
      consumed.add(span.toLocaleLowerCase());
    }
  }

  const foodIntent = /\b(foods?|eat|eats|eating|cuisine|dish(?:es)?|restaurants?|hungry|spicy|spice)\b/i
    .test(question);
  const recencyDays = recencyDaysFrom(question);
  const sources = sourcesFrom(question);

  let topicSource = question;
  for (const place of places) {
    topicSource = topicSource.replace(new RegExp(`\\b${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig"), " ");
  }
  const topics = tokenize(topicSource)
    .filter((token) => !consumed.has(token))
    .filter((token) => !(foodIntent && GENERIC_FOOD_WORDS.has(token)))
    .filter((token) => !["email", "emails", "gmail", "mail", "message", "messages", "recent", "recently", "lately", "most", "contacted", "contact", "contacts"].includes(token))
    .slice(0, 8);

  const phrase = topics.join(" ");
  const expansions = [
    ...topics.flatMap(expandTerm),
    ...(TOPIC_ALIASES[phrase] ?? []),
  ].filter((term) => !topics.includes(term.toLocaleLowerCase()) && !STOPWORDS.has(term.toLocaleLowerCase()));

  return {
    question: question.trim(),
    places: [...new Set(places)],
    topics,
    expansions: [...new Set(expansions)].slice(0, 16),
    sources,
    recencyDays,
    foodIntent,
  };
}

function ftsTerm(term: string): string {
  const cleaned = term.trim().replaceAll('"', "").slice(0, 48);
  if (!cleaned) return "";
  if (cleaned.includes(" ")) return `"${cleaned.replaceAll('"', '""')}"`;
  if (cleaned.length < 2) return "";
  return `"${cleaned.replaceAll('"', '""')}"*`;
}

export function ftsMatchFromTerms(terms: readonly string[]): string {
  const parts = [...new Set(terms.map(ftsTerm).filter(Boolean))];
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return `(${parts.join(" OR ")})`;
}

function topicFtsMatch(intent: AskIntent): string {
  const phrase = intent.topics.join(" ");
  const andGroup = intent.topics.length >= 2
    ? `(${intent.topics.map(ftsTerm).filter(Boolean).join(" AND ")})`
    : "";
  const parts = [
    andGroup,
    phrase.includes(" ") ? ftsTerm(phrase) : "",
    ftsMatchFromTerms(distinctiveTopicTerms([...intent.topics, ...intent.expansions])),
  ].filter(Boolean);
  return parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0] || "";
}

/** Stopword-aware FTS string for a free-text question. */
export function ftsQuery(question: string): string {
  const intent = parseAskIntent(question);
  const groups = [
    ftsMatchFromTerms(intent.places),
    topicFtsMatch(intent),
  ].filter(Boolean);
  if (groups.length === 2) return `${groups[0]} AND ${groups[1]}`;
  return groups[0] || ftsMatchFromTerms(tokenize(question));
}

type ProfileRow = {
  id: string;
  name: string;
  location: string | null;
  hometown: string | null;
  company: string | null;
  job_title: string | null;
  industry: string | null;
  foods: string | null;
  interests: string | null;
  skills: string | null;
  notes: string | null;
  quick_memories: string | null;
  headline: string | null;
  last_contact: string | null;
};

function emptyPerson(row: ProfileRow): AskPerson {
  return {
    personId: row.id,
    name: row.name,
    location: row.location,
    hometown: row.hometown,
    company: row.company,
    jobTitle: row.job_title,
    industry: row.industry,
    foods: listText(row.foods) || null,
    interests: listText(row.interests) || null,
    skills: listText(row.skills) || null,
    notes: row.notes,
    lastContact: row.last_contact,
    score: 0,
    groups: new Set(),
    matches: [],
  };
}

function profilesByIds(ids: readonly string[]): Map<string, ProfileRow> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, 80);
  if (!unique.length) return new Map();
  const rows = db.prepare(`
    SELECT p.id, p.preferred_name AS name, m.location, m.hometown, m.company, m.job_title,
      m.industry, m.foods, m.interests, m.skills, m.notes, m.quick_memories, m.headline,
      m.last_contact
    FROM people p
    LEFT JOIN nett_metadata m ON m.person_id = p.id
    WHERE p.id IN (${unique.map(() => "?").join(",")})
  `).all(...unique) as ProfileRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

function addMatch(person: AskPerson, group: string, match: AskMatch, points: number): void {
  person.groups.add(group);
  person.score += points;
  const key = `${match.field}:${match.excerpt.slice(0, 80)}`;
  if (person.matches.some((item) => `${item.field}:${item.excerpt.slice(0, 80)}` === key)) return;
  person.matches.push(match);
}

function excerptAround(haystack: string, term: string, limit = 180): string {
  const lower = haystack.toLocaleLowerCase();
  const index = lower.indexOf(term.toLocaleLowerCase());
  if (index < 0) return haystack.replace(/\s+/g, " ").trim().slice(0, limit);
  const start = Math.max(0, index - 40);
  const slice = haystack.slice(start, start + limit).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}`;
}

function structuredPlacePeople(places: readonly string[]): Map<string, AskPerson> {
  const found = new Map<string, AskPerson>();
  for (const place of places) {
    const needle = `%${sanitizeNeedle(place)}%`;
    const rows = db.prepare(`
      SELECT p.id, p.preferred_name AS name, m.location, m.hometown, m.company, m.job_title,
        m.industry, m.foods, m.interests, m.skills, m.notes, m.quick_memories, m.headline,
        m.last_contact
      FROM people p
      JOIN nett_metadata m ON m.person_id = p.id
      WHERE lower(COALESCE(m.location, '')) LIKE ?
         OR lower(COALESCE(m.hometown, '')) LIKE ?
      ORDER BY p.preferred_name COLLATE NOCASE
      LIMIT ?
    `).all(needle, needle, CANDIDATE_LIMIT) as ProfileRow[];
    for (const row of rows) {
      const person = found.get(row.id) ?? emptyPerson(row);
      const locationHit = String(row.location ?? "").toLocaleLowerCase().includes(sanitizeNeedle(place));
      addMatch(person, "place", {
        field: locationHit ? "location" : "hometown",
        source: "nett",
        excerpt: locationHit ? String(row.location) : listText(row.hometown) || place,
      }, locationHit ? 4 : 3);
      found.set(row.id, person);
    }
  }
  return found;
}

function distinctiveTopicTerms(terms: readonly string[]): string[] {
  const weak = new Set(["tech", "technology", "software", "startup", "work", "job"]);
  const strong = terms.filter((term) => term.length >= 4 && !weak.has(term.toLocaleLowerCase()));
  return strong.length ? strong : terms.filter((term) => term.length >= 3);
}

const TOPIC_SQL_COLUMNS = [
  "foods", "interests", "skills", "industry", "company", "headline", "job_title",
  "notes", "quick_memories",
] as const;

function structuredTopicPeople(terms: readonly string[]): Map<string, AskPerson> {
  const found = new Map<string, AskPerson>();
  if (!terms.length) return found;
  const where = TOPIC_SQL_COLUMNS.map((column) => `lower(COALESCE(m.${column}, '')) LIKE ?`).join(" OR ");
  const select = `
    SELECT p.id, p.preferred_name AS name, m.location, m.hometown, m.company, m.job_title,
      m.industry, m.foods, m.interests, m.skills, m.notes, m.quick_memories, m.headline,
      m.last_contact
    FROM people p
    JOIN nett_metadata m ON m.person_id = p.id
    WHERE ${where}
    LIMIT ?
  `;
  const query = db.prepare(select);
  for (const term of terms) {
    const needle = `%${sanitizeNeedle(term)}%`;
    if (needle.length < 4) continue;
    const rows = query.all(...TOPIC_SQL_COLUMNS.map(() => needle), CANDIDATE_LIMIT) as ProfileRow[];
    for (const row of rows) {
      const person = found.get(row.id) ?? emptyPerson(row);
      const field = TOPIC_SQL_COLUMNS.find((column) =>
        String(row[column as keyof ProfileRow] ?? "").toLocaleLowerCase().includes(sanitizeNeedle(term))
      ) ?? "notes";
      const raw = String(row[field as keyof ProfileRow] ?? "");
      addMatch(person, "topic", {
        field,
        source: "nett",
        excerpt: excerptAround(listText(raw) || raw, term),
      }, field === "foods" || field === "interests" || field === "industry" ? 5 : 3);
      found.set(row.id, person);
    }
  }
  for (const term of terms) {
    const needle = `%${sanitizeNeedle(term)}%`;
    if (needle.length < 4) continue;
    const tagRows = db.prepare(`
      SELECT ct.person_id AS id, t.name AS tag
      FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
      WHERE lower(t.name) LIKE ?
      LIMIT ?
    `).all(needle, CANDIDATE_LIMIT) as { id: string; tag: string }[];
    if (!tagRows.length) continue;
    const profiles = profilesByIds(tagRows.map((row) => row.id));
    for (const row of tagRows) {
      const profile = profiles.get(row.id);
      if (!profile) continue;
      const person = found.get(row.id) ?? emptyPerson(profile);
      addMatch(person, "topic", { field: "tags", source: "nett", excerpt: row.tag }, 4);
      found.set(row.id, person);
    }
  }
  return found;
}

function recentPeople(days: number): Map<string, AskPerson> {
  const found = new Map<string, AskPerson>();
  const rows = db.prepare(`
    SELECT p.id, p.preferred_name AS name, m.location, m.hometown, m.company, m.job_title,
      m.industry, m.foods, m.interests, m.skills, m.notes, m.quick_memories, m.headline,
      m.last_contact
    FROM people p
    JOIN nett_metadata m ON m.person_id = p.id
    WHERE m.last_contact IS NOT NULL
      AND julianday('now') - julianday(m.last_contact) <= ?
    ORDER BY m.last_contact DESC
    LIMIT ?
  `).all(days, CANDIDATE_LIMIT) as ProfileRow[];
  for (const row of rows) {
    const person = emptyPerson(row);
    addMatch(person, "recent", {
      field: "last_contact",
      source: "nett",
      excerpt: `Last recorded contact ${row.last_contact}`,
      occurredAt: row.last_contact,
    }, 2);
    found.set(row.id, person);
  }
  return found;
}

type FtsHit = EvidenceDocument & { rank: number };

function searchFts(match: string, options: {
  sources?: readonly string[];
  personIds?: readonly string[];
  after?: string | null;
  limit: number;
}): FtsHit[] {
  if (!match) return [];
  const clauses = ["evidence_fts MATCH ?"];
  const values: unknown[] = [match];
  if (options.sources?.length) {
    clauses.push(`d.source IN (${options.sources.map(() => "?").join(",")})`);
    values.push(...options.sources);
  }
  if (options.personIds?.length) {
    const ids = options.personIds.slice(0, 80);
    clauses.push(`d.person_id IN (${ids.map(() => "?").join(",")})`);
    values.push(...ids);
  }
  if (options.after) {
    clauses.push("d.occurred_at >= ?");
    values.push(options.after);
  }
  try {
    return db.prepare(`
      SELECT d.id, d.person_id, d.kind, d.source, d.source_record_id, d.text,
        d.occurred_at, d.metadata_json, d.embedding_json, bm25(evidence_fts) AS rank
      FROM evidence_fts
      JOIN evidence_documents d ON d.id = evidence_fts.document_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY rank
      LIMIT ?
    `).all(...values, options.limit) as FtsHit[];
  } catch {
    return [];
  }
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

function applyEvidenceHits(
  people: Map<string, AskPerson>,
  hits: FtsHit[],
  group: "place" | "topic" | "recent",
  profiles: Map<string, ProfileRow>,
): void {
  for (const hit of hits) {
    if (!hit.person_id) continue;
    const profile = profiles.get(hit.person_id);
    if (!profile) continue;
    const person = people.get(hit.person_id) ?? emptyPerson(profile);
    const field = hit.kind === "profile-field" ? "profile" : hit.kind === "memory" ? "memory" : "conversation";
    const points = hit.kind === "profile-field" ? 4 : hit.kind === "memory" ? 3 : 2;
    addMatch(person, group, {
      field,
      source: hit.source,
      excerpt: hit.text.replace(/\s+/g, " ").trim().slice(0, 240),
      evidenceId: hit.id,
      occurredAt: hit.occurred_at,
    }, points);
    people.set(hit.person_id, person);
  }
}

function mergePeople(...groups: Array<Map<string, AskPerson>>): Map<string, AskPerson> {
  const merged = new Map<string, AskPerson>();
  for (const group of groups) {
    for (const [id, person] of group) {
      const existing = merged.get(id);
      if (!existing) {
        merged.set(id, person);
        continue;
      }
      existing.score += person.score;
      for (const name of person.groups) existing.groups.add(name);
      for (const match of person.matches) addMatch(existing, [...person.groups][0] ?? "topic", match, 0);
    }
  }
  return merged;
}

function requiredGroups(intent: AskIntent): string[] {
  const groups: string[] = [];
  if (intent.places.length) groups.push("place");
  if (intent.topics.length || intent.foodIntent) groups.push("topic");
  if (intent.recencyDays && !intent.places.length && !intent.topics.length) groups.push("recent");
  return groups;
}

function selectPeople(people: Map<string, AskPerson>, intent: AskIntent): AskPerson[] {
  const required = requiredGroups(intent);
  const ranked = [...people.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const complete = required.length
    ? ranked.filter((person) => required.every((group) => person.groups.has(group)))
    : ranked;
  const chosen = (complete.length ? complete : ranked).slice(0, PERSON_LIMIT);
  for (const person of chosen) {
    person.matches = person.matches
      .sort((a, b) => Number(Boolean(b.evidenceId)) - Number(Boolean(a.evidenceId)))
      .slice(0, EVIDENCE_PER_PERSON + 2);
  }
  return chosen;
}

function attachEvidenceForPeople(people: AskPerson[], intent: AskIntent): void {
  if (!people.length) return;
  const ids = people.map((person) => person.personId);
  const topicMatch = ftsMatchFromTerms([...intent.topics, ...intent.expansions]);
  const placeMatch = ftsMatchFromTerms(intent.places);
  const match = [placeMatch, topicMatch].filter(Boolean).join(" OR ") || topicMatch || placeMatch;
  if (!match) return;
  const hits = searchFts(match, {
    personIds: ids,
    sources: intent.sources,
    after: intent.recencyDays ? isoDaysAgo(intent.recencyDays) : null,
    limit: PERSON_LIMIT * 8,
  });
  const byPerson = new Map<string, AskPerson>(people.map((person) => [person.personId, person]));
  const profiles = new Map(people.map((person) => [person.personId, {
    id: person.personId,
    name: person.name,
    location: person.location,
    hometown: person.hometown,
    company: person.company,
    job_title: person.jobTitle,
    industry: person.industry,
    foods: person.foods,
    interests: person.interests,
    skills: person.skills,
    notes: person.notes,
    quick_memories: null,
    headline: null,
    last_contact: person.lastContact,
  } satisfies ProfileRow]));
  applyEvidenceHits(byPerson, hits, intent.topics.length ? "topic" : "place", profiles);
}

export function retrieveAskMatches(question: string): AskRetrieval {
  const intent = parseAskIntent(question);
  const structuredTerms = distinctiveTopicTerms([...intent.topics, ...intent.expansions]);
  const topicMatch = topicFtsMatch(intent);
  const placePeople = intent.places.length ? structuredPlacePeople(intent.places) : new Map<string, AskPerson>();
  const topicPeople = structuredTerms.length ? structuredTopicPeople(structuredTerms) : new Map<string, AskPerson>();
  const recent = intent.recencyDays && !intent.places.length && !intent.topics.length
    ? recentPeople(intent.recencyDays)
    : new Map<string, AskPerson>();

  const after = intent.recencyDays ? isoDaysAgo(intent.recencyDays) : null;
  const placeFts = intent.places.length
    ? searchFts(ftsMatchFromTerms(intent.places), { sources: intent.sources, after, limit: 60 })
    : [];
  const topicFts = topicMatch
    ? searchFts(topicMatch, { sources: intent.sources, after, limit: 80 })
    : [];
  const combinedFts = intent.places.length && topicMatch
    ? searchFts(`${ftsMatchFromTerms(intent.places)} AND ${topicMatch}`, {
      sources: intent.sources,
      after,
      limit: 40,
    })
    : [];

  const evidenceIds = [...placeFts, ...topicFts, ...combinedFts].map((hit) => hit.person_id).filter(Boolean) as string[];
  const structuredIds = [...placePeople.keys(), ...topicPeople.keys(), ...recent.keys()];
  const profiles = profilesByIds([...structuredIds, ...evidenceIds]);

  const fromPlaceEvidence = new Map<string, AskPerson>();
  applyEvidenceHits(fromPlaceEvidence, placeFts, "place", profiles);
  const fromTopicEvidence = new Map<string, AskPerson>();
  applyEvidenceHits(fromTopicEvidence, topicFts, "topic", profiles);
  applyEvidenceHits(fromTopicEvidence, combinedFts, "topic", profiles);
  applyEvidenceHits(fromPlaceEvidence, combinedFts, "place", profiles);

  const merged = mergePeople(placePeople, topicPeople, recent, fromPlaceEvidence, fromTopicEvidence);
  const people = selectPeople(merged, intent);
  attachEvidenceForPeople(people, intent);

  const simplePlace = intent.places.length > 0
    && !intent.topics.length
    && !intent.foodIntent
    && !intent.recencyDays
    && !intent.sources.length;

  return {
    intent,
    people,
    provider: simplePlace ? "local-people-index" : "local-evidence",
  };
}

function dossierLine(person: AskPerson): string {
  const facts = [
    person.location ? `location ${person.location}` : "",
    person.hometown ? `hometown ${listText(person.hometown)}` : "",
    person.jobTitle || person.company
      ? [person.jobTitle, person.company].filter(Boolean).join(" at ")
      : "",
    person.industry ? `industry ${person.industry}` : "",
    person.foods ? `foods ${person.foods}` : "",
    person.interests ? `interests ${person.interests}` : "",
  ].filter(Boolean);
  const evidence = person.matches
    .filter((match) => match.excerpt)
    .slice(0, 3)
    .map((match) => `  ${match.source} / ${match.field.replaceAll("_", " ")}: ${match.excerpt}`);
  return [`• ${person.name}${facts.length ? ` — ${facts.join(" · ")}` : ""}`, ...evidence].join("\n");
}

export function formatAskAnswer(retrieval: AskRetrieval): string {
  const { intent, people } = retrieval;
  if (!people.length) {
    return "Nothing stored in people, notes, messages, or email matched that question.";
  }
  const required = requiredGroups(intent);
  const complete = required.length
    ? people.filter((person) => required.every((group) => person.groups.has(group)))
    : people;
  const constraints = [
    intent.places.length ? intent.places.join(", ") : "",
    intent.topics.length ? intent.topics.join(" ") : "",
  ].filter(Boolean).join(" and ");

  if (complete.length) {
    const heading = constraints
      ? `People who match ${constraints} from stored records (${complete.length}):`
      : intent.recencyDays
        ? `People with a recorded contact in the last ${intent.recencyDays} days:`
        : "Closest stored matches:";
    return `${heading}\n\n${complete.map(dossierLine).join("\n\n")}`;
  }

  const parts = [`No one matched every part of ${constraints || "that question"}. Partial matches:`];
  const byPlace = people.filter((person) => person.groups.has("place"));
  const byTopic = people.filter((person) => person.groups.has("topic"));
  if (byPlace.length) {
    parts.push(`Place (${intent.places.join(", ")}):\n${byPlace.slice(0, 6).map(dossierLine).join("\n\n")}`);
  }
  if (byTopic.length) {
    parts.push(`Topic (${intent.topics.join(" ")}):\n${byTopic.slice(0, 6).map(dossierLine).join("\n\n")}`);
  }
  return parts.join("\n\n");
}

export function askEvidenceBlocks(retrieval: AskRetrieval): Array<{
  id: string;
  title: string;
  text: string;
}> {
  return retrieval.people.map((person) => {
    const profile = [
      person.location && `location: ${person.location}`,
      person.hometown && `hometown: ${listText(person.hometown)}`,
      person.company && `company: ${person.company}`,
      person.jobTitle && `job title: ${person.jobTitle}`,
      person.industry && `industry: ${person.industry}`,
      person.foods && `foods: ${person.foods}`,
      person.interests && `interests: ${person.interests}`,
      person.skills && `skills: ${person.skills}`,
      person.notes && `notes: ${person.notes.slice(0, 400)}`,
    ].filter(Boolean).join("\n");
    const evidence = person.matches
      .map((match, index) => {
        const id = match.evidenceId || `${person.personId}:${match.field}:${index}`;
        return `[${id}] ${match.source} ${match.field}: ${match.excerpt}`;
      })
      .join("\n");
    return {
      id: person.personId,
      title: person.name,
      text: `${profile}\n${evidence}`.trim().slice(0, 1_800),
    };
  });
}

export function askCitations(retrieval: AskRetrieval): AskCitation[] {
  return retrieval.people.flatMap((person) => {
    const matches = person.matches.length
      ? person.matches.slice(0, 2)
      : [{
        field: person.location ? "location" : "profile",
        source: "nett",
        excerpt: person.location || person.industry || person.name,
        evidenceId: undefined,
      }];
    return matches.map((match) => ({
      personId: person.personId,
      label: person.name,
      field: match.field,
      value: match.excerpt,
      source: match.source,
      evidenceId: match.evidenceId,
    }));
  });
}

