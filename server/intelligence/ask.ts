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
  headline: string | null;
  relationship: string | null;
  howMet: string | null;
  whenMet: string | null;
  whereMet: string | null;
  quickMemories: string | null;
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
  inferential: boolean;
  personBrief: boolean;
  namedPerson: string | null;
};

export type AskRetrieval = {
  intent: AskIntent;
  people: AskPerson[];
  provider: "local-people-index" | "local-evidence";
};

export type AskRetrieveOptions = {
  signal?: AbortSignal;
  /** Dedicated embedding model only. Omit when Ollama has no embed model. */
  embedQuery?: (text: string, signal?: AbortSignal) => Promise<number[] | null>;
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
  "else", "talked", "talk", "talking", "tell",
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
const EVIDENCE_PER_PERSON = 6;

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

const INFERENTIAL_PATTERN = /\b(might|maybe|perhaps|would|could|should|interested|recommend|suggest|introduc(?:e|tion)?|relevant|good fit|who would|who might|likely|probably)\b/i;
const PERSON_BRIEF_PATTERN = /^(?:tell me about|what(?: else)? do i know about|who is|who'?s|about)\s+(.+?)\s*[.?!]*$/i;

export function isInferentialQuestion(question: string): boolean {
  if (/\bfollow[ -]?up\b/i.test(question)) return false;
  return INFERENTIAL_PATTERN.test(question);
}

export function isPersonBriefQuestion(question: string): boolean {
  return PERSON_BRIEF_PATTERN.test(question.trim());
}

export function extractNamedPerson(question: string): string | null {
  const trimmed = question.trim().replace(/[.?!]+$/, "").trim();
  const brief = trimmed.match(PERSON_BRIEF_PATTERN);
  if (brief?.[1]) {
    const name = brief[1].replace(/^(the|my|our)\s+/i, "").trim();
    return name.length >= 2 ? name : null;
  }
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 4) return null;
  if (words.some((word) => STOPWORDS.has(word.toLocaleLowerCase()))) return null;
  if (/\d/.test(trimmed)) return null;
  return trimmed;
}

/** Text handed to the embedding model — constraints, not question syntax. */
export function embedQueryText(intent: AskIntent): string {
  const parts = [
    ...intent.places,
    ...intent.topics,
    ...intent.expansions.slice(0, 8),
    intent.foodIntent ? "food cuisine" : "",
  ].filter(Boolean);
  return parts.join(" ") || intent.question;
}

export function cosine(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  if (!length) return 0;
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (let index = 0; index < length; index++) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

export function reciprocalRankFusion(rankedIds: readonly (readonly string[])[], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedIds) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return scores;
}

type EmbeddedRow = {
  id: string;
  person_id: string | null;
  kind: string;
  source: string;
  text: string;
  occurred_at: string | null;
  embedding_json: string;
};

export function scoreEmbeddedRows(
  query: readonly number[],
  rows: readonly EmbeddedRow[],
  limit = 24,
  minScore = 0.28,
): Array<EmbeddedRow & { score: number }> {
  return rows
    .map((row) => {
      let embedding: number[] = [];
      try { embedding = JSON.parse(row.embedding_json) as number[]; } catch { embedding = []; }
      return { ...row, score: cosine(query, embedding) };
    })
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Profile, memory, and conversation summaries — not raw message bodies. */
export function loadEmbeddableDocuments(limit = 2_000): EmbeddedRow[] {
  return db.prepare(`
    SELECT id, person_id, kind, source, text, occurred_at, embedding_json
    FROM evidence_documents
    WHERE embedding_json IS NOT NULL
      AND kind IN ('profile-field', 'memory', 'conversation-summary')
    ORDER BY kind ASC, occurred_at DESC
    LIMIT ?
  `).all(limit) as EmbeddedRow[];
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
  const namedPerson = extractNamedPerson(question);
  if (namedPerson) {
    for (const token of tokenize(namedPerson)) consumed.add(token);
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
    inferential: isInferentialQuestion(question),
    personBrief: Boolean(namedPerson) || isPersonBriefQuestion(question),
    namedPerson,
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
  relationship: string | null;
  how_met: string | null;
  when_met: string | null;
  where_met: string | null;
  last_contact: string | null;
};

const PROFILE_SELECT = `
  SELECT p.id, p.preferred_name AS name, m.location, m.hometown, m.company, m.job_title,
    m.industry, m.foods, m.interests, m.skills, m.notes, m.quick_memories, m.headline,
    m.relationship, m.how_met, m.when_met, m.where_met, m.last_contact
`;

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
    headline: row.headline,
    relationship: row.relationship,
    howMet: row.how_met,
    whenMet: row.when_met,
    whereMet: row.where_met,
    quickMemories: listText(row.quick_memories) || null,
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
    ${PROFILE_SELECT}
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
      ${PROFILE_SELECT}
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
    ${PROFILE_SELECT}
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
    ${PROFILE_SELECT}
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
    quick_memories: person.quickMemories,
    headline: person.headline,
    relationship: person.relationship,
    how_met: person.howMet,
    when_met: person.whenMet,
    where_met: person.whereMet,
    last_contact: person.lastContact,
  } satisfies ProfileRow]));
  applyEvidenceHits(byPerson, hits, intent.topics.length ? "topic" : "place", profiles);
}

function humanDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const diff = Date.now() - ms;
  if (diff < 36_000_000) return "today";
  if (diff < 90_000_000) return "yesterday";
  if (diff < 14 * 86_400_000) return `${Math.max(2, Math.round(diff / 86_400_000))} days ago`;
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function usefulExcerpt(person: AskPerson, excerpt: string): boolean {
  const clean = excerpt.replace(/\s+/g, " ").trim();
  if (clean.length < 8) return false;
  if (/^name:\s*/i.test(clean)) return false;
  if (/^last recorded contact /i.test(clean)) return false;
  const lower = clean.toLocaleLowerCase();
  if (lower === person.name.toLocaleLowerCase()) return false;
  const parts = person.name.split(/\s+/);
  const last = parts[parts.length - 1]?.toLocaleLowerCase();
  if (last && lower === last) return false;
  return true;
}

function nameScore(row: ProfileRow, query: string): number {
  const needle = query.toLocaleLowerCase();
  const name = row.name.toLocaleLowerCase();
  if (name === needle) return 100;
  const parts = needle.split(/\s+/);
  if (name.startsWith(needle)) return 85;
  if (parts.length >= 2 && name.endsWith(parts[parts.length - 1]) && name.startsWith(parts[0])) return 80;
  if (parts.length === 1 && (name.startsWith(parts[0]) || name.split(/\s+/)[0] === parts[0])) return 45;
  return 20;
}

function loadNamedPeople(query: string): AskPerson[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  const last = parts.slice(1).join(" ");
  const like = `${trimmed.replace(/[%_]/g, "")}%`;
  const rows = db.prepare(`
    ${PROFILE_SELECT}
    FROM people p
    LEFT JOIN nett_metadata m ON m.person_id = p.id
    WHERE p.preferred_name = ? COLLATE NOCASE
       OR p.nickname = ? COLLATE NOCASE
       OR (p.first_name = ? COLLATE NOCASE AND (? = '' OR p.last_name = ? COLLATE NOCASE))
       OR p.preferred_name LIKE ? COLLATE NOCASE
       OR p.nickname LIKE ? COLLATE NOCASE
       OR (? != '' AND p.last_name = ? COLLATE NOCASE AND p.first_name LIKE ? COLLATE NOCASE)
    LIMIT 16
  `).all(
    trimmed, trimmed, first, last, last || first, like, like, last, last, `${first}%`,
  ) as ProfileRow[];
  const ranked = [...new Map(rows.map((row) => [row.id, row])).values()]
    .map((row) => ({ row, score: nameScore(row, trimmed) }))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  const best = ranked[0].score;
  const chosen = best >= 80
    ? ranked.filter((item) => item.score >= 80)
    : ranked.filter((item) => item.score >= 40).slice(0, 3);
  return (chosen.length ? chosen : ranked.slice(0, 1)).map((item) => {
    const person = emptyPerson(item.row);
    person.score = item.score;
    person.groups.add("name");
    return person;
  });
}

