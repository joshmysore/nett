import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export const latestSchemaVersion = 8;

export function normalizePhoneValue(value: string, defaultCountry = process.env.NETT_PHONE_REGION || "US"): string {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const phone = raw.startsWith("+")
      ? parsePhoneNumberFromString(raw)
      : parsePhoneNumberFromString(raw, defaultCountry.toUpperCase() as CountryCode);
    return phone?.isValid() ? phone.number : "";
  } catch {
    return "";
  }
}

export function storedPhoneValue(value: string): string {
  return normalizePhoneValue(value) || `unparsed:${value.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

const baselineSql = `
  CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    preferred_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    nickname TEXT,
    avatar_seed TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS source_identities (
    id TEXT PRIMARY KEY,
    person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
    connector_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    display_name TEXT,
    raw_json TEXT NOT NULL,
    linked_by TEXT,
    confidence REAL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(connector_id, external_id)
  );
  CREATE TABLE IF NOT EXISTS contact_methods (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    normalized_value TEXT NOT NULL,
    label TEXT,
    source_identity_id TEXT REFERENCES source_identities(id) ON DELETE SET NULL,
    is_primary INTEGER NOT NULL DEFAULT 0,
    UNIQUE(person_id, kind, normalized_value)
  );
  CREATE TABLE IF NOT EXISTS nett_metadata (
    person_id TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
    hometown TEXT, location TEXT, industry TEXT, company TEXT, spike TEXT,
    languages TEXT, skills TEXT, interests TEXT, gender TEXT, culture TEXT,
    personality TEXT, birthday TEXT, relationship_strength INTEGER,
    relationship TEXT, when_met TEXT, where_met TEXT, how_met TEXT,
    institutions TEXT, mutuals TEXT, last_contact TEXT, notes TEXT,
    quick_memories TEXT, follow_up_date TEXT, priority INTEGER,
    warmth INTEGER, intro_potential INTEGER, source_confidence REAL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS field_provenance (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    field_value TEXT,
    connector_id TEXT NOT NULL,
    source_record_id TEXT,
    confidence REAL,
    observed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    structured_json TEXT NOT NULL DEFAULT '{}',
    source TEXT NOT NULL DEFAULT 'manual',
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS contact_tags (
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'nett',
    PRIMARY KEY(person_id, tag_id)
  );
  CREATE TABLE IF NOT EXISTS interactions (
    id TEXT PRIMARY KEY,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    summary TEXT,
    source_connector TEXT NOT NULL,
    source_record_id TEXT,
    evidence_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS source_records (
    id TEXT PRIMARY KEY,
    connector_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    source_identity_id TEXT REFERENCES source_identities(id) ON DELETE SET NULL,
    person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    UNIQUE(connector_id, external_id, entity_type)
  );
  CREATE TABLE IF NOT EXISTS connector_states (
    connector_id TEXT PRIMARY KEY,
    permission_state TEXT NOT NULL DEFAULT 'unknown',
    status TEXT NOT NULL DEFAULT 'idle',
    last_sync_at TEXT,
    last_error TEXT,
    records_seen INTEGER NOT NULL DEFAULT 0,
    records_linked INTEGER NOT NULL DEFAULT 0,
    settings_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE TABLE IF NOT EXISTS imported_rows (
    id TEXT PRIMARY KEY,
    import_id TEXT NOT NULL,
    row_number INTEGER NOT NULL,
    raw_json TEXT NOT NULL,
    matched_person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
    match_method TEXT,
    confidence REAL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS merge_suggestions (
    id TEXT PRIMARY KEY,
    source_identity_id TEXT REFERENCES source_identities(id) ON DELETE CASCADE,
    candidate_person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    confidence REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_queries (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    response TEXT NOT NULL,
    citations_json TEXT NOT NULL,
    provider TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS message_links (
    id TEXT PRIMARY KEY,
    message_external_id TEXT NOT NULL UNIQUE,
    person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
    handle TEXT,
    linked_by TEXT,
    confidence REAL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_methods_normalized ON contact_methods(kind, normalized_value);
  CREATE INDEX IF NOT EXISTS idx_memories_person ON memories(person_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_interactions_person ON interactions(person_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_source_people ON source_records(person_id, connector_id);
`;

type Migration = {
  version: number;
  name: string;
  run(database: Database.Database): void;
};

const migrations: Migration[] = [
  {
    version: 1,
    name: "baseline-person-first-schema",
    run(database) {
      database.exec(baselineSql);
    }
  },
  {
    version: 2,
    name: "remove-demo-data-and-deduplicate-interactions",
    run(database) {
      database.exec(`
        DELETE FROM people WHERE id IN (
          'person-1','person-2','person-3','person-4','person-5','person-6',
          'person-7','person-8','person-9','person-10','person-11','person-12'
        );
        DELETE FROM interactions
        WHERE source_record_id IS NOT NULL
          AND rowid NOT IN (
            SELECT MIN(rowid) FROM interactions
            WHERE source_record_id IS NOT NULL
            GROUP BY source_connector, source_record_id, person_id
          );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_interactions_source_person
          ON interactions(source_connector, source_record_id, person_id)
          WHERE source_record_id IS NOT NULL;
      `);

      const phoneRows = database.prepare(
        "SELECT id, person_id, value FROM contact_methods WHERE kind = 'phone' ORDER BY rowid"
      ).all() as { id: string; person_id: string; value: string }[];
      const update = database.prepare("UPDATE contact_methods SET normalized_value = ? WHERE id = ?");
      const remove = database.prepare("DELETE FROM contact_methods WHERE id = ?");
      const seen = new Set<string>();
      for (const row of phoneRows) {
        const normalized = storedPhoneValue(row.value);
        const key = `${row.person_id}\0${normalized}`;
        if (seen.has(key)) remove.run(row.id);
        else {
          seen.add(key);
          update.run(normalized, row.id);
        }
      }
    }
  },
  {
    version: 3,
    name: "conversation-and-communication-evidence",
    run(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          connector_id TEXT NOT NULL,
          external_id TEXT NOT NULL,
          title TEXT,
          is_group INTEGER NOT NULL DEFAULT 0,
          raw_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(connector_id, external_id)
        );
        CREATE TABLE IF NOT EXISTS conversation_participants (
          conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          source_identity_id TEXT NOT NULL REFERENCES source_identities(id) ON DELETE CASCADE,
          handle TEXT NOT NULL,
          PRIMARY KEY(conversation_id, source_identity_id)
        );
        CREATE TABLE IF NOT EXISTS communications (
          id TEXT PRIMARY KEY,
          connector_id TEXT NOT NULL,
          external_id TEXT NOT NULL,
          guid TEXT,
          source_rowid INTEGER,
          conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
          sender_identity_id TEXT REFERENCES source_identities(id) ON DELETE SET NULL,
          handle TEXT,
          direction TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'message',
          body TEXT,
          occurred_at TEXT NOT NULL,
          evidence_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(connector_id, external_id)
        );
        CREATE TABLE IF NOT EXISTS communication_people (
          communication_id TEXT NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          PRIMARY KEY(communication_id, person_id)
        );
        CREATE INDEX IF NOT EXISTS idx_communications_time ON communications(occurred_at DESC, id);
        CREATE INDEX IF NOT EXISTS idx_communication_people_person ON communication_people(person_id, communication_id);
        CREATE INDEX IF NOT EXISTS idx_source_identities_unlinked ON source_identities(connector_id, person_id);
      `);
    }
  },
  {
    version: 4,
    name: "connector-platform-and-local-intelligence",
    run(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS connector_accounts (
          connector_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          account_label TEXT,
          credential_ref TEXT,
          auth_state TEXT NOT NULL DEFAULT 'missing',
          settings_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(connector_id, account_id)
        );
        CREATE TABLE IF NOT EXISTS sync_cursors (
          connector_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          scope TEXT NOT NULL,
          cursor_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY(connector_id, account_id, scope)
        );
        CREATE TABLE IF NOT EXISTS inference_suggestions (
          id TEXT PRIMARY KEY,
          person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          field_name TEXT NOT NULL,
          proposed_value_json TEXT NOT NULL,
          current_value_json TEXT,
          evidence_json TEXT NOT NULL DEFAULT '[]',
          rationale TEXT NOT NULL,
          confidence REAL NOT NULL,
          model TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TEXT NOT NULL,
          reviewed_at TEXT
        );
        CREATE TABLE IF NOT EXISTS inference_feedback (
          id TEXT PRIMARY KEY,
          suggestion_id TEXT REFERENCES inference_suggestions(id) ON DELETE SET NULL,
          person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          field_name TEXT NOT NULL,
          decision TEXT NOT NULL,
          source_pattern TEXT,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS relationship_signal_snapshots (
          id TEXT PRIMARY KEY,
          person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          calculated_at TEXT NOT NULL,
          recency REAL NOT NULL,
          cadence_drift REAL NOT NULL,
          reciprocity REAL NOT NULL,
          channel_diversity REAL NOT NULL,
          interaction_frequency REAL NOT NULL,
          explanation_json TEXT NOT NULL DEFAULT '{}'
        );
        CREATE TABLE IF NOT EXISTS evidence_documents (
          id TEXT PRIMARY KEY,
          person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          source TEXT NOT NULL,
          source_record_id TEXT NOT NULL,
          text TEXT NOT NULL,
          occurred_at TEXT,
          metadata_json TEXT NOT NULL DEFAULT '{}',
          embedding_json TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS evidence_fts USING fts5(
          document_id UNINDEXED,
          person_id UNINDEXED,
          source UNINDEXED,
          kind UNINDEXED,
          text,
          tokenize = 'unicode61 remove_diacritics 2'
        );
        CREATE INDEX IF NOT EXISTS idx_sync_cursors_connector
          ON sync_cursors(connector_id, account_id);
        CREATE INDEX IF NOT EXISTS idx_inference_suggestions_person
          ON inference_suggestions(person_id, status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_relationship_snapshots_person
          ON relationship_signal_snapshots(person_id, calculated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_evidence_documents_person
          ON evidence_documents(person_id, occurred_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_message_links_source_person
          ON message_links(message_external_id, person_id);
      `);
    }
  },
  {
    version: 5,
    name: "setup-import-and-knowledge-foundations",
    run(database) {
      database.exec(`
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS imports (
          id TEXT PRIMARY KEY,
          filename TEXT NOT NULL,
          file_hash TEXT NOT NULL,
          row_count INTEGER NOT NULL,
          status TEXT NOT NULL,
          summary_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          completed_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_imports_committed_hash
          ON imports(file_hash) WHERE status = 'committed';

        ALTER TABLE imported_rows ADD COLUMN source_identity_id TEXT
          REFERENCES source_identities(id) ON DELETE SET NULL;
        ALTER TABLE imported_rows ADD COLUMN content_hash TEXT;
        ALTER TABLE imported_rows ADD COLUMN previous_values_json TEXT;

        ALTER TABLE nett_metadata ADD COLUMN linkedin_url TEXT;
        ALTER TABLE nett_metadata ADD COLUMN headline TEXT;
        ALTER TABLE nett_metadata ADD COLUMN job_title TEXT;

        ALTER TABLE evidence_documents ADD COLUMN layer TEXT NOT NULL DEFAULT 'raw';
        ALTER TABLE evidence_documents ADD COLUMN content_hash TEXT;
        ALTER TABLE evidence_documents ADD COLUMN source_captured_at TEXT;
        ALTER TABLE evidence_documents ADD COLUMN invalidated_at TEXT;
        ALTER TABLE evidence_documents ADD COLUMN embedding_model TEXT;
        ALTER TABLE evidence_documents ADD COLUMN embedding_dims INTEGER;
        ALTER TABLE evidence_documents ADD COLUMN embedded_at TEXT;

        ALTER TABLE inference_feedback ADD COLUMN original_value_json TEXT;
        ALTER TABLE inference_feedback ADD COLUMN final_value_json TEXT;
        ALTER TABLE inference_feedback ADD COLUMN reason TEXT;
        ALTER TABLE inference_feedback ADD COLUMN note TEXT;

        CREATE TABLE IF NOT EXISTS ai_sessions (
          id TEXT PRIMARY KEY,
          title TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ai_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          retrieved_evidence_json TEXT NOT NULL DEFAULT '[]',
          provider TEXT,
          model TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_messages_session
          ON ai_messages(session_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_evidence_layer_person
          ON evidence_documents(layer, person_id, source_captured_at DESC);
      `);
    }
  },
  {
    version: 6,
    name: "profile-iteration-performance-indexes",
    run(database) {
      database.exec(`
        CREATE INDEX IF NOT EXISTS idx_people_name
          ON people(preferred_name COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_nett_priority_strength
          ON nett_metadata(priority DESC, relationship_strength DESC);
        CREATE INDEX IF NOT EXISTS idx_nett_follow_up
          ON nett_metadata(follow_up_date) WHERE follow_up_date IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_nett_last_contact
          ON nett_metadata(last_contact) WHERE last_contact IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_nett_location
          ON nett_metadata(location) WHERE location IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_nett_industry
          ON nett_metadata(industry) WHERE industry IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_memories_person_text
          ON memories(person_id);
        CREATE INDEX IF NOT EXISTS idx_contact_tags_person
          ON contact_tags(person_id, tag_id);
      `);
    }
  },
  {
    version: 7,
    name: "foods-and-online-personality",
    run(database) {
      database.exec(`
        ALTER TABLE nett_metadata ADD COLUMN foods TEXT;
        ALTER TABLE nett_metadata ADD COLUMN online_personality TEXT;
      `);
    }
  },
  {
    version: 8,
    name: "standardize-gender-values",
    run(database) {
      // Gender is a two-option field: male or female. Normalise shorthand that
      // accumulated before the constraint existed; anything unrecognised is
      // left for the owner to resolve by hand.
      database.exec(`
        UPDATE nett_metadata SET gender='male'
          WHERE LOWER(TRIM(COALESCE(gender,''))) IN ('m','male','man','boy');
        UPDATE nett_metadata SET gender='female'
          WHERE LOWER(TRIM(COALESCE(gender,''))) IN ('f','female','woman','girl');
      `);
    }
  }
];

export function migrateDatabase(database: Database.Database): void {
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    (database.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((row) => row.version)
  );
  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    database.transaction(() => {
      migration.run(database);
      database.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, datetime('now'))"
      ).run(migration.version, migration.name);
      database.pragma(`user_version = ${migration.version}`);
    })();
  }
}

export function openDatabase(databasePath: string): Database.Database {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const database = new Database(databasePath);
  const currentVersion = Number(database.pragma("user_version", { simple: true }) || 0);
  const tableCount = (database.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
  ).get() as { count: number }).count;
  if (tableCount > 0 && currentVersion < latestSchemaVersion) {
    const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
    const backupPath = `${databasePath}.backup-v${currentVersion}-${timestamp}.sqlite`;
    database.prepare("VACUUM INTO ?").run(backupPath);
  }
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  migrateDatabase(database);
  return database;
}
