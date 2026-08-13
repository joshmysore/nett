/** First-person extraction of the owner's hometowns and interests.
 *
 *  Used during setup: the user speaks or types a short self-description, and
 *  Nett proposes chips they can edit before anything is stored. The transcript
 *  is kept verbatim. Nothing here writes to the database.
 *
 *  This is intentionally narrower than person-memory capture. It does not
 *  invent facts about other people, and it does not infer sensitive traits.
 */

import type { CaptureProposal } from "../../src/lib/contracts.js";

export type OwnerContextExtraction = {
  transcript: string;
  hometowns: string[];
  interests: string[];
  proposals: CaptureProposal[];
};

const INTEREST_STOP = new Set([
  "people", "her", "him", "them", "you", "it", "this", "that", "stuff", "things",
]);

function sentenceAround(text: string, index: number) {
  let start = 0;
  let end = text.length;
  for (let i = index; i > 0; i -= 1) {
    if (/[.!?\n]/u.test(text[i - 1]!)) {
      start = i;
      break;
    }
  }
  for (let i = index; i < text.length; i += 1) {
    if (/[.!?\n]/u.test(text[i]!)) {
      end = i + 1;
      break;
    }
  }
  return { text: text.slice(start, end).trim(), start, end };
}

function splitItems(raw: string): string[] {
  const text = raw.replace(/[.,;:]+$/u, "").trim();
  if (!text) return [];
  const parts = /\band\b|&/iu.test(text)
    ? text.split(/\s*(?:,\s*)?(?:\band\b|&)\s*/iu)
    : text.split(/\s*[,;]\s*/u);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const value = part.replace(/^[.,;:\s]+|[.,;:\s]+$/gu, "").replace(/\s+/gu, " ").trim();
    if (value.length < 2 || value.length > 60) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function clipHometownTail(raw: string): string {
  return raw
    .split(/\b(?:and\s+)?I(?:'m| am)?\s+(?:into|care about|like|love)\b/iu)[0]
    .split(/\bmy interests?\b/iu)[0]
    .split(/\binterests?\s*[:–-]/iu)[0]
    ?.replace(/[.,;:]+$/u, "")
    .trim() ?? "";
}

function pushList(
  proposals: CaptureProposal[],
  transcript: string,
  field: "hometown" | "interests",
  values: string[],
  match: RegExpExecArray,
  confidence: number,
) {
  if (!values.length) return;
  if (proposals.some((proposal) => proposal.field === field)) return;
  const evidence = sentenceAround(transcript, match.index);
  proposals.push({
    field,
    value: values.join(", "),
    values,
    evidence: evidence.text,
    evidenceStart: evidence.start,
    evidenceEnd: evidence.end,
    confidence,
  });
}

/** Propose hometowns and interests from a first-person transcript. */
export function extractOwnerContext(transcript: string): OwnerContextExtraction {
  const text = String(transcript ?? "");
  const proposals: CaptureProposal[] = [];

  const hometownPattern = new RegExp(
    String.raw`\b(?:I grew up in|I was raised in|I was born in|I(?:['\u2019]m| am) from|I come from|originally from|my hometowns? (?:are|is)|hometowns?\s*[:–-])\s+([^.;\n]+)`,
    "giu",
  );
  let hometownMatch = hometownPattern.exec(text);
  if (hometownMatch) {
    const values = splitItems(clipHometownTail(hometownMatch[1] ?? "")).slice(0, 6);
    pushList(proposals, text, "hometown", values, hometownMatch, 0.82);
  } else {
    hometownPattern.lastIndex = 0;
  }

  const interestPattern = new RegExp(
    String.raw`\b(?:I(?:['\u2019]m| am) into|I care about|my interests? (?:are|is)|interests?\s*[:–-])\s+([^.;\n]+)`,
    "giu",
  );
  const interestMatch = interestPattern.exec(text);
  if (interestMatch) {
    const values = splitItems(interestMatch[1] ?? "")
      .filter((item) => !INTEREST_STOP.has(item.toLocaleLowerCase()))
      .slice(0, 8);
    pushList(proposals, text, "interests", values, interestMatch, 0.8);
  }

  const hometowns = proposals.find((item) => item.field === "hometown")?.values ?? [];
  const interests = proposals.find((item) => item.field === "interests")?.values ?? [];

  return { transcript: text, hometowns, interests, proposals };
}
