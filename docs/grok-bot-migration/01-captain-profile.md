# Captain profile — Josh Mysore / Nett

Condensed durable context for every Grok Bot on this crew. Prefer this over
chat history.

## Who / what

- Builder of **Nett**: a local-first personal relationship system for **one person on one Mac**.
- Job of the product: **recognition and retrieval** — find a person, understand why they matter, update them, never lose the evidence behind a fact.
- Explicitly **not** a CRM, sales tool, or metrics dashboard.

## Goals (product)

1. Keep people, conversations, and provenance trustworthy at multi-thousand-person scale.
2. Make Ask / Review / People / Sources feel like a private instrument — calm, exact, fast.
3. Prefer owned evidence (Contacts, Messages, WhatsApp, Gmail, Telegram, LinkedIn export, pasted text) over scraping or cloud CRM patterns.
4. Ship features through recognition jobs, not CRUD screens.
5. Preserve deep links and URL-owned list state.

## Information priority (always)

1. identity → 2. why they matter → 3. relationship/context → 4. role/company →
5. location → 6. languages → 7. last contact → 8. follow-up → 9. next action →
10. provenance / secondary metadata

## Non-negotiables

- Local-first: no account, no cloud sync, no telemetry for private graph data.
- Apple Contacts / Messages / WhatsApp / Telegram / Gmail connectors are **read-only** toward those systems.
- Never transmit notes/messages/contacts off-machine without explicit config + per-use disclosure.
- Suggestions are reviewable; never silent auto-writes of structured person fields.
- Never infer protected traits (health, sexuality, religion, politics, ethnicity, etc.).
- Never automate LinkedIn login, cookie reuse, access-control bypass, or mass scraping.
- Never destroy `data/nett.db`, WAL/SHM, `nett.db.backup-*.sqlite`, or `data/imports/`.
- Migrations are append-only; never edit/renumber applied migrations.
- `design.md` is locked visual truth; do not contradict it in CSS.

## Stack / working environment

- Path: `/Users/joshmysore/Code/nett/Nett`
- GitHub: `joshmysore/nett` (branch usually `main`)
- Client: React + Vite (`:5173` dev)
- Server: Express (`:4174`) + SQLite (`data/nett.db`)
- API client: only `src/lib/api.ts`
- Commands: `npm run dev` · `npm run check` · `npm test` · `npm run test:e2e` (needs dev running) · `npm run build` · `node scripts/measure.mjs <label>`
- Firstmate home: `/Users/joshmysore/Code/firstmate` (Nett registered `local-only`)

## Design preferences

- Geist UI type; JetBrains Mono only for tabular/source values; **nothing below 12 px**.
- One containment layer; no card-in-card; dividers/whitespace over borders.
- Accent = signal only (focus/selection/links), never decorative wash or surface fill.
- OS appearance (light/dark); never mix modes on one page.
- Landing may use restrained ceremonial motifs; workbench stays token-led.
- Anti-slop: no purple-gradient AI chrome, glow-everything, invented metrics, uncited model output on workbench.
- Parked Elaya landing skills exist but apply only when explicitly invoked, and only to `/` and `/about`.

## Writing / collaboration style

- Direct and concise. Lead with the verdict.
- Bold sparingly. No fluffy restating of the task.
- Prefer pointed bullets over long essays unless asked for depth.
- Measure, don’t guess. Record baselines in `docs/audits/`.
- UI not done until real-browser verified (desktop + mobile, both schemes, keyboard).
- Commits only when explicitly asked; never force-push main; never amend others’ commits.
- Match surrounding code style; comment only what code cannot say.
- Do not weaken tests to make them pass.

## Business / product context

- Solo Mac product; complexity budget is small.
- Scale reality (order-of-magnitude from performance skill): thousands of people, hundreds of thousands of interactions/communications, large local SQLite — must stay immediate without a heavy client data layer.
- Filtering/sorting/faceting/pagination happen in SQLite; never hydrate the full people set into the browser.
- Optional hosted Ask writer (OpenRouter by default) — question + evidence excerpts leave only when a key is configured; Ask still does not write records.

## Communication with agents

- Captain talks only to **Firstmate**.
- Crewmates report outcomes/blockers to Firstmate with a task id.
- Prefer outcomes and consequences over internal mechanics when addressing the captain.
