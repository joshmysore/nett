---
name: nett-import-safety
description: "Build safe, idempotent, provenance-preserving imports for Nett. Use when working on LinkedIn archives, CSV or spreadsheet import, Apple Contacts, user-owned exports, pasted profile text, duplicate detection, or the merge review queue."
version: 1.0.0
---

# Nett import safety

An import touches every person at once. A bad one is the most destructive thing
that can happen to this database, and the least visible.

## Sources Nett supports

Official LinkedIn "Download your data" archives · CSV and spreadsheet files ·
Apple Contacts · other user-owned exports · profile text the user pastes.

## Prohibited, without exception

LinkedIn scraping · browser automation of LinkedIn · reuse of LinkedIn cookies
or session tokens · circumventing any access control · third-party bulk-profile
datasets · inferring a fact from a profile URL beyond canonicalising the URL
itself.

## Rules

### Preserve the raw

Every source row is written to `imported_rows` with its raw JSON before any
interpretation. An import you cannot reconstruct is an import you cannot audit.
Record the run in `imports` with filename, file hash, row count, and status.

### Be idempotent

- Same file twice → the second run is a no-op that reports itself as a duplicate.
  Key on the SHA-256 of the file bytes.
- Same logical row twice → key on a content hash of the canonicalised row.
- Re-import after a partial failure must converge, not duplicate.

Test this explicitly. Import a fixture twice and assert the person count,
`contact_methods` count, and `memories` count are identical after the second run.

### Match conservatively

In descending order of trust:

1. exact normalised email
2. exact normalised E.164 phone
3. normalised profile URL
4. a single exact unique name that is unique **in the file as well as in the
   database**
5. anything else → **review queue**

A fuzzy name match is a *suggestion for a human*, never an automatic merge.
Ambiguity — two candidates in the database, or a duplicated name within the
file — always routes to review.

### Never clobber

- Fill blank fields.
- Union list fields (`languages`, `skills`, `interests`, `institutions`,
  `mutuals`).
- For a scalar field that already has a different value: record a **conflict**
  and keep the existing value. Do not overwrite, do not silently drop.
- Store `previous_values_json` on the imported row so the change is reversible.

### Assume nothing about what an archive contains

A LinkedIn Connections export realistically carries: first name, last name,
profile URL, email where the connection shared it, company, position, and
connection date.

It does **not** carry location, languages, education, hometown, interests, or
personal details. Do not create fields for them, do not infer them, and do not
present the import as though it supplied them.

### Migration and rollback

Schema changes for an import feature follow the normal rules in `AGENTS.md`:
append-only, transactional, backed up by `VACUUM INTO`. If an import can be
rolled back, the rollback must be tested; if it cannot, say so in the UI before
the user commits.

## Required tests

- Parsing a realistic fixture archive, including a UTF-8 BOM and quoted commas.
- Re-import idempotency, asserted on row counts.
- Exact-email match, exact-URL match, and unique-name match each linking correctly.
- An ambiguous name routing to review rather than merging.
- A conflicting scalar preserving the existing value and recording the conflict.
- Raw rows present in `imported_rows` after every path, including failures.

Fixtures must be synthetic. **Never commit real personal data.**

## Acceptance criteria

- Raw rows preserved, import run recorded.
- Second run of the same file changes nothing.
- No automatic merge above the trust threshold.
- No existing value overwritten without an explicit conflict record.
- Provenance written for every accepted field.
- The UI states the archive's real limitations.
