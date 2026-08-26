# Nett

Nett is a local-first personal relationship intelligence system. It resolves Apple Contacts, spreadsheet rows, Messages identities, memories, and future connector records beneath one canonical `Person` profile. Apple Contacts and Messages are read-only sources. Nett metadata lives separately in a local SQLite database.

## Privacy model

- The application and database run on your Mac.
- There is no account, cloud sync, remote analytics, or background upload.
- Apple Contacts and Messages are never modified.
- Raw connector records are preserved locally for provenance and future unmerge workflows.
- The built-in insight provider is local and evidence-backed. It cites the person records and memories used in each answer.
- No data leaves the machine unless a future remote LLM provider is explicitly configured. This build does not configure one.
- LinkedIn assistance opens LinkedIn in your browser only when you choose it. Nett does not reuse cookies or scrape in the background; pasted public text is parsed and stored locally.

## Run locally

Requirements: macOS, Node.js 20 or newer, and npm.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The development command starts both the React app and the local Express API. SQLite is created automatically at `data/nett.db`. Versioned migrations run transactionally at startup; production databases are never populated with demo contacts. Set `NETT_DB_PATH` to use a different database, including an isolated temporary path in tests.

For a production build:

```bash
npm run build
npm start
```

The production server is available at [http://127.0.0.1:4174](http://127.0.0.1:4174).

## First-run workflow

Open Nett goes to Ask. `/setup` still exists as a deep link and redirects there.

1. **Ask** any question about people you already have.
2. **Sources** connect Apple Contacts, Messages, WhatsApp Desktop, and Gmail. Spreadsheet import remains available as a fallback.
3. **People** is the recognition surface — contact cards and folders. **Fill gaps** walks missing hometowns and interests one field at a time.

Nett uses owner hometowns as a private cluster prior when they exist: people who share one of those places can get a reviewable hometown suggestion. It does not assume that strangers in the same city know each other, and it does not scrape Instagram.

## Apple Contacts access

Choose **Sources**, then **Connect** beside Apple Contacts. Nett uses the fast Swift `Contacts` framework export (`server/macos/export-contacts.swift`) for normal fields. It separately asks Contacts.app through a read-only, vectorized JXA pass for notes.

macOS may ask for Contacts permission the first time. If access is blocked:

1. Open System Settings.
2. Go to Privacy & Security → Contacts.
3. Allow Terminal, Cursor, or the process running Nett.
4. To import notes as source evidence, also allow the requesting process to automate Contacts.app under Privacy & Security → Automation.
5. Restart `npm run dev` and refresh the connector.

The Swift connector reads available names, identifiers, phones, emails, company, job title, birthday, nickname, and postal location. If Contacts.app note access is restricted, the normal contact sync still succeeds and reports that limitation explicitly. Apple notes are stored as provenance/source evidence and never overwrite editable Nett notes. Exact country-aware E.164 phone or normalized email matches can link automatically; unparsable phone values are preserved but are not used for automatic matching.

## Messages access

The Messages connector opens `~/Library/Messages/chat.db` with SQLite read-only and query-only flags. It advances an incremental ROWID/GUID cursor in bounded transactions, stores conversation, participant, direction, thread, and communication evidence, and derives generalized last-contact dates by exact country-aware phone or email association. Group chats link to known participants where practical; unmatched handles remain source identities in merge review.

macOS normally protects this database with Full Disk Access:

1. Open System Settings.
2. Go to Privacy & Security, then Full Disk Access.
3. Enable access for Terminal, Codex, or the process running Nett.
4. Restart the process before syncing.

You can avoid direct access to the live database by making a local copy and setting:

```bash
NETT_MESSAGES_DB=/absolute/path/to/messages.db npm run dev
```

Nett never writes to the Messages database. Per-person history is available from the paginated `/api/people/:id/communications` API. Repeated syncs are idempotent.

## Gmail

Gmail uses Google OAuth with the single read-only scope `gmail.readonly`. Tokens and an optional client secret are stored in macOS Keychain. Message and participant evidence is normalized into the same local conversation model as Messages.

1. In Google Cloud Console, create a project and enable the Gmail API.
2. Configure the OAuth consent screen. If the app is in testing, add your Gmail address as a test user.
3. Create OAuth credentials for a Desktop app.
4. In Nett, open Settings, Sources, Gmail, and paste the client ID and optional client secret.
5. Save, choose **Authorize in Google**, approve read-only access, then refresh Gmail.

The loopback callback is `http://127.0.0.1:4174/api/platform/gmail/callback`. Initial sync is bounded to 2,000 recent messages by default. Later runs use Gmail History cursors. Disconnecting removes Nett's local token from Keychain but does not revoke or modify Gmail data. You can also revoke Nett from your Google Account security settings.

## Telegram

Telegram uses a local MTProto client. API credentials and the serialized session are stored in macOS Keychain.

1. Create an application at [my.telegram.org](https://my.telegram.org) and copy its `api_id` and `api_hash`.
2. In Nett, open Settings, Sources, Telegram.
3. Enter the credentials, then your phone number with country code.
4. Enter the Telegram verification code and your two-step password if prompted.
5. Refresh Telegram to import permissioned dialogs and messages.

Nett never sends messages or modifies Telegram records. Telegram may rate-limit large initial syncs. The UI reports actionable auth, flood-wait, and retry errors.

## WhatsApp Desktop (wacrawl)

Nett can import your full WhatsApp history from the local WhatsApp Desktop databases via [openclaw/wacrawl](https://github.com/openclaw/wacrawl). This is the primary path — no per-chat exports.

1. Install WhatsApp Desktop and let it sync.
2. Install wacrawl: `brew install openclaw/tap/wacrawl`  
   Or download a release binary and set `NETT_WACRAWL_BIN`, or place it at `tools/bin/wacrawl`.
3. Open **Settings → Sources → WhatsApp → Sync archive and import**.

Nett stores a private archive at `data/imports/wacrawl.db`, then batch-imports into communications/interactions with a rowid cursor (same shape as Messages). People link by phone JID against `contact_methods`.

Pull new after Desktop has more history: **Pull new** re-runs wacrawl sync, then imports only unread archive rows.

Optional overrides:

- `NETT_WACRAWL_BIN` — path to the wacrawl binary
- `NETT_WACRAWL_DB` — archive path (default `data/imports/wacrawl.db`)
- `NETT_WHATSAPP_SOURCE` — WhatsApp Desktop group-container path

A single-chat `.txt` / `.zip` export import remains available as a fallback.

## CSV import

Use **Import** in the top bar and choose a UTF-8 CSV. Headers are normalized to lowercase snake case. Supported Nett metadata headers include:

`name`, `hometown`, `location`, `industry`, `company`, `spike`, `languages`, `skills`, `interests`, `gender`, `culture`, `personality`, `birthday`, `relationship_strength`, `relationship`, `when_met`, `where_met`, `how_met`, `institutions`, `mutuals`, `last_contact`, `tags`, `notes`, `quick_memories`, `follow_up_date`, `priority`, `warmth`, `intro_potential`, and `source_confidence`.

Email and phone columns are also accepted for matching. Exact contact methods merge automatically. Similar names enter the merge review queue instead of merging destructively. Every imported row is preserved in `imported_rows`.

## Keyboard and capture

- `Cmd+K`: Find — jump to a person or run a command.
- `Cmd+M`: Remember — turn a sentence into fields on a person (reviewed before save).
- On a person page, Record saves a written memory as-is. It does not structure fields.
- Ask Nett is Home. It questions stored records and does not write. People, Review, and Sources live in the sidebar.
- Voice capture uses the browser Speech Recognition API when available. The transcript is always shown for approval before saving.

## Hosted Ask with OpenRouter

Ask retrieves matching people, notes, and messages locally, then sends **only
those evidence excerpts** plus the question to OpenRouter. The OpenRouter key
is stored in the macOS Keychain (`com.nett.local.ask`), not in git. Set it on
Sources → Ask writer, or with `NETT_OPENROUTER_API_KEY`.

Ask uses `stealth/ox-alpha` (Ox Alpha via OpenRouter’s stealth provider — not
Anthropic or OpenAI). Embeddings still use `openai/text-embedding-3-small`
through OpenRouter because Ox Alpha is not an embedding model. Chat models are
never used to embed.

If no key is stored, lexical retrieval still works and Ask answers from stored
records only. Autofill never writes automatically. Accepted and rejected
suggestions are stored as local feedback.

Open Sources and choose **Index** to rebuild:

- an SQLite FTS5 evidence index over profiles, provenance, memories, and communications;
- compact embeddings for hybrid retrieval;
- cited answers that must reference retrieved evidence;
- reviewable profile autofill suggestions;
- explainable recency, cadence drift, reciprocity, channel-diversity, and frequency signals.

## LinkedIn public profile assist

LinkedIn is available as a user-assisted evidence source, not an automated connector. Open a person, choose **Edit fields**, and use **Public profile assist**:

1. Choose **Find on LinkedIn** to open a prefilled people search in your browser.
2. Paste the matching public profile URL and the visible name, headline, and location text.
3. Choose **Preview facts**.
4. Review location, headline, role, company, and URL one field at a time.
5. Stage only the supported facts you want, then save the profile.

Parsing happens locally. Nothing is inferred from a URL alone except its canonical profile address. Nett stores the pasted snapshot as a raw `source_record`, links a `linkedin-public` source identity to the canonical person, and records provenance and confidence for each accepted field. It never sends credentials, reuses browser cookies, performs background scraping, or silently overwrites Nett metadata.

This workflow is intentionally different from LinkedIn's authenticated Profile API. That API is restricted to approved applications and does not provide a general-purpose way to fetch and store arbitrary members' profile data.

## Local MCP plugins

The connector platform includes a local MCP bridge and validates process manifests before starting sidecars. Set `NETT_MCP_MANIFEST=/absolute/path/to/manifest.json` to expose configured local servers in Settings. A plugin receives only the inputs Nett explicitly sends to its declared tools. Gmail, Telegram, and WhatsApp are first-party adapters and do not require MCP sidecars.

## Backup and recovery

SQLite lives at `data/nett.db` unless `NETT_DB_PATH` is set. Before applying a newer schema to an existing database, Nett creates a consistent sibling backup named like:

`nett.db.backup-v3-2026-07-15T22-00-00Z.sqlite`

For a manual backup:

1. Stop Nett.
2. Copy `data/nett.db` and any automatic backup files to another local volume.
3. Restart Nett.

To restore, stop Nett, move the current database aside, copy the selected backup to `data/nett.db`, and start Nett. Keychain credentials are intentionally not included in database backups; reconnect external accounts if moving to another Mac. Apple Contacts and Messages can always be re-synced from their read-only sources.

## Verification

```bash
npm run check
npm test
npm run test:e2e
npm run build
```

`npm test` runs isolated migration, Apple-note, Messages-cursor, phone-normalization, LinkedIn public-evidence parsing/provenance, bounded dashboard hydration, WhatsApp-parser, credential-vault, Ask-writer, and atomic-ingestion checks. Browser tests cover desktop and mobile navigation, server pagination, profiles, connector states, command search, and WCAG serious/critical violations.

## Architecture

- React, Vite, and TypeScript frontend
- Tailwind-backed custom design tokens and component CSS
- Motion for state and focus transitions
- Local Node and Express API
- SQLite via `better-sqlite3`
- Fuse.js and SQLite FTS5 for conservative lexical retrieval
- Connector lifecycle with Keychain credentials, sync cursors, atomic ingestion, source identities, raw records, provenance, and structured errors
- First-party Gmail, Telegram, WhatsApp-export, Apple Contacts, and Messages adapters
- Local MCP bridge for optional sidecar connectors
- OpenRouter-backed Ask with retrieved evidence, cited answers, and reviewable autofill

The primary table is `people`. Connector-specific identity records belong to `source_identities`, while exact phones and emails live in `contact_methods`. Important facts retain rows in `field_provenance`. Memories, interactions, tags, source records, imports, message links, and AI queries are normalized separately.

## Connector status

Implemented: Apple Contacts, Messages, Gmail, Telegram, repeatable WhatsApp exports, CSV, manual capture, voice capture, user-assisted LinkedIn public evidence, and local MCP manifests.

Planned and labeled unavailable: automated LinkedIn sync and calendar.