function attachPersonBriefEvidence(people: AskPerson[]): void {
  for (const person of people) {
    const facts: Array<[string, string | null]> = [
      ["relationship", person.relationship],
      ["job_title", person.jobTitle && person.company ? `${person.jobTitle} at ${person.company}` : person.jobTitle],
      ["company", person.company],
      ["headline", person.headline],
      ["location", person.location],
      ["hometown", listText(person.hometown)],
      ["how_met", [person.howMet, person.whenMet, person.whereMet].filter(Boolean).join(" · ") || null],
      ["interests", person.interests],
      ["foods", person.foods],
      ["notes", person.notes],
      ["quick_memories", person.quickMemories],
    ];
    for (const [field, value] of facts) {
      if (!value || !usefulExcerpt(person, value)) continue;
      addMatch(person, "profile", { field, source: "nett", excerpt: value.slice(0, 240) }, 5);
    }
    if (person.lastContact) {
      addMatch(person, "profile", {
        field: "last_contact",
        source: "nett",
        excerpt: `Last talked ${humanDate(person.lastContact)}`,
        occurredAt: person.lastContact,
      }, 2);
    }
    const docs = db.prepare(`
      SELECT id, source, kind, text, occurred_at
      FROM evidence_documents
      WHERE person_id = ?
        AND kind IN ('memory', 'conversation-summary', 'interaction', 'profile')
      ORDER BY CASE kind
        WHEN 'memory' THEN 0
        WHEN 'conversation-summary' THEN 1
        WHEN 'profile' THEN 2
        ELSE 3
      END, occurred_at DESC
      LIMIT 10
    `).all(person.personId) as Array<{
      id: string;
      source: string;
      kind: string;
      text: string;
      occurred_at: string | null;
    }>;
    for (const doc of docs) {
      const excerpt = doc.text.replace(/\s+/g, " ").trim().slice(0, 240);
      if (!usefulExcerpt(person, excerpt)) continue;
      addMatch(person, "evidence", {
        field: doc.kind === "memory" ? "memory" : doc.kind === "conversation-summary" ? "conversation" : "profile",
        source: doc.source,
        excerpt,
        evidenceId: doc.id,
        occurredAt: doc.occurred_at,
      }, doc.kind === "memory" ? 4 : 3);
    }
    person.matches = person.matches.slice(0, EVIDENCE_PER_PERSON + 2);
  }
}

export async function retrieveAskMatches(
  question: string,
  options: AskRetrieveOptions = {},
): Promise<AskRetrieval> {
  const intent = parseAskIntent(question);
  if (intent.namedPerson) {
    const named = loadNamedPeople(intent.namedPerson);
    if (named.length) {
      attachPersonBriefEvidence(named);
      return { intent, people: named, provider: "local-evidence" };
    }
  }
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

  const fromVector = new Map<string, AskPerson>();
  const needsSemantic = Boolean(
    options.embedQuery && (intent.topics.length || intent.inferential || intent.foodIntent),
  );
  if (needsSemantic && options.embedQuery) {
    try {
      const queryVector = await options.embedQuery(embedQueryText(intent), options.signal);
      if (queryVector?.length) {
        const ranked = scoreEmbeddedRows(queryVector, loadEmbeddableDocuments());
        const vectorIds = ranked.map((row) => row.person_id).filter(Boolean) as string[];
        const vectorProfiles = profilesByIds(vectorIds);
        for (const row of ranked) {
          if (!row.person_id) continue;
          const profile = vectorProfiles.get(row.person_id);
          if (!profile) continue;
          const person = fromVector.get(row.person_id) ?? emptyPerson(profile);
          const field = row.kind === "memory"
            ? "memory"
            : row.kind === "conversation-summary"
              ? "conversation"
              : "profile";
          addMatch(person, "topic", {
            field,
            source: row.source,
            excerpt: row.text.replace(/\s+/g, " ").trim().slice(0, 240),
            evidenceId: row.id,
            occurredAt: row.occurred_at,
          }, 3 + Math.round(row.score * 4));
          fromVector.set(row.person_id, person);
        }
      }
    } catch {
      // Lexical and structured retrieval still answer when embedding fails.
    }
  }

  const evidenceIds = [...placeFts, ...topicFts, ...combinedFts].map((hit) => hit.person_id).filter(Boolean) as string[];
  const structuredIds = [...placePeople.keys(), ...topicPeople.keys(), ...recent.keys(), ...fromVector.keys()];
  const profiles = profilesByIds([...structuredIds, ...evidenceIds]);

  const fromPlaceEvidence = new Map<string, AskPerson>();
  applyEvidenceHits(fromPlaceEvidence, placeFts, "place", profiles);
  const fromTopicEvidence = new Map<string, AskPerson>();
  applyEvidenceHits(fromTopicEvidence, topicFts, "topic", profiles);
  applyEvidenceHits(fromTopicEvidence, combinedFts, "topic", profiles);
  applyEvidenceHits(fromPlaceEvidence, combinedFts, "place", profiles);

  const merged = mergePeople(placePeople, topicPeople, recent, fromPlaceEvidence, fromTopicEvidence, fromVector);
  const people = selectPeople(merged, intent);
  attachEvidenceForPeople(people, intent);

  const simplePlace = intent.places.length > 0
    && !intent.topics.length
    && !intent.foodIntent
    && !intent.recencyDays
    && !intent.sources.length
    && !intent.inferential;

  return {
    intent,
    people,
    provider: simplePlace ? "local-people-index" : "local-evidence",
  };
}

