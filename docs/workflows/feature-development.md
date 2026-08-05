# Feature development

The standard sequence for any Nett feature. Work top to bottom. Each step has a
completion condition — do not carry an unfinished step forward.

## 1. Reconnaissance

- [ ] Read `AGENTS.md`.
- [ ] Read the files you expect to change, completely.
- [ ] `git status` — do not overwrite unrelated uncommitted work.
- [ ] Identify existing routes, tables, and primitives you can reuse.

**Done when** you can name the exact files you will modify or create.

## 2. User job

Run `.agents/skills/nett-product-workflow/SKILL.md`.

- [ ] Job, trigger, shortest path, interaction count.
- [ ] What is inferable from owned evidence; what needs confirmation.
- [ ] Three approaches; two mediocre ones rejected in writing.
- [ ] All states defined: first-use, normal, empty, loading, failure, conflict, recovery.
- [ ] One approach chosen and justified.

**Done when** the ten answers are written down.

## 3. Baseline measurement

Run `.agents/skills/nett-performance-budget/SKILL.md`.

- [ ] `node scripts/measure.mjs before` if the change touches UI or data flow.
- [ ] `EXPLAIN QUERY PLAN` on any query you intend to change.
- [ ] Note current payload sizes and bundle size if relevant.

**Done when** the numbers exist. Skipping this makes step 10 impossible.

## 4. Risk and privacy review

- [ ] Does anything cross the machine boundary? Is it off by default?
- [ ] Does anything write a structured fact? Is it reviewed first?
- [ ] Does anything touch imported or manually entered evidence?
- [ ] Does a migration touch an existing table? Is it append-only?
- [ ] Could this infer a sensitive trait? Remove the path entirely if so.

**Done when** each answer is either "no" or "yes, and here is the safeguard".

## 5. Smallest cohesive implementation

- [ ] Shared primitives and tokens, not local restyling.
- [ ] Server does the filtering, counting, and sorting.
- [ ] Cancellation on any request a user can supersede.
- [ ] `.agents/skills/nett-dependency-gate/SKILL.md` before any `npm install`.

**Done when** the feature works and nothing extra was built.

## 6. Tests

- [ ] Unit or integration coverage for the new logic.
- [ ] Migration coverage against an isolated `NETT_DB_PATH`.
- [ ] Idempotency coverage if it writes.
- [ ] Synthetic fixtures only. Never commit real personal data.

## 7. Browser verification

Run `.agents/skills/nett-browser-qa/SKILL.md`. This is a gate, not a formality.

- [ ] Clean session, desktop and mobile widths, light and dark.
- [ ] Keyboard-only pass.
- [ ] Forced failures: slow request, failed request, Ollama down, permission denied.
- [ ] Screenshots opened and looked at.
- [ ] Every defect found is fixed or recorded.

## 8. Accessibility

Run `.agents/skills/nett-accessibility-interaction/SKILL.md`.

- [ ] No serious or critical axe violations.
- [ ] Manual tab-through completed.
- [ ] Zero horizontal overflow at 320, 375, 414, 768 px.
- [ ] Dialog focus trapped and restored.

## 9. Visual review

Run `.agents/skills/nett-visual-direction/SKILL.md`.

- [ ] No contradiction with `design.md`.
- [ ] Light and dark both correct and different.
- [ ] The six critique questions answered.

## 10. Performance measurement

- [ ] `node scripts/measure.mjs after`.
- [ ] Before/after table with method and caveat.
- [ ] Budgets met, or misses explained.

## 11. Independent review

Run `.agents/skills/nett-feature-review/SKILL.md`, in a fresh context.

- [ ] Blockers fixed.
- [ ] Concerns fixed or recorded.

## 12. Diff and regression review

- [ ] `git diff` read in full. No unrelated rewrites, no dead experiments.
- [ ] `npm run check && npm test && npm run test:e2e && npm run build`.
- [ ] Existing routes and deep links still work.

## 13. Documentation

- [ ] `README.md` if user-facing behaviour changed.
- [ ] `AGENTS.md` if a durable invariant changed.
- [ ] `design.md` if the visual system was deliberately extended.
- [ ] `docs/audits/` for the measurements.
- [ ] Unresolved limitations stated honestly.
