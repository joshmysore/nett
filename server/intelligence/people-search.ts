/** Person search over evidence_fts plus a name prefix, for Find and People q=. */

import { db, summarizePeople } from "../db.js";
import { ftsQuery } from "./ask.js";

function namePrefixIds(query: string, limit: number): string[] {
  const needle = query.trim();
  if (!needle) return [];
  const like = `${needle.replace(/[%_]/g, "")}%`;
  const rows = db.prepare(`
    SELECT p.id FROM people p
    WHERE p.preferred_name LIKE ? COLLATE NOCASE
       OR p.nickname LIKE ? COLLATE NOCASE
    ORDER BY p.preferred_name ASC
    LIMIT ?
  `).all(like, like, limit) as { id: string }[];
  return rows.map((row) => row.id);
}

function evidencePersonIds(query: string, limit: number): string[] {
  const match = ftsQuery(query);
  if (!match) return [];
  try {
    const rows = db.prepare(`
      SELECT d.person_id AS id, MIN(bm25(evidence_fts)) AS rank
      FROM evidence_fts
      JOIN evidence_documents d ON d.id = evidence_fts.document_id
      WHERE evidence_fts MATCH ? AND d.person_id IS NOT NULL
      GROUP BY d.person_id
      ORDER BY rank ASC
      LIMIT ?
    `).all(match, limit) as { id: string }[];
    return rows.map((row) => row.id);
  } catch {
    return [];
  }
}

/** Ordered unique person ids: exact/prefix name first, then evidence hits. */
export function searchPersonIds(query: string, limit = 24): string[] {
  const text = String(query || "").trim();
  if (!text) return [];
  const names = namePrefixIds(text, limit);
  const evidence = evidencePersonIds(text, limit);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of [...names, ...evidence]) {
    if (seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
    if (ordered.length >= limit) break;
  }
  return ordered;
}

export function searchPeopleFromEvidence(query: string, limit = 12) {
  return summarizePeople(searchPersonIds(query, limit));
}
