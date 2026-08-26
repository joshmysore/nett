/** Working briefs are a model-synthesis cache for Ask.
 *  They are not evidence, not provenance, and never write profile fields.
 *  A fingerprint of packed evidence invalidates them when records change. */

import { createHash } from "node:crypto";
import { db } from "../db.js";

export type WorkingBrief = {
  personId: string;
  body: string;
  evidenceFingerprint: string;
  evidenceIds: string[];
  model: string | null;
  provider: string | null;
  sourceQuestion: string | null;
  generatedAt: string;
  updatedAt: string;
};

export type EvidenceBlock = {
  id: string;
  title: string;
  text: string;
};

export function fingerprintEvidence(blocks: readonly EvidenceBlock[]): string {
  const hash = createHash("sha256");
  for (const block of [...blocks].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(block.id);
    hash.update("\0");
    hash.update(block.text);
    hash.update("\n");
  }
  return hash.digest("hex");
}

export function getWorkingBrief(personId: string): WorkingBrief | null {
  const row = db.prepare(`
    SELECT person_id, body, evidence_fingerprint, evidence_ids_json, model, provider,
      source_question, generated_at, updated_at
    FROM person_working_briefs
    WHERE person_id = ?
  `).get(personId) as {
    person_id: string;
    body: string;
    evidence_fingerprint: string;
    evidence_ids_json: string;
    model: string | null;
    provider: string | null;
    source_question: string | null;
    generated_at: string;
    updated_at: string;
  } | undefined;
  if (!row) return null;
  let evidenceIds: string[] = [];
  try {
    const parsed = JSON.parse(row.evidence_ids_json) as unknown;
    if (Array.isArray(parsed)) evidenceIds = parsed.map((id) => String(id));
  } catch {
    evidenceIds = [];
  }
  return {
    personId: row.person_id,
    body: row.body,
    evidenceFingerprint: row.evidence_fingerprint,
    evidenceIds,
    model: row.model,
    provider: row.provider,
    sourceQuestion: row.source_question,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
  };
}

export function upsertWorkingBrief(input: {
  personId: string;
  body: string;
  evidenceFingerprint: string;
  evidenceIds: readonly string[];
  model?: string | null;
  provider?: string | null;
  sourceQuestion?: string | null;
}): WorkingBrief {
  const now = new Date().toISOString();
  const body = input.body.trim();
  if (!body) throw new Error("Working brief body is empty");
  db.prepare(`
    INSERT INTO person_working_briefs (
      person_id, body, evidence_fingerprint, evidence_ids_json, model, provider,
      source_question, generated_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(person_id) DO UPDATE SET
      body = excluded.body,
      evidence_fingerprint = excluded.evidence_fingerprint,
      evidence_ids_json = excluded.evidence_ids_json,
      model = excluded.model,
      provider = excluded.provider,
      source_question = excluded.source_question,
      generated_at = excluded.generated_at,
      updated_at = excluded.updated_at
  `).run(
    input.personId,
    body,
    input.evidenceFingerprint,
    JSON.stringify([...input.evidenceIds]),
    input.model ?? null,
    input.provider ?? null,
    input.sourceQuestion ?? null,
    now,
    now,
  );
  return getWorkingBrief(input.personId)!;
}

export function deleteWorkingBrief(personId: string): boolean {
  const result = db.prepare("DELETE FROM person_working_briefs WHERE person_id = ?").run(personId);
  return result.changes > 0;
}

export function isWorkingBriefBlock(block: EvidenceBlock): boolean {
  return block.id.startsWith("working-brief:");
}

function isMessageLikeBlock(block: EvidenceBlock): boolean {
  if (isWorkingBriefBlock(block)) return false;
  return /·\s*(messages|whatsapp|gmail|telegram|conversation|group)\b/i.test(block.title)
    || /^group:/i.test(block.id)
    || /^comm:/i.test(block.id);
}

/** When a brief is fresh, keep it plus message/group deltas and any new block ids. */
export function packEvidenceWithBrief(
  personId: string,
  personName: string,
  blocks: readonly EvidenceBlock[],
): {
  blocks: EvidenceBlock[];
  brief: WorkingBrief | null;
  reused: boolean;
  fingerprint: string;
} {
  const personBlocks = blocks.filter((block) =>
    !isWorkingBriefBlock(block)
    && (block.id === personId
      || block.id.startsWith(`${personId}:`)
      || block.id.startsWith("comm:")
      || block.id.startsWith("group:")
      || block.title.startsWith(`${personName} ·`)
      || block.id === "name-match")
  );
  const fingerprint = fingerprintEvidence(personBlocks.length ? personBlocks : blocks);
  const brief = getWorkingBrief(personId);
  if (!brief || brief.evidenceFingerprint !== fingerprint) {
    return { blocks: [...blocks], brief, reused: false, fingerprint };
  }

  const known = new Set(brief.evidenceIds);
  const deltas = blocks.filter((block) =>
    !isWorkingBriefBlock(block)
    && (isMessageLikeBlock(block) || !known.has(block.id) || block.id === "name-match")
  );
  const briefBlock: EvidenceBlock = {
    id: `working-brief:${personId}`,
    title: `${personName} · working brief`,
    text: [
      "WORKING CONTEXT — model synthesis from earlier Ask turns.",
      "This is not source evidence and must not be treated as a stored profile field.",
      "Prefer newer evidence blocks below when they conflict.",
      `Generated: ${brief.generatedAt}`,
      brief.model ? `Model: ${brief.model}` : "",
      "",
      brief.body,
    ].filter(Boolean).join("\n"),
  };
  return {
    blocks: [briefBlock, ...deltas],
    brief,
    reused: true,
    fingerprint,
  };
}

export function workingBriefSystemPrompt(): string {
  return [
    "You write a standing working brief for one person in a private relationship memory.",
    "Use only the supplied evidence. This brief is a synthesis cache, not a profile write.",
    "Write markdown with short sections: Who; Why they matter; Role and company; Place;",
    "Recent contact and themes; Open loops or follow-ups when evidenced.",
    "Quote important messages or notes briefly. Never invent facts.",
    "Never infer health, politics, religion, sexuality, or ethnicity.",
    "Keep it under 400 words.",
  ].join(" ");
}

export function workingBriefUserPrompt(personName: string, blocks: readonly EvidenceBlock[]): string {
  const packed = blocks
    .filter((block) => !isWorkingBriefBlock(block))
    .map((block) =>
      `<evidence id=${JSON.stringify(block.id)} title=${JSON.stringify(block.title)}>\n${block.text}\n</evidence>`
    )
    .join("\n\n");
  return [
    `Write a standing working brief for ${personName}.`,
    "Use only these evidence blocks.",
    packed || "(No evidence blocks were retrieved.)",
  ].join("\n\n");
}
