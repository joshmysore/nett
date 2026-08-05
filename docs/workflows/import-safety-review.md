# Import safety review

Skill: `.agents/skills/nett-import-safety/SKILL.md`.
Run for any change to LinkedIn archives, CSV/spreadsheet import, Apple Contacts,
pasted profile text, matching, or the merge queue.

## Legality and consent

- [ ] Source is user-authorised: their own export, or text they pasted.
- [ ] No scraping, no browser automation, no cookie reuse, no access-control
      circumvention, no third-party bulk-profile datasets.
- [ ] No fact inferred from a profile URL beyond canonicalising the URL.
- [ ] The UI states what the archive actually contains — and what it does not.

## Raw preservation

- [ ] Every source row written to `imported_rows` with raw JSON, before
      interpretation.
- [ ] Run recorded in `imports`: filename, file hash, row count, status.
- [ ] Failure paths still preserve the raw rows.

## Idempotency — assert, do not assume

- [ ] Same file twice → reported as duplicate, no writes.
- [ ] Same logical row twice → content hash prevents duplication.
- [ ] Test: import a fixture twice; assert identical counts in `people`,
      `contact_methods`, `memories`, and `source_identities`.

## Matching

- [ ] Trust order enforced: exact email → exact E.164 phone → normalised URL →
      unique exact name (unique in file *and* database) → review.
- [ ] Fuzzy matches never merge automatically.
- [ ] Duplicate name within the file routes to review.
- [ ] Two database candidates route to review.

## Non-destructive writes

- [ ] Blank fields filled.
- [ ] List fields unioned.
- [ ] Conflicting scalars keep the existing value and record a conflict.
- [ ] `previous_values_json` recorded.

## Schema

- [ ] Migration appended, never edited or renumbered.
- [ ] `latestSchemaVersion` bumped.
- [ ] New columns nullable or defaulted.
- [ ] Tested against an isolated `NETT_DB_PATH`.
- [ ] `VACUUM INTO` backup path still intact.

## Tests

- [ ] Realistic synthetic fixture, including BOM and quoted commas.
- [ ] Re-import idempotency.
- [ ] Each match path.
- [ ] Ambiguity → review.
- [ ] Conflict preservation.
- [ ] **No real personal data committed.**
