/**
 * Deterministic shared-context suggestions.
 *
 * Nett already stores place, school, company, and mutuals as owned facts. When
 * several people share enough of those signals, proposing the missing ones is
 * retrieval over the user's own graph — not invention. Every proposal stays
 * reviewable and cites the overlapping attributes that justified it.
 */

import { db } from "../db.js";
import { getOwnerContext } from "../setup.js";

export type SharedContextEvidence = {
  kind: "derived-signal";
  sourceType: "shared-context";
  sourceId: string;
  excerpt: string;
  structured: Record<string, unknown>;
  observedAt: null;
};

export type SharedContextSuggestion = {
  field: string;
  value: unknown;
  confidence: number;
  reason: string;
  evidence: SharedContextEvidence[];
};

type GraphPerson = {
  id: string;
  name: string;
  nickname: string;
  nameKeys: Set<string>;
  hometown: string[];
  location: string;
  institutions: string[];
  mutuals: string[];
  company: string;
  industry: string;
  howMet: string;
  whereMet: string;
  tokens: {
    place: Set<string>;
    institution: Set<string>;
    company: Set<string>;
    whereMet: Set<string>;
    howMet: Set<string>;
  };
};

const STRONG_SIGNAL_WEIGHT = {
  institution: 3,
  place: 2,
  company: 2,
  whereMet: 1,
  howMet: 1,
} as const;

const MIN_OVERLAP_SCORE = 4; // e.g. institution (3) + place (2) or company+place
const MAX_MUTUAL_ADDITIONS = 6;
const MAX_PEER_EVIDENCE = 4;
const GRAPH_CACHE_MS = 5_000;

let graphCache: { at: number; signature: string; rows: GraphPerson[] } | null = null;

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  }
  if (!value) return [];
  const text = String(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
    }
  } catch {
    // Fall through to delimiter split for legacy plain text.
  }
  return text.split(/[,;|]/).map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function normalizeToken(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s.+'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameKeysFor(name: string, nickname = ""): Set<string> {
  const keys = new Set<string>();
  const push = (raw: string) => {
    const key = normalizeToken(raw);
    if (key.length >= 2) keys.add(key);
  };
  push(name);
  push(nickname);
  const parts = normalizeToken(name).split(" ").filter(Boolean);
  if (parts.length >= 2) {
    push(`${parts[0]} ${parts[parts.length - 1]}`);
  }
  return keys;
}

function placeTokens(...values: string[]): Set<string> {
  const out = new Set<string>();
  const stop = new Set([
    "usa", "us", "united states", "united states of america", "the", "of", "and",
    "area", "metro", "greater", "city", "county",
    "texas", "california", "florida", "england", "canada", "australia",
    "new york", "tx", "ca", "ny", "fl",
  ]);
  const add = (raw: string) => {
    const normalized = normalizeToken(raw);
    if (!normalized || normalized.length < 3 || stop.has(normalized)) return;
    out.add(normalized);
  };
  for (const value of values) {
    add(value);
    // Keep the city head so "Dallas" overlaps "Dallas, Texas" without
    // splitting "New York" into "york".
    const head = value.split(",")[0] ?? value;
    if (head.trim() !== String(value).trim()) add(head);
  }
  return out;
}

function institutionAcronym(value: string): string | null {
  const head = value.split(",")[0] ?? value;
  const words = head
    .replace(/[^a-zA-Z\s]/g, " ")
    .split(/\s+/)
    .filter((word) =>
      word.length
      && !/^(of|the|and|at|for|in|high|school|prep|senior|academy)$/i.test(word));
  if (words.length < 2) return null;
  const acronym = words.map((word) => word[0]!.toLocaleLowerCase()).join("");
  // Two-letter acronyms collide too easily (e.g. "Southern Methodist" → "sm").
  return acronym.length >= 3 && acronym.length <= 6 ? acronym : null;
}

