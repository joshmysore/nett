# AGENTS.md — Nett

Durable instructions for agents working in this repository. Read this before
editing. It records what is true and must stay true, not what any one task asks
for.

## What Nett is

A local-first personal relationship system for one person on one Mac. Its job is
**recognition and retrieval**: find a person, understand why they matter, update
them, and never lose the evidence that produced a fact. It is not a CRM, not a
sales tool, and not a dashboard.

Information priority, in order. Do not give every field equal weight.

1. identity → 2. why this person matters → 3. relationship/context →
4. role/company → 5. location → 6. languages → 7. last contact →
8. follow-up → 9. next action → 10. provenance and secondary metadata

## Non-negotiable invariants

### Privacy and local-first

- Everything runs on the user's Mac. No account, no cloud sync, no telemetry.
- Ollama is reachable on loopback only. Remote hosts are rejected in
  `server/intelligence/ollama.ts` unless a developer explicitly enables them.
- Apple Contacts and Messages are **read-only**. Never write to them.
- Never transmit private notes, messages, contacts, or address-book data to any
  external service without explicit user configuration and per-use approval.
- Optional enrichment providers are disabled by default, require user-supplied
  credentials, must disclose exactly what leaves the machine, and must record
  provider, timestamp, inputs, confidence, and evidence.

### LinkedIn

Only user-authorised paths are permitted:

- the user's own official "Download your data" archive, and
- public profile text the user pastes themselves.

Never scrape, never automate the site or login, never reuse browser cookies,
never bypass access controls, never use third-party bulk-profile datasets, and
never infer a fact from a profile URL alone beyond canonicalising the URL.

### Data and provenance

- `people` is canonical. Connector-specific identities live in
  `source_identities`, raw payloads in `source_records`, exact emails and phones
  in `contact_methods`, and field-level attribution in `field_provenance`.
- Every accepted fact must be traceable to stored evidence. Suggestions are
  reviewable objects, never automatic writes.
- Never silently overwrite imported or manually entered evidence. Prefer
  conflict detection over clobbering.
- Preserve raw import rows in `imported_rows`; imports must be idempotent by
  file hash and content hash.
- Keep both accepted **and rejected** suggestion history — rejections feed local
  ranking (`inference_feedback`).
- Never infer sensitive or protected traits: health, sexuality, religion,
  political belief, ethnicity, or similar. Absence of evidence is not evidence.

### Files and data that must not be destroyed

- `data/nett.db`, its `-wal`/`-shm` siblings, and any `nett.db.backup-*.sqlite`.
- `data/imports/`.
- `design.md` is the locked visual source of truth. Extend it deliberately;
  never contradict it in CSS.

## Database and migrations

- Migrations live in `server/migrations.ts` as an append-only numbered list and
  run transactionally at startup. Bump `latestSchemaVersion` with each addition.
- **Never edit or renumber an applied migration.** Add a new one.
- `openDatabase` takes a `VACUUM INTO` backup before applying a newer schema to
  an existing database. Do not remove that.
- New columns must be nullable or have defaults. Existing rows must keep working.
- Test migrations against an isolated database: `NETT_DB_PATH=/tmp/x.db`.
  `server/smoke.ts` does this; extend it rather than testing against real data.

## Commands

```bash
npm run dev        # Express API on :4174 + Vite on :5173
npm run check      # tsc -b, the typecheck gate
npm test           # smoke (isolated DB + migrations) + node:test unit tests
npm run test:e2e   # Playwright; needs `npm run dev` already running
npm run build      # tsc -b && vite build
npm start          # production server on :4174

node scripts/measure.mjs <label>   # browser latency, CLS, overflow, screenshots
```

`npm run test:e2e` does **not** start the dev server. Start it first.

## Design system

`design.md` is the source of truth. `src/index.css` implements it.

- Tokens are OKLCH and defined once, in both light and dark. Nett follows the OS
  appearance; a page never mixes modes.
- Geist for interface type. JetBrains Mono only for genuinely tabular or
  source-oriented values (dates, counts, identifiers) — never for body copy or
  section labels.
- Body 16 px, controls 14–15 px, secondary metadata 12–13 px.
  **Nothing below 12 px.**
- One containment layer. No card inside a card. Prefer dividers and whitespace
  over borders, and alignment over containers.
- Accent is a signal — focus, selection, links, small status marks — never a
  surface fill or a decorative wash.