function personFact(person: AskPerson): string {
  return [
    person.relationship,
    person.jobTitle && person.company ? `${person.jobTitle} at ${person.company}` : person.company || person.headline,
    person.location,
    person.interests,
    person.foods,
    person.industry,
  ].find(Boolean) || "";
}

function formatPersonBrief(people: AskPerson[], named: string | null): string {
  if (people.length > 1 && named && named.trim().split(/\s+/).length < 2) {
    const lines = people.map((person) => {
      const fact = personFact(person);
      return fact ? `${person.name} — ${fact}` : person.name;
    });
    return `${people.length} people match ${named}: ${lines.join("; ")}.`;
  }
  const person = people[0];
  const others = people.slice(1);
  const role = person.jobTitle && person.company
    ? `${person.jobTitle} at ${person.company}`
    : person.company || person.headline;
  const sentences: string[] = [];
  if (person.relationship && role) {
    sentences.push(`${person.name} is ${person.relationship}, ${role}.`);
  } else if (person.relationship) {
    sentences.push(`${person.name} is ${person.relationship}.`);
  } else if (role) {
    sentences.push(`${person.name} — ${role}.`);
  } else {
    sentences.push(`${person.name} is in your stored record.`);
  }
  if (person.location) sentences.push(`Based in ${person.location}.`);
  const hometown = listText(person.hometown);
  if (hometown) sentences.push(`Hometown: ${hometown}.`);
  const met = [person.howMet, person.whenMet, person.whereMet].filter(Boolean).join(", ");
  if (met) sentences.push(`You met ${met}.`);
  if (person.interests) sentences.push(`Interests include ${person.interests}.`);
  if (person.foods) sentences.push(`Foods: ${person.foods}.`);
  if (person.notes) sentences.push(person.notes.replace(/\s+/g, " ").trim().slice(0, 220));
  if (person.quickMemories) sentences.push(person.quickMemories.replace(/\s+/g, " ").trim().slice(0, 180));
  const when = humanDate(person.lastContact);
  if (when) sentences.push(`Last recorded contact ${when}.`);
  const quote = person.matches.find((match) =>
    match.field !== "last_contact" && match.source !== "nett" && usefulExcerpt(person, match.excerpt)
  );
  if (quote) sentences.push(`From ${quote.source}: “${quote.excerpt.slice(0, 160)}”`);
  if (others.length) {
    sentences.push(`Also in the record: ${others.map((item) => item.name).join(", ")}.`);
  }
  return sentences.join(" ");
}

