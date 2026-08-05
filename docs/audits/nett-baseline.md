# Nett baseline measurements

Recorded before any change in this overhaul. Every number here was produced by
running the application against the real local database. Nothing is estimated.

## Environment

| Item | Value |
| --- | --- |
| Machine | Apple Silicon macOS (darwin 25.2.0), developer workstation |
| Node | v25.9.0 |
| Runtime mode | Vite dev server (`npm run dev`) unless a row says production |
| Client | Playwright Chromium 1.61.1, default CPU/network (no throttling) |
| Database | `data/nett.db`, 746 MB, schema version 6 |
| Ollama | Running, `llama3.2:1b` and `llama3.2:3b` installed |

Caveats that matter when comparing numbers:

- Dev-mode figures include Vite's on-demand module transform, which inflates
  first-load times relative to production. Production build figures are
  measured separately and labelled.
- The machine was not otherwise idle-locked. Medians of five samples are used
  and the first (cold) sample is retained in the raw JSON rather than discarded.
- Ollama timings depend on model load state. The first autofill call in a
  session pays model load cost; the samples below include that.

## Dataset size

| Table | Rows |
| --- | --- |
| `people` | 1,616 |
| `nett_metadata` | 1,616 |
| `communications` | 285,818 |
| `communication_people` | 340,694 |
| `interactions` | 340,694 |
| `source_records` | 287,588 |
| `source_identities` | 3,805 |
| `contact_methods` | 1,719 |
| `field_provenance` | 1,131 |
| `evidence_documents` | 25,204 |
| `imported_rows` | 537 |
| `merge_suggestions` | 462 |
| `memories` | 2 |
| `contact_tags` | 0 |

## Commands used

```bash
# API timings (5 samples each, median reported)
/tmp/bench.sh                      # curl -w "%{time_total}" against 127.0.0.1:4174

# Browser timings, layout shift, long tasks, overflow, screenshots
node scripts/measure.mjs baseline   # writes docs/audits/baseline.json

# Verification baseline
npm run check
npm test
```

## API latency and payload size

Measured with `curl` against the local Express server, five samples, median.

| Endpoint | Median | Payload | Note |
| --- | --- | --- | --- |
| `GET /api/bootstrap` | **336 ms** | **337 KB** | Blocks every route; hydrates 249 people |
| `GET /api/people` | 52 ms | **1.78 MB** | Full-dataset hydration endpoint |
| `GET /api/people/page` (all, page 1) | 5.4 ms | 55 KB | Already server-paginated |
| `GET /api/people/page?q=an` | 4.5 ms | 55 KB | 13-column `LIKE '%…%'` scan |
| `GET /api/people/page?q=maria` | 2.6 ms | 5.5 KB | |
| `GET /api/people/page?filter=cold` | 5.7 ms | 56 KB | |
| `GET /api/people/page?filter=due` | 0.8 ms | 43 B | Zero results in this dataset |
| `GET /api/search?q=an` | 2.6 ms | 14 KB | Fuse index rebuilt from all 1,616 rows on revision change |
| `GET /api/people/:id` | 1.4–1.9 ms | 1.3–32.6 KB | Returns all memories, 40 interactions, all provenance |
| `GET /api/people/:id/communications` | 745 ms cold / 12 ms warm | 30 B–52 KB | Cold page-cache cost on the 746 MB file |
| `GET /api/people/:id/signals` | 1.5–31 ms | ~320 B | |
| `POST /api/people/:id/autofill` | **0.7 s / 8.5 s / 26.6 s** | 18 B–1.4 KB | Three different people; not cancellable |
| `GET /api/intelligence/status` | 72 ms | — | Ollama reachable |

Autofill without Ollama was not measured separately at baseline; the code path
falls back to `autofillSuggestions` deterministically, but the call still runs
`refreshEvidenceIndex(personId)` first, which is the dominant cost for people
with many communications.

## Browser latency

From `docs/audits/baseline.json`. Dev server. Median of five, samples in the JSON.

| Metric | Median | Target |
| --- | --- | --- |
| Cold app load to first heading | 833 ms | — |
| People rows transferred by `/api/bootstrap` | 249 rows | 0 for routes that do not need them |
| Loaded route navigation, dashboard to first people row | 58 ms | < 100 ms ✅ |
| People route cold load to first row | **1,333 ms** | — |
| Profile route cold load to name visible | **1,336 ms** | < 100 ms to first useful content |
| Person drawer open to first useful content | **839 ms** | < 100 ms |
| Search keystroke to visible feedback | **0.7 ms** | < 50 ms ✅ |
| Search keystroke to settled results | **270 ms** | < 150 ms |
| Cumulative layout shift on People | 0 | 0 ✅ |
| Long tasks over 50 ms on People | 1 (52 ms) | — |

