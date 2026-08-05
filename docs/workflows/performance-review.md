# Performance review

Skill: `.agents/skills/nett-performance-budget/SKILL.md`.
Never optimise from intuition.

## Budgets

| Interaction | Budget |
| --- | --- |
| Navigation in a loaded app | < 100 ms |
| Drawer to cached or core content | < 100 ms |
| Search keystroke to visible feedback | < 50 ms |
| Search settled | < 150 ms |
| Layout shift on a settled route | 0 |

## Before

- [ ] `node scripts/measure.mjs before`
- [ ] `EXPLAIN QUERY PLAN` for each query in scope. Record the plan.
- [ ] Payload bytes and row counts for each endpoint in scope:
      `curl -s -o /dev/null -w "%{time_total}s %{size_download}B\n" <url>`
- [ ] `npm run build` for the bundle baseline.

## Investigate in this order

1. **Waterfall.** Are independent requests serial? Is anything blocking a route
   that the route does not need?
2. **Payload.** How many rows crossed the wire? How many did the view render?
3. **Query.** Is there a `SCAN` on `people`, `interactions`, or `communications`?
   A `TEMP B-TREE`? A correlated subquery per row?
4. **Main thread.** Long tasks over 50 ms. What is on the stack?
5. **Render.** Only after 1–4. Profile before memoising anything.
6. **Bundle.** What landed in the initial chunk that a route could have loaded?

## Fix with

Bounded queries · indexes justified by a plan · server-side filtering and
pagination · `AbortController` on superseded requests · measured debounce values ·
deferred secondary panels · concurrency for independent requests · route-level
code splitting · stable component boundaries.

## Do not

Add a dependency to solve what a query solves · memoise before profiling · add a
cache without an invalidation story · hide latency behind an animation · claim
an improvement you did not measure.

## After

- [ ] `node scripts/measure.mjs after`
- [ ] Re-run the query plans.
- [ ] Table: metric · baseline · final · target · method · caveat · status.
- [ ] Any missed target stated plainly, with the reason.
- [ ] Remaining bottlenecks listed for the next pass.