- Banned by `design.md` and enforced here: purple/lavender gradients, glow
  halos, `backdrop-filter` glass panels, gradient text, animated backgrounds,
  uppercase eyebrows on every section, equal three-card feature rows, invented
  metrics, and uncited model output.
- Add new styles by extending the token and primitive layer. Do **not** append
  another override block to the bottom of `src/index.css`; the file has been
  corrupted that way before.

## Component and route conventions

- Routes: `/` dashboard, `/people`, `/people/:id`, `/settings/connectors`,
  `/setup`. `/connectors` and `/settings` redirect. **These are deep links —
  preserve them and their query parameters.**
- People list state (`q`, `filter`, `page`, `view`, facet params) lives in the
  URL, not in component state. Deep links must survive reload and back/forward.
- Pages are lazy-loaded in `src/App.tsx`. Keep secondary features out of the
  initial chunk.
- Shared UI lives in `src/components/Primitives.tsx`. Use it rather than
  restyling locally.

## Client/server boundary

- The browser talks to the local Express API only, through `src/lib/api.ts`.
  Do not add a second fetch layer.
- Filtering, sorting, faceting, counting, and pagination happen in SQLite.
  **Never hydrate the whole people dataset into the browser.**
- Every user-cancellable request must accept an `AbortSignal` and the caller
  must abort superseded requests. Ignore `AbortError` rather than surfacing it.
- Long work (connector sync, evidence indexing, model inference) must be
  cancellable and must not block unrelated requests.

## Search and pagination constraints

- Server-side only, bounded result sets, deep-linkable.
- `evidence_fts` (FTS5) exists — prefer it over unanchored `LIKE '%…%'` scans.
- Do not add correlated subqueries per row for values the view does not render.
- Stale responses must never overwrite fresher ones.

## Accessibility

- Correct landmarks, semantic controls, labelled inputs, visible focus.
- Dialogs trap focus and restore it to the invoking element on close.
- Every hover behaviour needs a focus and touch equivalent.
- Touch targets ≥ 44 px on coarse pointers.
- Respect `prefers-reduced-motion`.
- **No horizontal overflow at 320, 375, 414, or 768 px.**
- No serious or critical axe violations in tested flows.

## Performance budgets

On the local development machine, against the real dataset:

| Interaction | Budget |
| --- | --- |
| Navigation within a loaded app | < 100 ms |
| Person drawer to first useful content | < 100 ms |
| Search keystroke to visible feedback | < 50 ms |
| Search settled results | < 150 ms |
| Layout shift on a settled route | 0 |

Also: no full-dataset hydration, no avoidable request waterfalls, no animation
on the critical path of a primary action.

## Dependency policy

Before adding a package, answer: is the capability already here? is it in the
platform? can it be written clearly in a small amount of code? what does it cost
the client bundle? does it introduce a competing paradigm? is it needed in more
than one place?

Do not add a state-management or data-fetching framework without a measured
justification. Reject abstractions used once, global state for route-local
state, and duplicate design-system layers.

## Working rules

- **Measure, do not guess.** Record a baseline before optimising and a
  comparison after. `docs/audits/` holds the record. Never invent a number; mark
  a metric unavailable if it could not be obtained reliably.
- **Verify in a real browser.** A UI change is not done until it has been run,
  exercised at desktop and mobile widths in both colour schemes, keyboard-tested,
  visually inspected, and repaired.
- **Feature-detect optional capabilities** — speech recognition, Ollama,
  connectors, Full Disk Access, network. Every one of them must degrade to a
  clearly explained, usable fallback rather than a broken control.
- Match the surrounding code's style. Comment only what the code cannot say.
- Do not weaken a test to make it pass.

## Where to look

| Concern | File |
| --- | --- |
| Schema and migrations | `server/migrations.ts` |
| Person queries, hydration, provenance | `server/db.ts` |
| HTTP routes | `server/index.ts` |
| Ollama, evidence index, suggestions | `server/intelligence/` |
| Connector platform, credentials, MCP | `server/platform/` |
| Apple Contacts / Messages | `server/connectors.ts`, `server/macos/` |
| WhatsApp Desktop (wacrawl) | `server/connectors/whatsapp-desktop.ts` |
| LinkedIn (user-authorised only) | `server/enrichment/` |
| Design tokens and component CSS | `src/index.css` |
| Shared UI | `src/components/Primitives.tsx` |
| API client | `src/lib/api.ts` |
| Skills for this repo | `.agents/skills/nett-*/SKILL.md` |
| Executable workflows | `docs/workflows/` |
| Measurements | `docs/audits/` |