Search settle is dominated by a fixed 180 ms debounce in `PeoplePage.tsx` plus
the request; the server work itself is 4–5 ms.

## Horizontal overflow

Measured as `documentElement.scrollWidth - clientWidth` across 7 viewports ×
2 colour schemes × 3 routes.

| Viewport | Route | Overflow |
| --- | --- | --- |
| 375 × 812 | `/settings/connectors` | **23 px** |
| 320 × 700 | `/settings/connectors` | **78 px** |

Dashboard and People had no overflow at any tested width.

## Bundle size

Not measured at baseline. `npm run build` output sizes are recorded in
`nett-final.md` for both the baseline commit and the final commit so the
comparison is like-for-like.

## Verification baseline

| Command | Result |
| --- | --- |
| `npm run check` | passes |
| `npm test` | passes (6 unit tests + smoke) |
| `npm run test:e2e` | not run at baseline (requires a running dev server) |

## Observed bottlenecks

1. **`/api/bootstrap` is a blocking gate.** `App.tsx` renders `AppSkeleton`
   until bootstrap resolves, so every route pays 336 ms and 337 KB before any
   route-specific request starts. People and Profile then add a lazy chunk load
   and their own fetch, producing a three-step serial waterfall and the 1.3 s
   figures above.
2. **Autofill re-indexes evidence synchronously.** `intelligentAutofill` calls
   `refreshEvidenceIndex(personId)`, which re-reads and re-writes every
   communication row for that person into `evidence_documents` and
   `evidence_fts` before the Ollama call begins. This is the 8.5 s and 26.6 s
   above, and it happens inside a request with no cancellation.
3. **Search uses 13 unanchored `LIKE '%…%'` predicates** plus two correlated
   `EXISTS` subqueries. Fast at 1,616 people, but it cannot use any index and
   will degrade linearly. `evidence_fts` already exists and is unused by search.
4. **`getPeoplePage` runs two correlated `COUNT(*)` subqueries per row** against
   `memories` and the 340,694-row `interactions` table, for values the People
   list does not display.
5. **`/api/people` returns 1.78 MB** and `/api/search` rebuilds a Fuse index over
   every person whenever any person, metadata row, memory, or tag changes.
6. **Cold communications read costs 745 ms** on the 746 MB database, on the
   critical path of the profile route.

## Observed visual-system drift

Compared against `design.md`, which is the locked source of truth.

1. **Light mode does not exist.** `src/index.css` hardcodes
   `color-scheme: dark` and defines only dark values. The `light-*.png` and
   `dark-*.png` baseline screenshots are pixel-identical. `design.md` locks a
   full light palette that is unimplemented, and `playwright.config.ts` pins
   `colorScheme: "dark"` to avoid the gap.
2. **The accent is purple, not the locked blue.** `design.md` specifies
   `--color-accent: oklch(72% 0.14 250)`. `src/index.css` contains 30+
   hardcoded `rgba(156,122,232,…)` values — a lavender roughly
   `oklch(63% 0.17 300)` — on AI panels, autofill controls, file drop zones,
   timeline markers, connector icons, and selection states.
3. **Token names do not match `design.md`.** The CSS uses `--bg`, `--surface`,
   `--line`, `--text`; `design.md` locks `--color-paper`, `--color-surface`,
   `--color-rule`, `--color-ink`. Nothing enforces the mapping.
4. **Glass and blur are in use** despite being banned: `backdrop-filter: blur()`
   on `.drawer-layer`, `.modal-layer`, `.top-bar`, `.toast`, `.mobile-nav`, and
   a `.glass-panel` class applied on five pages.
5. **Type is below the floor.** `design.md` bans text under 12 px.
   `src/index.css` ships `font-size: 7px` on `.suggestion-diff small`, plus
   many 10 px and 11 px rules, and a global `small { font-size: 13px !important }`
   patch fighting them.
6. **The CSS is append-only.** Three override blocks — "Phase 5 relationship
   console", "Evidence workbench foundation", "Local owner setup" — restate and
   partially reverse earlier rules in the same file.
7. **App pages read as marketing pages.** The People route leads with a 42 px
   "Find anyone without scanning." headline, an uppercase `PEOPLE` kicker, and a
   42 px vanity count, above a list where nearly every row reads "Location not
   recorded / Industry not recorded / Unclassified / No contact recorded".
8. **The dashboard shows metrics that are not answers.** "WARMTH 0",
   "WITH CONTEXT 1%", "TOP CLUSTERS 2", and a "Location opportunities" panel
   whose largest entry is "Unknown — 1,593 people".

## Artefacts

- `docs/audits/baseline.json` — raw metrics and per-sample values
- `docs/audits/baseline-screens/` — 42 screenshots, 7 viewports × 2 schemes × 3 routes
- `scripts/measure.mjs` — the measurement script, re-runnable with a different label
