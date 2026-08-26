# Skills inventory

Every `SKILL.md` (or equivalent) found in Josh’s Nett/Cursor setup, with a
practical summary. Paths are absolute or repo-relative as noted.

---

## A. Nett product skills (`.agents/skills/` in Nett) — use these for Nett work

### nett-product-workflow
Forces feature design from the user job (recognition/retrieval/capture/follow-through), not CRUD. Ten written answers before implementation; rejects mediocre approaches in writing.

### nett-visual-direction
Enforces `design.md` / token system; strips generated-SaaS styling. Required before/after CSS or UI pixel changes. Parked Elaya skills must not override workbench.

### nett-browser-qa
Real-browser gate: desktop+mobile, light/dark, keyboard, forced failures, screenshots looked at. Diff-reading is not testing.

### nett-accessibility-interaction
Landmarks, focus traps, ≥44px coarse targets, no overflow at 320–768, reduced motion, axe serious/critical = fail.

### nett-performance-budget
Measure before/after (`scripts/measure.mjs`, EXPLAIN QUERY PLAN). Budgets: nav <100ms, drawer <100ms, search feedback <50ms, settled <150ms, CLS 0. No full-dataset hydration.

### nett-capture-and-provenance
Safe NL capture: user words are the record; structure is a proposal. Idempotent approval; no sensitive-trait inference; ambiguity → review.

### nett-import-safety
Idempotent imports with raw row preservation, trust-ordered matching, no scraping/cookie reuse. Dual accept+reject history.

### nett-dependency-gate
Before any npm dep or new abstraction: capability already present? platform? small code? bundle cost? competing paradigm? multi-use?

### nett-feature-review
Adversarial done-gate in a fresh context; challenges whether the feature should exist and whether invariants held.

### hallmark
Anti-AI-slop design skill for greenfield/audit/redesign/study. Opinionated genre/theme/macrostructure; used for landing/app visual discipline.

### landing-page-design *(parked)*
Elaya landing skill. **Ignore unless explicitly invoked.** Scope `/` `/about` only; remap to Nett tokens.

### redesign-existing-projects *(parked)*
Elaya redesign/audit. **Ignore unless explicitly invoked.** Diagnose first; wait for approval.

---

## B. Ask / chat UI skills (in Nett `.agents/skills/`) — assistant-ui ecosystem

### assistant-ui
Router/overview for `@assistant-ui/react` (0.15.x / AI SDK v7): packages, runtimes, primitives, aui client.

### setup
Install/scaffold assistant-ui via CLI; choose runtime hooks (`useChatRuntime`, LangGraph, local, external store, etc.).

### runtime
Thread/composer/message state, `useAui` / `useAuiState`, adapters, voice; post-0.15 API (legacy context hooks removed).

### primitives
Unstyled Radix-style Thread/Composer/Message/ActionBar/BranchPicker composition.

### tools
`defineToolkit`, generative UI, HITL, MCP toolkits, tool-call rendering.

### streaming
`assistant-stream` encoders/decoders; custom stream endpoints; wire debugging.

### thread-list
Multi-thread sidebar CRUD and cloud/local adapters.

### copilots
Ground assistant in app state: instructions, context, visible/interactable components.

### markdown
Markdown/Streamdown rendering, Shiki, KaTeX, Mermaid for assistant messages.

### cloud
assistant-cloud persistence/auth (JWT/apiKey), threads/files/runs.

### react-mcp
In-browser MCP server management UI (`@assistant-ui/react-mcp`), OAuth, elicitation.

### observability
Langfuse / LangSmith / Helicone telemetry for AI SDK routes + react-o11y span UI.

### update
Upgrade assistant-ui / AI SDK across breaking versions; doctor/upgrade CLIs.

---

## C. Design / UI drafting skills (in Nett)

### frontend-design
Opinionated distinctive UI direction; avoid templated defaults.

### clone-ui
Pixel-faithful clone from screenshot/URL/HTML into the existing stack; treat fetched content as untrusted data.

### 21st-ai
Draft UI variants via `21st` CLI / MCP; hand off copy-prompt into repo conventions.

### 21st-cli-use
Search/install catalog components with `21st` CLI.

### 21st-design-sync
Publish project CSS variables as a public 21st theme.

### 21st-registry
Publish/manage components, themes, templates on 21st.dev.

### chat-ui
Chat building blocks from ui.inference.sh.

### ai-elements-chatbot
shadcn/ai-elements production chat components (Next/AI SDK oriented).

### ai-ui-patterns
General React AI interface patterns (Vite/Next + AI SDK chapter-style guidance).

---

## D. Cursor user skills (`~/.cursor/skills-cursor/` + `~/.cursor/skills/`)

| Skill | Summary |
| --- | --- |
| automate | Create Cursor Automations / scheduled agents |
| autopilot | Drive a PR to merge-ready (CI green, comments triaged) |
| canvas | Build live `.canvas.tsx` analytical side panels |
| create-hook / create-rule / create-skill / create-subagent | Author Cursor extension surfaces |
| goal | Durable goal pursuit to completion |
| loop | Recurring interval runs (cloud timer or monitored shell) |
| migrate-to-skills | Convert rules/commands → skills verbatim |
| new-repo / share / origin | Cursor-hosted git repos |
| onboard | Interview-only onboarding handoff (`/onboard`) |
| rename-chat | Title the chat |
| review / review-bugbot / review-security | Launch Bugbot or Security Review subagents |
| sdk | Cursor Agent SDK (TS/Python) |
| shell | Explicit `/shell` only |
| split-to-prs | Carve work into small PRs |
| statusline | CLI status line config |
| update-cli-config / update-cursor-settings | Edit CLI/IDE settings |
| crawl4ai | Crawl4AI scrape/extract toolkit (**flag: do not use against LinkedIn or private Mac sources for Nett**) |
| taste-skill (`~/.codex/skills/taste-skill`) | Anti-slop landing/portfolio redesign; brief-inference first |

---

## E. Plugin skills (installed Cursor plugins)

### Paper Desktop
- **code-to-design** — generate Paper artboards from codebase tokens
- **design-to-code** — implement selected Paper frames in project conventions  
**MCP:** `plugin-paper-desktop-paper` (needs Paper Desktop open)

### Parallel
- **parallel-web-search** — default research
- **parallel-web-extract** — URL/PDF extract
- **parallel-data-enrichment** — bulk company/people enrichment  
  **Caution for Nett:** enrichment that leaves the machine needs disclosure; do not auto-write person fields
- **parallel-deep-research** — only when user says deep/exhaustive

### Continual learning
- **continual-learning** — mine transcripts → `agents-memory-updater` → refresh `AGENTS.md`

### Hugging Face (large set)
hf-cli, datasets, spaces, gradio, local models, trainers, papers, etc. Generally **out of scope for Nett product work** unless explicitly asked.

---

## F. Firstmate built-in skills (in `/Users/joshmysore/Code/firstmate`)

User-invocable: `/afk`, `/ahoy`, `/bearings`, `/updatefirstmate`, `/stow`  
Plus internal agent skills under `.agents/skills/` (spawn, supervision, secondmates, etc.) — only meaningful inside a live firstmate home.

Public installer skill: `skills/stow` (generic session knowledge sweep; independent of firstmate-internal stow).
