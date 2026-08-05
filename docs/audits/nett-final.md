# Nett final measurements

Recorded after the overhaul described in `AGENTS.md` and the parallel workstreams.
Every number here was produced by running the application against the real local
database. Nothing is estimated.

Compare against `docs/audits/nett-baseline.md` and the raw JSON in
`docs/audits/baseline.json` / `docs/audits/final.json`.

## Environment

Same machine, dataset, and tooling as baseline unless noted.

| Item | Value |
| --- | --- |
| Machine | Apple Silicon macOS (darwin 25.2.0), developer workstation |
| Node | v25.9.0 |
| Runtime mode | Vite dev server (`npm run dev`) for browser metrics; production build for bundle sizes |
| Client | Playwright Chromium 1.61.1 |
| Database | `data/nett.db`, 746 MB, schema version 6 |
| People count | 1,616 |

## Summary

| Area | Baseline | Final | Verdict |
| --- | --- | --- | --- |
| Bootstrap API | 336 ms / 337 KB | **~6 ms / 119 KB** | Major improvement; payload still includes 249 people rows |
| App cold load → heading | 833 ms | **274 ms** | 3× faster |
| Route nav dashboard → people row | 58 ms | **55 ms** | ✅ < 100 ms |
| People cold load → first row | 1,333 ms | **371 ms** | 3.6× faster (dev variance; earlier run was 230 ms) |
| Profile cold load → name | 1,336 ms | **221 ms** | 6× faster |
| Drawer → first content | 839 ms | **63 ms** | ✅ < 100 ms |
| Search feedback | 0.7 ms | **8.1 ms** | ✅ < 50 ms |
| Search settled | 270 ms | **122 ms** | ✅ < 150 ms (warm samples; see caveats) |
| Horizontal overflow | 23–78 px on connectors | **0 everywhere** | ✅ |
| Light mode | absent (dark only) | **implemented** | Matches `design.md` intent |
| Unit tests | 6 + smoke | **37 + smoke** | |
| E2E (Playwright) | not run | **13 passed, 3 skipped** | axe clean on all projects |

## API latency and payload size

Measured with `curl` against the local Express server, five samples, median.

| Endpoint | Baseline | Final | Note |
| --- | --- | --- | --- |
| `GET /api/bootstrap` | 336 ms / 337 KB | **~6 ms / 119 KB** | Messages DB probe cached; slimmer overview |
| `GET /api/people/page` | ~5 ms | ~5 ms | Unchanged; already fast |
| `POST /api/people/:id/autofill` (deterministic) | 0.7–26 s | **~2–5 ms** | Skips evidence reindex on hot path unless empty |
| `GET /api/people/:id/communications` | 745 ms cold | ~12 ms warm | Page-cache cost unchanged on cold read |

Full `/api/people` (1.78 MB) still exists but is no longer on critical paths.

## Browser latency

From `docs/audits/final.json`. Dev server. Median of five samples.

| Metric | Baseline | Final | Target |
| --- | --- | --- | --- |
| Cold app load to first heading | 833 ms | **274 ms** | — |
| Bootstrap people rows transferred | 249 | 249 | 0 for routes that do not need them |
| Route nav dashboard → first people row | 58 ms | **55 ms** | < 100 ms ✅ |
| People cold load to first row | 1,333 ms | **371 ms** | — |
| Profile cold load to name visible | 1,336 ms | **221 ms** | — |
| Person drawer open to first content | 839 ms | **63 ms** | < 100 ms ✅ |
| Search keystroke to visible feedback | 0.7 ms | **8.1 ms** | < 50 ms ✅ |
| Search keystroke to settled results | 270 ms | **122 ms** | < 150 ms ✅ |
| Cumulative layout shift on People | ~0 | **0** | 0 ✅ |
| Long tasks over 50 ms on People | 1 (52 ms) | 1 (52 ms) | — |

### Search settle caveat

