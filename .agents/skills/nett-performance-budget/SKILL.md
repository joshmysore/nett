---
name: nett-performance-budget
description: "Keep Nett fast with thousands of people without architectural overreach. Use before and after any change to queries, list rendering, routing, data fetching, or bundle composition, and whenever an interaction feels slow."
version: 1.0.0
---

# Nett performance budget

Nett holds 1,616 people, 340k interactions, and 286k communications in a 746 MB
SQLite file today. It must stay immediate at that size without acquiring a data
layer it does not need.

## Budgets

On the local development machine, against the real dataset:

| Interaction | Budget |
| --- | --- |
| Navigation inside an already-loaded app | < 100 ms |
| Person drawer to cached or core content | < 100 ms |
| Search keystroke to visible feedback | < 50 ms |
| Search settled results | < 150 ms |
| Layout shift on a settled route | 0 |
| People rows hydrated in the browser | one page, never the dataset |
| Independent requests on a critical path | concurrent, never serial |
| Animation before a primary action responds | none |

Long-running intelligence and connector work must be cancellable and report
progress. It must never block an unrelated request.

## Measure first

Never optimise from intuition. Record the baseline, change one thing, re-measure.

```bash
node scripts/measure.mjs before
# ... change ...
node scripts/measure.mjs after
```

Measure, at minimum, whichever of these the change could plausibly move:

- rows transferred, and payload bytes
- SQLite query duration and query plan
- main-thread work and long tasks
- render counts, if a list or a frequently-updated component is involved
- bundle size delta
- the request waterfall
- time to first useful content

For SQL, read the plan before guessing:

```sql
EXPLAIN QUERY PLAN <statement>;
```

A `SCAN` over `people`, `interactions`, or `communications` on an interactive
path is a defect. So is `USE TEMP B-TREE FOR ORDER BY`.

## Prefer

Bounded SQLite queries · appropriate indexes · server-side filtering and
pagination · request cancellation via `AbortController` · debouncing chosen from
a measurement, not a habit · deferred secondary information · concurrency for
independent requests · memoisation only after a profile shows it matters ·
stable component boundaries · route-level loading · progressive content ·
lightweight dependencies.

## Avoid

Unbounded queries · missing indexes · unanchored `LIKE '%…%'` where FTS5 exists ·
N+1 queries · correlated subqueries computing values the view never renders ·
repeated identical requests · serial waterfalls of independent requests · stale
responses overwriting fresh ones · large JSON payloads · hydrating data the
browser will not render · expensive rerenders · unstable props · eager loading
of secondary features · blocking inference calls · animation on the critical
path.

## Known traps in this codebase

- **`/api/bootstrap` blocking every route.** It is convenient and it costs every
  route the same 336 ms. Route-specific data belongs in route-specific requests.
- **`refreshEvidenceIndex(personId)` inside a request handler.** It re-writes
  every communication for that person into `evidence_documents` and
  `evidence_fts`. It was the difference between a 0.7 s and a 26.6 s autofill.
- **`getPeople()`** hydrates all 1,616 people plus their tags, methods, and
  sources. It is 1.78 MB. Anything calling it on an interactive path is wrong.
- **Per-row `COUNT(*)` subqueries** in `getPeoplePage` against the 340k-row
  `interactions` table, for counts the list does not show.
- **Cold reads on the 746 MB file** cost ~745 ms once. Warm the path or defer it
  off the critical route.

## Required evidence

A before/after table with metric, baseline, final, target, method, and caveat.
If a target was not met, say so and explain why. Never report an improvement you
did not measure.

## Acceptance criteria

- Every budget above is met, or the miss is documented with a reason.
- The change is justified by a measurement, not an argument.
- No new dependency was added to solve a problem a query could solve.