export function formatAskAnswer(retrieval: AskRetrieval): string {
  const { intent, people } = retrieval;
  if (!people.length) {
    return "Nothing stored in people, notes, messages, or email matched that question.";
  }
  if (intent.personBrief) return formatPersonBrief(people, intent.namedPerson);
  const required = requiredGroups(intent);
  const complete = required.length
    ? people.filter((person) => required.every((group) => person.groups.has(group)))
    : people;
  const shown = complete.length ? complete : people;
  const constraints = [
    intent.places.length ? intent.places.join(", ") : "",
    intent.topics.length ? intent.topics.join(" ") : "",
  ].filter(Boolean).join(" and ");

  if (!complete.length && required.length) {
    const names = shown.slice(0, 6).map((person) => person.name);
    return `No one matched every part of ${constraints || "that question"}. Closest stored people: ${names.join(", ")}.`;
  }

  if (shown.length === 1) {
    const person = shown[0];
    const fact = personFact(person);
    return fact ? `${person.name} — ${fact}.` : `${person.name} is in the stored record.`;
  }

  const names = shown.slice(0, 6).map((person) => person.name);
  const extra = shown.length - names.length;
  const topic = constraints
    || (intent.recencyDays ? `a recorded contact in the last ${intent.recencyDays} days` : "that question");
  return `${shown.length} people match ${topic}: ${names.join(", ")}${extra > 0 ? `, and ${extra} more` : ""}.`;
}

export function askEvidenceBlocks(retrieval: AskRetrieval): Array<{
  id: string;
  title: string;
  text: string;
}> {
  const blocks: Array<{ id: string; title: string; text: string }> = [];
  for (const person of retrieval.people) {
    const profile = [
      person.relationship && `relationship: ${person.relationship}`,
      person.location && `location: ${person.location}`,
      person.hometown && `hometown: ${listText(person.hometown)}`,
      person.company && `company: ${person.company}`,
      person.jobTitle && `job title: ${person.jobTitle}`,
      person.headline && `headline: ${person.headline}`,
      person.industry && `industry: ${person.industry}`,
      person.howMet && `how met: ${person.howMet}`,
      person.whenMet && `when met: ${person.whenMet}`,
      person.whereMet && `where met: ${person.whereMet}`,
      person.foods && `foods: ${person.foods}`,
      person.interests && `interests: ${person.interests}`,
      person.skills && `skills: ${person.skills}`,
      person.notes && `notes: ${person.notes.slice(0, 400)}`,
      person.quickMemories && `memories: ${person.quickMemories.slice(0, 240)}`,
      person.lastContact && `last contact: ${humanDate(person.lastContact)}`,
    ].filter(Boolean).join("\n");
    blocks.push({
      id: person.personId,
      title: person.name,
      text: profile || person.name,
    });
    for (const match of person.matches.slice(0, EVIDENCE_PER_PERSON)) {
      if (!match.excerpt) continue;
      const id = match.evidenceId || `${person.personId}:${match.field}:${blocks.length}`;
      blocks.push({
        id,
        title: `${person.name} · ${match.source}`,
        text: [match.occurredAt, match.excerpt].filter(Boolean).join("\n").slice(0, 900),
      });
    }
  }
  return blocks.slice(0, 16);
}

export function retrievalPathNote(retrieval: AskRetrieval): string {
  const sources = [...new Set(
    retrieval.people.flatMap((person) => person.matches.map((match) => match.source)).filter(Boolean),
  )];
  const threads = retrieval.people.reduce(
    (count, person) => count + person.matches.filter((match) => match.field === "conversation").length,
    0,
  );
  if (!sources.length) return "";
  const comms = sources.filter((source) => ["messages", "whatsapp", "gmail", "telegram"].includes(source));
  if (comms.length) {
    const labels = comms.map((source) => source === "messages" ? "Messages" : source === "whatsapp" ? "WhatsApp" : source);
    return `From ${labels.join(" and ")}${threads ? ` · ${threads} cited span${threads === 1 ? "" : "s"}` : ""}.`;
  }
  return `Matched from stored ${sources.slice(0, 3).join(", ")} records.`;
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