function institutionTokens(values: string[]): Set<string> {
  const out = new Set<string>();
  const strip = (value: string) =>
    normalizeToken(value.split(",")[0] ?? value)
      .replace(/\b(university|college|school|high school|institute|academy|prep|senior)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  for (const value of values) {
    const head = value.split(",")[0] ?? value;
    const full = normalizeToken(head);
    if (full.length >= 2) out.add(full);
    const stripped = strip(value);
    if (stripped.length >= 3) out.add(stripped);
    const acronym = institutionAcronym(value);
    if (acronym) out.add(acronym);
  }
  return out;
}

function scalarTokens(value: string): Set<string> {
  const key = normalizeToken(value);
  return key.length >= 2 ? new Set([key]) : new Set();
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  for (const item of left) if (right.has(item)) count += 1;
  return count;
}

function sharedLabels(left: Set<string>, right: Set<string>, limit = 3): string[] {
  const out: string[] = [];
  for (const item of left) {
    if (!right.has(item)) continue;
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function loadGraphPeople(): GraphPerson[] {
  const signatureRow = db.prepare(`
    SELECT COUNT(*) AS count, COALESCE(MAX(updated_at), '') AS stamp FROM people
  `).get() as { count: number; stamp: string };
  const signature = `${signatureRow.count}:${signatureRow.stamp}`;
  if (
    graphCache
    && graphCache.signature === signature
    && Date.now() - graphCache.at < GRAPH_CACHE_MS
  ) {
    return graphCache.rows;
  }

  const rows = db.prepare(`
    SELECT p.id, p.preferred_name, COALESCE(p.nickname, '') AS nickname,
      m.hometown, m.location, m.institutions, m.mutuals, m.company, m.industry,
      m.how_met, m.where_met
    FROM people p
    LEFT JOIN nett_metadata m ON m.person_id = p.id
  `).all() as Record<string, unknown>[];

  const people = rows.map((row) => {
    const name = String(row.preferred_name ?? "").trim();
    const nickname = String(row.nickname ?? "").trim();
    const hometown = parseList(row.hometown);
    const location = String(row.location ?? "").trim();
    const institutions = parseList(row.institutions);
    const mutuals = parseList(row.mutuals);
    const company = String(row.company ?? "").trim();
    const industry = String(row.industry ?? "").trim();
    const howMet = String(row.how_met ?? "").trim();
    const whereMet = String(row.where_met ?? "").trim();
    return {
      id: String(row.id),
      name,
      nickname,
      nameKeys: nameKeysFor(name, nickname),
      hometown,
      location,
      institutions,
      mutuals,
      company,
      industry,
      howMet,
      whereMet,
      tokens: {
        place: placeTokens(...hometown, location),
        institution: institutionTokens(institutions),
        company: scalarTokens(company),
        whereMet: scalarTokens(whereMet),
        howMet: scalarTokens(howMet),
      },
    };
  });
  graphCache = { at: Date.now(), signature, rows: people };
  return people;
}

/** School overlap, or place reinforced by already-shared mutuals — never company+city alone.
 *  Owner hometown is a named cluster prior (Instagram-mutuals style), never a sole signal. */
function qualifiesForMutualProposal(shared: string[]): boolean {
  const hasSchool = shared.some((item) => item.startsWith("school:"));
  const hasPlace = shared.some((item) => item.startsWith("place:"));
  const hasMutualOverlap = shared.some((item) => item.startsWith("shared-mutuals:"));
  if (hasSchool && (hasPlace || hasMutualOverlap)) return true;
  if (hasSchool && shared.length >= 2) return true;
  if (hasPlace && hasMutualOverlap) return true;
  return false;
}

function buildNameIndex(people: readonly GraphPerson[]): Map<string, GraphPerson> {
  const index = new Map<string, GraphPerson>();
  for (const person of people) {
    for (const key of person.nameKeys) {
      if (!index.has(key)) index.set(key, person);
    }
  }
  return index;
}

function overlapScore(a: GraphPerson, b: GraphPerson, ownerPlaces: Set<string> = new Set()): {
  score: number;
  shared: string[];
} {
  const shared: string[] = [];
  let score = 0;

  const institutionHits = sharedLabels(a.tokens.institution, b.tokens.institution);
  if (institutionHits.length) {
    score += STRONG_SIGNAL_WEIGHT.institution;
    shared.push(...institutionHits.map((item) => `school:${item}`));
  }
  const placeHits = sharedLabels(a.tokens.place, b.tokens.place);
  if (placeHits.length) {
    score += STRONG_SIGNAL_WEIGHT.place;
    shared.push(...placeHits.map((item) => `place:${item}`));
    const ownerHits = placeHits.filter((item) => ownerPlaces.has(item));
    if (ownerHits.length) {
      score += 1;
      shared.push(`owner-place:${ownerHits[0]}`);
    }
  }
  const companyHits = sharedLabels(a.tokens.company, b.tokens.company);
  if (companyHits.length) {
    score += STRONG_SIGNAL_WEIGHT.company;
    shared.push(...companyHits.map((item) => `company:${item}`));
  }
  const whereHits = sharedLabels(a.tokens.whereMet, b.tokens.whereMet);
  if (whereHits.length) {
    score += STRONG_SIGNAL_WEIGHT.whereMet;
    shared.push(...whereHits.map((item) => `where-met:${item}`));
  }
  const howHits = sharedLabels(a.tokens.howMet, b.tokens.howMet);
  if (howHits.length) {
    score += STRONG_SIGNAL_WEIGHT.howMet;
    shared.push(...howHits.map((item) => `how-met:${item}`));
  }

  // Soft boost when both sides already name overlapping mutuals — reinforces
  // a cluster without inventing people who are not already recorded.
  const mutualOverlap = intersectionSize(
    new Set(a.mutuals.map(normalizeToken)),
    new Set(b.mutuals.map(normalizeToken)),
  );
  if (mutualOverlap > 0 && score > 0) {
    score += Math.min(2, mutualOverlap);
    shared.push(`shared-mutuals:${mutualOverlap}`);
  }

  return { score, shared };
}

function listsPerson(mutuals: string[], target: GraphPerson): boolean {
  const keys = target.nameKeys;
  return mutuals.some((mutual) => keys.has(normalizeToken(mutual)));
}

function formatShared(shared: string[]): string {
  return shared
    .map((item) => item.replace(/^(school|place|company|where-met|how-met|shared-mutuals|owner-place):/, ""))
    .slice(0, 4)
    .join(", ");
}

function evidenceFor(
  personId: string,
  peers: { peer: GraphPerson; shared: string[]; score: number }[],
  summary: string,
): SharedContextEvidence[] {
  return peers.slice(0, MAX_PEER_EVIDENCE).map((item) => ({
    kind: "derived-signal" as const,
    sourceType: "shared-context" as const,
    sourceId: `shared-context:${personId}:${summary}:${item.peer.id}`,
    excerpt: `${item.peer.name} — shared ${formatShared(item.shared) || "context"}`,
    structured: {
      peerId: item.peer.id,
      peerName: item.peer.name,
      shared: item.shared,
      overlapScore: item.score,
      summary,
    },
    observedAt: null,
  }));
}

function emptyScalar(value: unknown): boolean {
  return !String(value ?? "").trim();
}

function emptyList(value: unknown): boolean {
  return parseList(value).length === 0;
}

/**
 * Propose mutuals and sparse context fields for one person from owned overlap
 * with others. Returns zero or more independently reviewable suggestions.
 */
export function collectSharedContextSuggestions(
  person: Record<string, unknown>,
  options: { rejectedMutualKeys?: ReadonlySet<string> } = {},
): SharedContextSuggestion[] {
  const personId = String(person.id ?? "");
  if (!personId) return [];

  const people = loadGraphPeople();
  const nameIndex = buildNameIndex(people);
  const self = people.find((row) => row.id === personId);
  if (!self) return [];
  const ownerPlaces = placeTokens(...getOwnerContext().hometowns);

  // Prefer live person fields (may be fresher than the lean row) when present.
  const liveHometown = Array.isArray(person.hometown) ? person.hometown.map(String) : self.hometown;
  const liveLocation = String(person.location ?? self.location ?? "");
  const liveInstitutions = Array.isArray(person.institutions)
    ? person.institutions.map(String)
    : self.institutions;
  const liveMutuals = Array.isArray(person.mutuals) ? person.mutuals.map(String) : self.mutuals;
  const liveCompany = String(person.company ?? self.company ?? "");
  const target: GraphPerson = {
    ...self,
    hometown: liveHometown,
    location: liveLocation,
    institutions: liveInstitutions,
    mutuals: liveMutuals,
    company: liveCompany,
    industry: String(person.industry ?? self.industry ?? ""),
    howMet: String(person.how_met ?? self.howMet ?? ""),
    whereMet: String(person.where_met ?? self.whereMet ?? ""),
    tokens: {
      place: placeTokens(...liveHometown, liveLocation),
      institution: institutionTokens(liveInstitutions),
      company: scalarTokens(liveCompany),
      whereMet: scalarTokens(String(person.where_met ?? self.whereMet ?? "")),
      howMet: scalarTokens(String(person.how_met ?? self.howMet ?? "")),
    },
  };

  const knownMutuals = new Set(target.mutuals.map(normalizeToken));
  knownMutuals.add(normalizeToken(target.name));
  for (const key of options.rejectedMutualKeys ?? []) knownMutuals.add(key);

  type MutualCandidate = {
    name: string;
    confidence: number;
    shared: string[];
    peer: GraphPerson;
    kind: "reciprocal" | "shared-context" | "cluster-mutual";
  };
  const mutualCandidates = new Map<string, MutualCandidate>();

  const addMutual = (candidate: MutualCandidate) => {
    const key = normalizeToken(candidate.name);
    if (!key || knownMutuals.has(key)) return;
    const existing = mutualCandidates.get(key);
    if (!existing || candidate.confidence > existing.confidence) {
      mutualCandidates.set(key, candidate);
    }
  };

  const strongPeers: { peer: GraphPerson; shared: string[]; score: number }[] = [];

  for (const peer of people) {
    if (peer.id === target.id) continue;

    const reciprocal = listsPerson(peer.mutuals, target);
    if (reciprocal) {
      addMutual({
        name: peer.name,
        confidence: 0.9,
        shared: ["reciprocal-mutual"],
        peer,
        kind: "reciprocal",
      });
    }

    const { score, shared } = overlapScore(target, peer, ownerPlaces);
    if (score < MIN_OVERLAP_SCORE) continue;
    strongPeers.push({ peer, shared, score });

    if (qualifiesForMutualProposal(shared)) {
      addMutual({
        name: peer.name,
        confidence: Math.min(0.82, 0.58 + score * 0.04),
        shared,
        peer,
        kind: "shared-context",
      });
    }

    // Friends-of-friends only when the listed person resolves in-graph and
    // also shares strong context with the target — never unresolved ghosts.
    if (!qualifiesForMutualProposal(shared)) continue;
    for (const listed of peer.mutuals) {
      const listedKey = normalizeToken(listed);
      if (!listedKey || knownMutuals.has(listedKey)) continue;
      if (target.nameKeys.has(listedKey)) continue;
      const resolved = nameIndex.get(listedKey);
      if (!resolved || resolved.id === target.id) continue;
      const withResolved = overlapScore(target, resolved, ownerPlaces);
      if (!qualifiesForMutualProposal(withResolved.shared)) continue;
      addMutual({
        name: resolved.name,
        confidence: Math.min(0.74, 0.55 + withResolved.score * 0.03),
        shared: [...withResolved.shared, `via:${peer.name}`],
        peer: resolved,
        kind: "cluster-mutual",
      });
    }
  }

  const suggestions: SharedContextSuggestion[] = [];

  const rankedMutuals = [...mutualCandidates.values()]
    .sort((left, right) => right.confidence - left.confidence || left.name.localeCompare(right.name))
    .slice(0, MAX_MUTUAL_ADDITIONS);

  if (rankedMutuals.length) {
    const merged = [
      ...target.mutuals,
      ...rankedMutuals.map((item) => item.name),
    ];
    const reciprocalCount = rankedMutuals.filter((item) => item.kind === "reciprocal").length;
    const reasonParts: string[] = [];
    if (reciprocalCount) {
      reasonParts.push(
        `${reciprocalCount} ${reciprocalCount === 1 ? "person lists" : "people list"} ${target.name} as a mutual`,
      );
    }
    const contextPeers = rankedMutuals.filter((item) => item.kind !== "reciprocal");
    if (contextPeers.length) {
      const sample = formatShared(contextPeers[0]?.shared ?? []);
      reasonParts.push(
        `${contextPeers.length} suggested from shared context${sample ? ` (${sample})` : ""}`,
      );
    }
    const ownerPlaceLabel = rankedMutuals
      .flatMap((item) => item.shared)
      .find((item) => item.startsWith("owner-place:"))
      ?.replace(/^owner-place:/, "");
    if (ownerPlaceLabel) {
      reasonParts.push(`${ownerPlaceLabel} is one of your hometowns`);
    }
    const meanConfidence =
      rankedMutuals.reduce((sum, item) => sum + item.confidence, 0) / rankedMutuals.length;
    suggestions.push({
      field: "mutuals",
      value: merged,
      confidence: Math.min(...rankedMutuals.map((item) => item.confidence), meanConfidence),
      reason: reasonParts.join("; ") || "Suggested from overlapping place, school, and mutuals.",
      evidence: evidenceFor(
        personId,
        rankedMutuals.map((item) => ({
          peer: item.peer,
          shared: item.shared,
          score: item.kind === "reciprocal" ? 9 : Math.round(item.confidence * 10),
        })),
        "mutuals",
      ),
    });
  }

  // Sparse field consensus among strong peers — only when the field is empty.
  // Meeting stories (how/where met) are about the peer, not the target — skip.
  const consensusFields: {
    field: string;
    read: (peer: GraphPerson) => string | string[];
    empty: boolean;
    list: boolean;
  }[] = [
    {
      field: "institutions",
      read: (peer) => peer.institutions,
      empty: emptyList(person.institutions),
      list: true,
    },
    {
      field: "hometown",
      read: (peer) => peer.hometown,
      empty: emptyList(person.hometown),
      list: true,
    },
    {
      field: "location",
      read: (peer) => peer.location,
      empty: emptyScalar(person.location),
      list: false,
    },
    {
      field: "company",
      read: (peer) => peer.company,
      empty: emptyScalar(person.company),
      list: false,
    },
    {
      field: "industry",
      read: (peer) => peer.industry,
      empty: emptyScalar(person.industry),
      list: false,
    },
  ];

  // Need a real cluster: at least two strong peers.
  if (strongPeers.length >= 2) {
    const topPeers = strongPeers
      .sort((left, right) => right.score - left.score)
      .slice(0, 12);

    for (const field of consensusFields) {
      if (!field.empty) continue;
      const votes = new Map<string, { value: string; peers: typeof topPeers }>();
      for (const item of topPeers) {
        const raw = field.read(item.peer);
        const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
        for (const value of values) {
          const key = normalizeToken(value);
          if (!key) continue;
          const entry = votes.get(key) ?? { value, peers: [] };
          entry.peers.push(item);
          votes.set(key, entry);
        }
      }
      const winner = [...votes.values()]
        .filter((entry) => entry.peers.length >= 2)
        .sort((left, right) => right.peers.length - left.peers.length)[0];
      if (!winner) continue;
      // Prefer peers who also share school/place — not company-only cohorts.
      const supporting = winner.peers.filter((item) =>
        item.score >= MIN_OVERLAP_SCORE
        && (
          item.shared.some((signal) => signal.startsWith("school:"))
          || item.shared.some((signal) => signal.startsWith("place:"))
        ));
      if (supporting.length < 2) continue;
      const ownerPlaceHit = field.field === "hometown"
        && [...placeTokens(winner.value)].some((token) => ownerPlaces.has(token));
      const confidence = Math.min(
        ownerPlaceHit ? 0.84 : 0.78,
        0.52 + supporting.length * 0.08 + (ownerPlaceHit ? 0.06 : 0),
      );
      suggestions.push({
        field: field.field,
        value: field.list ? [winner.value] : winner.value,
        confidence,
        reason: `${supporting.length} people who share context with ${target.name} also have “${winner.value}” for ${field.field.replaceAll("_", " ")}.${
          ownerPlaceHit ? " That place is also one of your hometowns." : ""
        }`,
        evidence: evidenceFor(personId, supporting, `consensus:${field.field}`),
      });
    }
  }

  // Existing edges + owner hometown: fill a missing hometown from people the
  // user already connected, when those neighbors grew up in a place the owner
  // named. Does not assume strangers in a city know each other.
  if (ownerPlaces.size && emptyList(person.hometown) && !suggestions.some((item) => item.field === "hometown")) {
    const votes = new Map<string, { value: string; peers: GraphPerson[] }>();
    for (const peer of people) {
      if (peer.id === target.id) continue;
      const connected = listsPerson(peer.mutuals, target) || listsPerson(target.mutuals, peer);
      if (!connected) continue;
      for (const hometown of peer.hometown) {
        const matched = [...placeTokens(hometown)].filter((token) => ownerPlaces.has(token));
        for (const ownerToken of matched) {
          const entry = votes.get(ownerToken) ?? { value: hometown, peers: [] };
          if (!entry.peers.some((item) => item.id === peer.id)) entry.peers.push(peer);
          votes.set(ownerToken, entry);
        }
      }
    }
    const winner = [...votes.values()]
      .filter((entry) => entry.peers.length >= 2)
      .sort((left, right) => right.peers.length - left.peers.length)[0];
    if (winner) {
      suggestions.push({
        field: "hometown",
        value: [winner.value],
        confidence: Math.min(0.8, 0.56 + winner.peers.length * 0.08),
        reason: `${winner.peers.length} people already connected to ${target.name} grew up in ${winner.value} — one of your hometowns.`,
        evidence: evidenceFor(
          personId,
          winner.peers.map((peer) => ({
            peer,
            shared: [`owner-place:${normalizeToken(winner.value)}`, "neighbor-edge"],
            score: 5,
          })),
          "owner-hometown",
        ),
      });
    }
  }

  return suggestions;
}
