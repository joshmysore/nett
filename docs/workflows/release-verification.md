# Release verification

The final gate. Run in order. Do not report a command as passing that you did
not run.

## 1. Static and unit

```bash
npm run check     # tsc -b
npm test          # smoke (isolated DB + migrations) + node:test units
```

- [ ] Both pass.
- [ ] No test was weakened or skipped to get here.

## 2. Browser

```bash
npm run dev       # leave running
npm run test:e2e  # desktop + mobile projects
```

- [ ] Desktop project passes.
- [ ] Mobile project passes.
- [ ] axe reports no serious or critical violations.

## 3. Build

```bash
npm run build
```

- [ ] Succeeds.
- [ ] Bundle sizes recorded and compared to the previous release.
- [ ] `npm start` serves the production build and the app works against it.

## 4. Database

- [ ] Migrations apply cleanly to an existing database with real rows.
      Test on a copy, never on `data/nett.db`.
- [ ] `schema_migrations` matches `latestSchemaVersion`.
- [ ] A `VACUUM INTO` backup was produced if the version advanced.
- [ ] Existing people, memories, provenance, and imports are intact.
- [ ] Accepted and rejected suggestion history preserved.

## 5. Measurement

```bash
node scripts/measure.mjs final
```

- [ ] `docs/audits/nett-final.md` updated with a before/after table.
- [ ] Budgets met, or each miss stated with a reason.
- [ ] No invented numbers.

## 6. Manual walkthrough

Clean session. Light **and** dark.

- [ ] Load the app; land somewhere useful.
- [ ] Find a person by name. Find one by company. Find one by memory.
- [ ] Apply a filter, reload the page — state survives.
- [ ] Paginate, then use browser Back.
- [ ] Open the drawer, then the full profile.
- [ ] Edit a common field without opening a long form.
- [ ] Capture a memory from anywhere; approve part of it; confirm only that part landed.
- [ ] Stop Ollama; repeat capture and autofill; confirm both degrade clearly.
- [ ] 320 px and 375 px: no horizontal overflow anywhere.
- [ ] Keyboard-only pass across the primary flows.

## 7. Privacy

- [ ] Nothing new leaves the machine by default.
- [ ] Optional providers still disabled by default.
- [ ] Apple Contacts and Messages still read-only.
- [ ] No LinkedIn scraping path exists.
- [ ] No raw audio retained.

## 8. Honesty

- [ ] Unresolved limitations documented.
- [ ] No claim made for unimplemented or unverified work.
