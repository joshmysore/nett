# Recurring workflows and loops

## 1. Built-in Nett freshness (preferred over computer-use)

| Field | Value |
| --- | --- |
| Trigger | Opt-in: `POST /api/freshness` with `{ "enabled": true }` while Nett server is running and Mac is awake |
| Tick | Every **60s** the timer checks what’s due |
| Current intervals | apple-contacts **1h**; messages **6h**; whatsapp **6h**; gmail **1h** |
| Steps | For each due connector: run local sync → update lastResults; WhatsApp/Messages also refresh communication index when a batch completes |
| Constraint | Sleep / quit / missing FDA skips a cycle — nothing syncs from the cloud |
| Manual poke | `POST /api/freshness/sync` `{ "connectorId"?: "messages" }` |
| Status | `GET /api/freshness` |

**Note for “every minute” ask:** the scheduler already wakes every minute, but Messages/WhatsApp are intentionally 6h because sync is heavy (SQLite + FDA). For ~1-minute *source* refresh, either (a) temporarily tighten `INTERVAL_MS` in `server/platform/freshness.ts` after measuring load, or (b) have Ops call `POST /api/connectors/{id}/sync` on a schedule — prefer API over GUI. Do not hammer Messages/WhatsApp every 60s without measuring.

Connector sync endpoints:

```bash
# Nett API base: http://127.0.0.1:4174 (prod) or via Vite proxy in dev
curl -s -X POST http://127.0.0.1:4174/api/connectors/apple-contacts/sync -H 'content-type: application/json' -d '{}'
curl -s -X POST http://127.0.0.1:4174/api/connectors/messages/sync -H 'content-type: application/json' -d '{"maxBatches":10}'
curl -s -X POST http://127.0.0.1:4174/api/connectors/whatsapp/sync -H 'content-type: application/json' -d '{"maxBatches":10}'
```

409 = already syncing. Abort superseded work.

---

## 2. Feature development (manual / per feature)

**Trigger:** New Nett feature request  
**Cadence:** On demand  
**Doc:** `docs/workflows/feature-development.md`  
**Steps:** Recon → product workflow skill → baseline measure → privacy review → smallest impl → tests → browser QA → a11y → visual review → feature review → release verification bits as needed.

---

## 3. Visual review

**Trigger:** Any change that produces pixels  
**Cadence:** Before/after each UI change  
**Skill:** nett-visual-direction  
**Steps:** Screenshots 1440+375 light/dark → compare to `design.md` → fix tokens → primitives → page last.

---

## 4. Performance review

**Trigger:** Query/list/routing/fetch/bundle changes or “feels slow”  
**Cadence:** Before/after  
**Skill:** nett-performance-budget  
**Steps:** `measure.mjs` → EXPLAIN → payload sizes → fix waterfalls/payload/query before render memos.

---

## 5. Import safety review

**Trigger:** LinkedIn archive, CSV, Contacts, paste profile, merge queue changes  
**Cadence:** Per change  
**Skill:** nett-import-safety  
**Steps:** Consent → raw preserve → idempotency assert → trust-order matching → no auto fuzzy merge.

---

## 6. Capture / provenance review

**Trigger:** Capture, dictation, suggestion approval, autofill  
**Cadence:** Per change  
**Skill:** nett-capture-and-provenance  
**Steps:** Words = record; structure = proposal; partial approve; idempotent; no sensitive traits.

---

## 7. Release verification

**Trigger:** Cut / “done” for a release  
**Cadence:** Per release  
**Steps:** `npm run check` → `npm test` → `npm run dev` + `npm run test:e2e` → `npm run build` → smoke `npm start`.

---

## 8. First-run / owner context

**Trigger:** New Mac / empty graph  
**Cadence:** Once per install  
**Doc:** `docs/workflows/first-run.md`  
**Steps:** Ask → Sources connect → People / Fill gaps; owner hometowns as cluster prior; no Instagram scrape.

---

## 9. Cursor hooks (session memory)

| Field | Value |
| --- | --- |
| Trigger | Cursor `stop` / `sessionEnd` |
| Cadence | Every agent stop / session end |
| Steps | Foundation.app hooks: `capture` on stop, `end` on sessionEnd (`~/.cursor/hooks.json`, profile `joshmysore1`) |

---

## 10. Continual learning (optional)

**Trigger:** User asks to mine chats / update AGENTS.md  
**Cadence:** On demand  
**Skill:** continual-learning → agents-memory-updater  

---

## 11. Firstmate fleet loops (after terminal firstmate is fully tooled)

| Loop | Trigger | Cadence |
| --- | --- | --- |
| Session start digest | Launch harness in firstmate home | Each session |
| Watcher supervision | Crew tasks live | Event-driven (zero-token sleep) |
| `/afk` away-mode | Captain invokes | While away |
| `/bearings` | Captain invokes | On demand |
| `/stow` | Captain invokes | End of session / sweep |
| Fleet sync | Bootstrap | Startup (Nett currently STUCK on uncommitted local changes — expected) |

---

## 12. Proposed Grok Bot Ops wake (new)

| Field | Value |
| --- | --- |
| Trigger | Scheduled wake every **1–5 minutes** (recommend **5 min** unless measured safe at 1) |
| Agent | Ops (Freshness) |
| Steps | 1) Ensure Nett API up (`:4174` or `npm run dev`) 2) `GET /api/freshness` 3) If disabled, enable or report 4) Prefer `POST /api/freshness/sync` or due connector syncs 5) On FDA/prepare failures, escalate to Firstmate — do not invent GUI scrapes of private message content 6) Report empty queues quietly on standing wakes; report failures with task id |
| Quiet success | Standing schedule may stay silent when nothing due / nothing new |
