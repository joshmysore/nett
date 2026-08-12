/**
 * Deterministic shared-context suggestions.
 *
 * Nett already stores place, school, company, and mutuals as owned facts. When
 * several people share enough of those signals, proposing the missing ones is
 * retrieval over the user's own graph — not invention. Every proposal stays
 * reviewable and cites the overlapping attributes that justified it.
 */

import { db } from "../db.js";

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
    "area", "metro", "greater", "city", "county", "tx", "texas", "ca", "ny",
  ]);
  for (const value of values) {
    const normalized = normalizeToken(value);
    if (!normalized) continue;
    // Keep multi-word phrases and individual city-sized tokens.
    if (normalized.length >= 3 && !stop.has(normalized)) out.add(normalized);
    for (const part of normalized.split(/[/,|]/).map((item) => item.trim()).filter(Boolean)) {
      if (part.length >= 3 && !stop.has(part)) out.add(part);
      for (const word of part.split(" ")) {
        if (word.length >= 4 && !stop.has(word)) out.add(word);
      }
    }
  }
  // Drop ultra-generic state-only tokens that would over-match.
  for (const generic of ["texas", "california", "new york", "florida", "england", "canada"]) {
    if (out.size > 1) out.delete(generic);
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
  const rows = db.prepare(`
    SELECT p.id, p.preferred_name, COALESCE(p.nickname, '') AS nickname,
      m.hometown, m.location, m.institutions, m.mutuals, m.company, m.industry,
      m.how_met, m.where_met
    FROM people p
    LEFT JOIN nett_metadata m ON m.person_id = p.id
  `).all() as Record<string, unknown>[];

  return rows.map((row) => {
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
}

function overlapScore(a: GraphPerson, b: GraphPerson): {
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
    .map((item) => item.replace(/^(school|place|company|where-met|how-met|shared-mutuals):/, ""))
    .slice(0, 4)
    .join(", ");
}

function evidenceFor(
  personId: string,
  peers: { peer: GraphPerson; shared: string[]; score: number }[],
  summary: string,
): SharedContextEvidence[] {
  return peers.slice(0, MAX_PEER_EVIDENCE).map((item, index) => ({
    kind: "derived-signal" as const,
    sourceType: "shared-context" as const,
    sourceId: `shared-context:${personId}:${item.peer.id}:${index}`,
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
): SharedContextSuggestion[] {
  const personId = String(person.id ?? "");
  if (!personId) return [];

  const people = loadGraphPeople();
  const self = people.find((row) => row.id === personId);
  if (!self) return [];

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
    // Never propose a name that does not resolve to a stored person for
    // reciprocal/shared-context peer proposals; cluster-mutual may cite a
    // display name already recorded on a peer's mutuals list.
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

    const { score, shared } = overlapScore(target, peer);
    if (score < MIN_OVERLAP_SCORE) continue;
    strongPeers.push({ peer, shared, score });

    addMutual({
      name: peer.name,
      confidence: Math.min(0.86, 0.58 + score * 0.05),
      shared,
      peer,
      kind: "shared-context",
    });

    // Mutuals already recorded on high-overlap peers are strong cluster cues.
    for (const listed of peer.mutuals) {
      const listedKey = normalizeToken(listed);
      if (!listedKey || knownMutuals.has(listedKey)) continue;
      if (target.nameKeys.has(listedKey)) continue;
      // Prefer names that also exist as people in the graph.
      const resolved = people.find((row) => row.nameKeys.has(listedKey));
      if (resolved && resolved.id === target.id) continue;
      const clusterBoost = resolved
        ? overlapScore(target, resolved).score >= MIN_OVERLAP_SCORE
        : false;
      if (!resolved && score < MIN_OVERLAP_SCORE + 2) continue;
      addMutual({
        name: resolved?.name ?? listed,
        confidence: Math.min(0.8, (clusterBoost ? 0.7 : 0.6) + score * 0.02),
        shared: [...shared, `via:${peer.name}`],
        peer,
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
    suggestions.push({
      field: "mutuals",
      value: merged,
      confidence: Math.max(...rankedMutuals.map((item) => item.confidence)),
      reason: reasonParts.join("; ") || "Suggested from overlapping place, school, and mutuals.",
      evidence: evidenceFor(
        personId,
        rankedMutuals.map((item) => ({
          peer: item.peer,
          shared: item.shared,
          score: Math.round(item.confidence * 10),
        })),
        "mutuals-from-shared-context",
      ),
    });
  }

  // Sparse field consensus among strong peers — only when the field is empty.
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
    {
      field: "where_met",
      read: (peer) => peer.whereMet,
      empty: emptyScalar(person.where_met),
      list: false,
    },
    {
      field: "how_met",
      read: (peer) => peer.howMet,
      empty: emptyScalar(person.how_met),
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
      // For places/institutions, require the target already shares another
      // strong signal with those peers — otherwise any popular company wins.
      const supporting = winner.peers.filter((item) => item.score >= MIN_OVERLAP_SCORE);
      if (supporting.length < 2) continue;
      const confidence = Math.min(0.78, 0.52 + supporting.length * 0.08);
      suggestions.push({
        field: field.field,
        value: field.list ? [winner.value] : winner.value,
        confidence,
        reason: `${supporting.length} people who share context with ${target.name} also have “${winner.value}” for ${field.field.replaceAll("_", " ")}.`,
        evidence: evidenceFor(personId, supporting, `consensus:${field.field}`),
      });
    }
  }

  return suggestions;
}
