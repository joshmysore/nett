---
name: nett-capture-and-provenance
description: "Implement safe natural-language capture and suggestion approval in Nett. Use when building or changing capture, memory parsing, dictation intake, suggestion review, autofill acceptance, or anything that turns free text into structured person data."
version: 1.0.0
---

# Nett capture and provenance

Capture is where Nett is most useful and most dangerous. A wrong extraction that
writes silently corrupts a profile the user trusts. The rule is simple: **the
user's words are the record; structure is a proposal.**

## Pipeline

Every capture path — typed, pasted, imported, dictated — follows the same shape.

1. **Transcript first.** Store the user's original text verbatim. It is the
   evidence. Never discard it in favour of the parse.
2. **Normalise carefully.** Whitespace and obvious typos only. Do not
   "correct" names, places, or spellings — multilingual and transliterated names
   are the common case, not the exception.
3. **Detect likely identity.** Extract the name-shaped spans.
4. **Find candidate matches conservatively.** Exact contact method beats exact
   unique name beats fuzzy name. Ambiguity is a result, not a problem to resolve
   by picking the top score.
5. **Extract proposed operations**, each one independently reviewable.
6. **Attach evidence spans.** Every proposal cites the substring it came from.
   A proposal without a span is not a proposal, it is a guess — drop it.
7. **Assign confidence**, and show it.
8. **Flag conflicts** against existing values. Show old and new side by side.
9. **Show an editable preview.** Every proposed value can be corrected in place
   before it is accepted.
10. **Offer four outcomes**: update an existing person, create a new person,
    file to the unassigned inbox, or cancel.
11. **Write only what was approved.** Nothing else.
12. **Record provenance** for each accepted operation.
13. **Show a concise result** and an undo or recovery path where the write is
    safely reversible.

## Hard rules

- **No database write before approval.** Not a draft row, not a "temporary"
  person, not a placeholder identity.
- **No silent partial writes.** If three of five operations are approved, write
  exactly three, in one transaction, and say so.
- **No hidden automatic writes.** A capture never updates a profile as a side
  effect of being parsed.
- **Idempotency.** Re-approving the same capture must not duplicate memories,
  tags, or identities. Key on a content hash.
- **Ambiguity routes to review.** When identity is uncertain, prefer the
  unassigned inbox over a confident wrong link.
- **Degradation without fabrication.** If extraction is unavailable — Ollama
  down, model missing, parse failed — retain the note verbatim and say that
  structure was not available. Never synthesise structure to fill the gap.
- **No sensitive-trait inference.** Health, sexuality, religion, political
  belief, ethnicity. Not from text, not from names, not from locations.

## Suggestion shape

A suggestion is a reviewable evidence object. It carries:

field or operation · proposed value · normalised value where applicable ·
source type · source identifier · evidence excerpt or structured evidence ·
observed date · generated date · confidence · conflict state · existing value ·
person match · provider, if any · acceptance state · rejection state.

Supported actions: **accept**, **accept with edit**, **reject**, **defer**,
**inspect evidence**.

Rejections are retained in `inference_feedback`. They are signal for local
ranking, not garbage. Never delete them, and never re-propose an identical
rejected suggestion without new evidence.

## What capture should be able to propose

From a sentence like *"Met Ana in Lisbon through Maya. She works in climate
finance, speaks Portuguese, Spanish and English, grew up in Porto, and I should
follow up in September about the Berlin conference"* — matched or new person,
current location, hometown, industry, languages, relationship context, how/where/
when met, mutual connections, the memory itself, a follow-up date, and supported
tags. Each one separately reviewable, each citing its span.

## Acceptance criteria

- The original transcript is stored and retrievable.
- Every proposal has an evidence span and a confidence.
- Nothing is written until the user approves it.
- Conflicts are visible before acceptance, not discovered afterwards.
- Re-running the same capture changes nothing.
- Provenance exists for every accepted fact.
- With inference unavailable, the note still saves and the UI says why structure
  is missing.
