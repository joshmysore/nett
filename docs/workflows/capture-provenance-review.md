# Capture and provenance review

Skill: `.agents/skills/nett-capture-and-provenance/SKILL.md`.
Run whenever free text becomes structured person data.

## Pipeline conformance

- [ ] Original transcript stored verbatim and retrievable.
- [ ] Normalisation limited to whitespace. Names, places, and spellings untouched.
- [ ] Identity detection separate from identity resolution.
- [ ] Candidate matching conservative: exact contact method → exact unique name →
      fuzzy is a suggestion only.
- [ ] Each proposed operation independently reviewable.
- [ ] Each proposal carries an evidence span. No span, no proposal.
- [ ] Confidence assigned and displayed.
- [ ] Conflicts detected and shown with the existing value.
- [ ] Preview editable in place.
- [ ] Four outcomes offered: update, create, unassigned inbox, cancel.
- [ ] Only approved operations written, in one transaction.
- [ ] Provenance recorded per accepted operation.
- [ ] Result summary shown, with undo where the write is safely reversible.

## Hard rules — verify each by testing, not by reading

- [ ] **Nothing written before approval.** Open capture, parse, close without
      approving. Assert no new rows in `people`, `memories`, `source_identities`,
      `field_provenance`, or `contact_methods`.
- [ ] **No partial writes.** Approve a subset. Assert exactly that subset landed.
- [ ] **Idempotent.** Approve the same capture twice. Assert no duplicates.
- [ ] **Ambiguity routes to review**, not to the top-scoring candidate.
- [ ] **Degrades without fabricating.** Stop Ollama. The note still saves; the UI
      says structure was unavailable; no structure is invented.
- [ ] **No sensitive-trait inference** anywhere in the extraction path.

## Suggestion object

- [ ] field or operation · proposed value · normalised value · source type ·
      source identifier · evidence · observed date · generated date ·
      confidence · conflict state · existing value · person match · provider ·
      acceptance state · rejection state
- [ ] Actions available: accept · accept with edit · reject · defer · inspect evidence
- [ ] Rejections persisted in `inference_feedback` and not re-proposed without
      new evidence.

## Privacy

- [ ] No raw audio retained by default.
- [ ] Recognition locality disclosed — the browser API may be vendor-backed.
- [ ] No transcript leaves the machine without explicit configuration.
