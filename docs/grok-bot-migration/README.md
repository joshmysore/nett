# Grok / Firstmate setup for Nett

Cost rule: **prefer Nett API + Cursor/Claude; minimize Grok Bot.app.**  
Grok CLI is for occasional firstmate orchestration, not always-on computer-use loops.

## Status (finished)

| Item | Status |
| --- | --- |
| firstmate home | `/Users/joshmysore/Code/firstmate` |
| Nett registered | `Nett [local-only]` → `projects/Nett` |
| Toolchain | treehouse, no-mistakes, gh-axi, chrome-devtools-axi, lavish-axi, tasks-axi, quota-axi — **OK** |
| Bootstrap | Clean (`tasks-axi available`) |
| Backend | `tmux` |
| Crew harness | `claude` (saves Grok tokens on routine crew work) |
| **Grok CLI** | `@xai-official/grok` **1.0.5** on PATH (`~/.npm-global/bin`) |
| Grok login | **You still need one interactive `grok login`** (no `~/.grok/auth.json` yet) |
| Nett freshness | **Already enabled** — Contacts/Gmail ~1h, Messages/WhatsApp ~6h, tick every 60s |
| Grok Bot.app | Installed; **do not schedule Ops wakes here** — burns usage |

## Cost discipline

1. **Connector refresh** → Nett `POST /api/freshness` / built-in freshness (already on). Not Grok Bot computer use.
2. **Day-to-day Nett coding** → Cursor (this chat) or Claude via firstmate crew harness.
3. **Grok CLI** → open only when you want firstmate orchestration:  
   `cd ~/Code/firstmate && grok --trust`  
   Trust once so project hooks load (`/hooks-trust` also works).
4. **Grok Bot.app** → optional liaison UI only if you want multi-bot messaging; skip scheduled computer-use agents.

## One-time: sign in Grok CLI (you run this)

In a normal Terminal tab (not this agent — needs browser OAuth):

```bash
grok login
# or just: cd ~/Code/firstmate && grok --trust
```

Credentials land in `~/.grok/auth.json` (0600). Do not paste that file into chat.

## Launch firstmate (when you want it)

```bash
cd ~/Code/firstmate
grok --trust          # primary — use sparingly
# or, zero Grok burn for primary:
claude                # also supported as firstmate primary
```

Crewmates default to Claude (`config/crew-harness`).

## Migration pack (paste-ready charters)

All under `docs/grok-bot-migration/` in the Nett repo. Prefer them as **reference** for Cursor/Claude; only paste into Grok Bot if you deliberately use that UI.

| File | Role |
| --- | --- |
| `01-captain-profile.md` | Shared memory |
| `02-skills-inventory.md` | Skills catalog |
| `03-workflows-and-loops.md` | Workflows + freshness |
| `04-tools-mcps-flags.md` | Tools/MCPs |
| `agents/00-firstmate.md` … `05-…` | Role charters |

## Privacy reminders

FDA / Contacts permissions still apply for Messages/WhatsApp/Contacts sync. Freshness only runs while Nett is up and the Mac is awake.