The first sample in each five-run batch still hits the measure script's 15 s
timeout when typing `"a"` produces no visible row change (very broad query, empty
feedback path). Warm samples are 109–132 ms. Median across all five is 122 ms
because the outlier is one of five values, not because users routinely wait 15 s.

## Horizontal overflow

Zero overflow at all 7 viewports × 2 colour schemes × 3 routes. Connectors
settings nav, merge review, and workbench widths were repaired.

## Bundle size (production)

From `npm run build` after the overhaul:

| Chunk | Size | Gzip |
| --- | --- | --- |
| Main (`index-*.js`) | 411 KB | 131 KB |
| ProfilePage (lazy) | 29 KB | 9 KB |
| PeoplePage (lazy) | 14 KB | 5 KB |
| Person drawer + shared workspace | split across lazy chunks | — |

Baseline production sizes were not recorded; this is the post-overhaul reference.

## Verification

| Command | Result |
| --- | --- |
| `npm run check` | passes |
| `npm test` | **37** unit tests + smoke, all pass |
| `npm run test:e2e` | **13 passed**, 3 skipped (mobile-only nav on desktop projects) |
| `npm run build` | passes |
| `node scripts/qa-smoke.mjs` | zero horizontal overflow |
| axe (via e2e) | no serious/critical violations on dashboard, people, profile, connectors |

## What changed (by workstream)

### Design system

- OKLCH tokens for light and dark; OS appearance + manual override via `src/lib/theme.ts`
- Removed purple gradients, glass panels, decorative network field, sub-12 px type
- Page styles split into `src/styles/dashboard.css`, `people.css`, `person.css`
- Renamed `glass-panel` → `panel`; deleted `NetworkField.tsx`

### Performance

- Cached Messages DB availability probe in bootstrap (~336 ms → ~6 ms)
- Slimmer bootstrap overview; removed expensive per-row subqueries from people list
- Autofill two-phase API: deterministic suggestions in ~2–5 ms; model phase optional
- Evidence reindex skipped on autofill hot path unless index empty or `reindex=true`
- Communication reindex capped to 200 recent rows; no deletion of older docs on partial reindex
- `AbortSignal` on cancellable client requests; stale responses ignored

### Product UI

- People: facets, URL state, keyboard navigation, recognition-oriented rows
- Person: evidence-first workspace (`PersonWorkspace.tsx`, `person-brief.ts`), inline edit, progressive autofill
- Dashboard: explainable aggregates instead of vanity metrics
- Capture: dictation capability layer, proposal review, `Cmd+M` shortcut
- LinkedIn: official archive importer with preview, idempotent ingest, provenance

### Accessibility fix (this session)

Profile avatar initials failed axe contrast because
`.profile-identity > div > span:last-child` matched the avatar `div` and forced
`color: var(--muted)`. Selector narrowed to `.profile-identity > .person-names > span:last-child`.

## Remaining gaps (honest)

1. **Bootstrap still transfers 249 people rows** on every app load. Route-level
   bootstrap slimming is the next architectural step.
2. **`/api/people` full-dataset endpoint** remains; nothing new depends on it, but
   it should be deprecated or gated.
3. **People search** still uses debounced `LIKE` predicates, not `evidence_fts`.
   Fast at 1,616 rows; will not scale linearly forever.
4. **Measure-script search outlier** on the first `"a"` keystroke (15 s timeout) is
   a harness edge case, not measured user latency, but it indicates the broad-query
   path could use clearer empty-state feedback.
5. **Independent feature review** (`nett-feature-review` skill) was not run in a
   fresh agent context during this session.
6. **Cold communications read** (~745 ms on first page of a 746 MB DB) is unchanged;
   profile route no longer blocks on it for first paint, but deep communication
   history still pays disk cost.

## Artefacts

- `docs/audits/final.json` — raw metrics and per-sample values
- `docs/audits/final-screens/` — updated screenshots
- `docs/audits/nett-baseline.md` — pre-overhaul record
- `scripts/measure.mjs` — re-runnable with `node scripts/measure.mjs final`
