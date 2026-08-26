# Tools, MCPs, and flags

## Active in this Cursor session

| Tool / MCP | Status | Notes for Grok Bot |
| --- | --- | --- |
| **Paper Desktop MCP** (`plugin-paper-desktop-paper`) | Available | Needs Paper app open + file. Design round-trips. |
| **Hugging Face skills plugin** | Installed | Rarely relevant to Nett. |
| Shell / gh / git | Available | `gh` authenticated as `joshmysore`. |
| cursor-agent CLI | On PATH | For cloud/agent SDK style work from Engineering. |
| Claude Code CLI | On PATH | Alternate harness for terminal firstmate. |
| Grok Bot.app | Installed + running | Primary multi-bot surface for this migration. |
| Grok CLI (`grok`) | **Not installed** | firstmate README’s `grok --trust` path unavailable until CLI install. |
| tmux | Installed | Terminal firstmate backend default. |
| Foundation hooks | Active in Cursor | Session capture — Grok Bot does not inherit these automatically. |

## Parallel plugin skills (research)

Flag as **external network**. Fine for public web research. Not for private Nett DB contents. Person enrichment must stay suggestion-grade with disclosure if anything leaves the Mac.

## Crawl4AI skill

Flag: powerful scraper. **Forbidden** for LinkedIn automation, Messages, WhatsApp, Contacts, or any access-control bypass. Nett prefers user exports and paste.

## Nett local API (primary Ops tool)

Base: `http://127.0.0.1:4174` (production server) or Vite-proxied during `npm run dev`.

Important routes:

- `GET/POST /api/freshness`, `POST /api/freshness/sync`
- `POST /api/connectors/:id/sync` — `apple-contacts`, `messages`, `whatsapp`, `gmail`, …
- `GET /api/connectors`, messages/whatsapp status + prepare endpoints
- People/review/intelligence under `/api/...` via `src/lib/api.ts` only from the app

## Secrets (names only — never paste values into bot chat)

Present key names on machine (from env files; values omitted):

- `.env` / `.env.example`: `NETT_PHONE_REGION`, `NETT_MESSAGES_BATCH_SIZE`, `PORT`, `NETT_MESSAGES_DB`
- Ask writer / OpenRouter / connector OAuth tokens live in app settings / Keychain when configured
- Firstmate optional Relay: `FMX_PAIRING_TOKEN` in firstmate `.env` (not set up)

**Grok Bot rule:** secrets are per-bot. Captain places secrets on the secure card for the bot that needs them. Never forward secrets in chat between bots.

## Firstmate toolchain still missing (needs install approval)

treehouse · no-mistakes · gh-axi · chrome-devtools-axi · lavish-axi · tasks-axi · quota-axi

Without these, use Grok Bot crewmates + Cursor cloud agents for code; terminal firstmate crew spawn is incomplete.

## shadcn / registries in Nett

`components.json` points at base-nova + registries `@canvas-ui`, `@23rd`, `@beui`. Prefer existing `src/components/Primitives.tsx` and tokens over new component systems unless dependency gate passes.
