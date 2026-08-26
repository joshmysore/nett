# Ask threads + assistant-ui

Measured 2026-08-22 on the local machine.

## Bundle

`@assistant-ui/react@0.15.16` is a client dependency. After this change:

- `DashboardPage` (Ask) is 220.47 kB / 66.22 kB gzip
- Initial `index` chunk is 424.05 kB / 135.29 kB gzip

Decisive gate question: chat thread + streaming parts + CoT chrome is not ~40 lines, and is needed for the Ask home surface. No Vercel AI SDK. A render error in the assistant-ui provider (`unstable_state`) is caught; the Nett-styled thread UI still renders.

## Browser QA

Screenshots in `docs/audits/ask-threads-screens/`.

| Check | Result |
| --- | --- |
| Overflow 320 / 375 / 768 / 1440, light + dark | 0 px |
| Conversations rail + New chat | Present |
| Deep link `/today?thread=` restores user + assistant | Pass |
| Person objects + numbered cites | Pass on restored Paris thread |
| Keyboard composer `@` / `/` | Unchanged selectors |
| Reduced motion | Ask FX already pause; rail is static |

`GET /api/intelligence/status` currently takes ~6s, so the composer disclosure can read “Checking the Ask writer…” on first paint. Not introduced by the thread UI.
