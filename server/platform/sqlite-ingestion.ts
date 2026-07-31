import Database from "better-sqlite3";
import Fuse from "fuse.js";
import { randomUUID } from "node:crypto";
import { normalizePhoneValue } from "../migrations.js";
import type {
  AtomicIngestionPort,
  AtomicIngestionResult,
  IngestionCursor,
  NormalizedSourceBundle,
  NormalizedSourceIdentity,
  SourceAddress
} from "./domain.js";

const now = () => new Date().toISOString();
const normalizeEmail = (value: string) => value.trim().toLocaleLowerCase();
const normalizePhone = normalizePhoneValue;

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function methodKind(source: string, address: SourceAddress): string {
  if (address.kind === "email" || address.kind === "phone") return address.kind;
  return `${source}:${address.kind}`;
}

function normalizedAddress(address: SourceAddress): string {
  if (address.kind === "email") return normalizeEmail(address.normalized || address.value);
  if (address.kind === "phone") return normalizePhone(address.normalized || address.value);
  return (address.normalized || address.value).trim().toLocaleLowerCase();
}

function linkedPlatformPerson(
  database: Database.Database,
  source: string,
  identity: NormalizedSourceIdentity
): string | undefined {
  for (const address of identity.addresses) {
    const normalized = normalizedAddress(address);
    if (!normalized) continue;
    const row = database.prepare(
      "SELECT person_id FROM contact_methods WHERE kind=? AND normalized_value=? LIMIT 1"
    ).get(methodKind(source, address), normalized) as { person_id: string } | undefined;
    if (row?.person_id) return row.person_id;
  }
  const normalizedEmails = identity.addresses
    .filter((address) => address.kind === "email")
    .map((address) => normalizeEmail(address.value))
    .filter(Boolean);
  const normalizedPhones = identity.addresses
    .filter((address) => address.kind === "phone")
    .map((address) => normalizePhone(address.value))
    .filter(Boolean);
  const clauses: string[] = [];
  const values: string[] = [];
  if (normalizedEmails.length) {
    clauses.push(`(kind='email' AND normalized_value IN (${normalizedEmails.map(() => "?").join(",")}))`);
    values.push(...normalizedEmails);
  }
  if (normalizedPhones.length) {
    clauses.push(`(kind='phone' AND normalized_value IN (${normalizedPhones.map(() => "?").join(",")}))`);
    values.push(...normalizedPhones);
  }
  if (!clauses.length) return undefined;
  const exact = database.prepare(
    `SELECT person_id FROM contact_methods WHERE ${clauses.join(" OR ")} LIMIT 1`
  ).get(...values) as { person_id: string } | undefined;
  return exact?.person_id;
}

function upsertLocalInteraction(
  database: Database.Database,
  input: {
    personId: string;
    kind: string;
    occurredAt: string;
    summary?: string;
    sourceConnector: string;
    sourceRecordId: string;
    evidence: Record<string, unknown>;
  }
): void {
  database.prepare(`
    INSERT INTO interactions
      (id, person_id, kind, occurred_at, summary, source_connector, source_record_id, evidence_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_connector, source_record_id, person_id) WHERE source_record_id IS NOT NULL
    DO UPDATE SET
      kind=excluded.kind,
      occurred_at=excluded.occurred_at,
      summary=excluded.summary,
      evidence_json=excluded.evidence_json
  `).run(
    randomUUID(), input.personId, input.kind, input.occurredAt, input.summary ?? null,
    input.sourceConnector, input.sourceRecordId, JSON.stringify(input.evidence)
  );
}

function rollupLocalLastContact(database: Database.Database, personIds: Iterable<string>): void {
  const update = database.prepare(`
    UPDATE nett_metadata SET
      last_contact=(SELECT MAX(occurred_at) FROM interactions WHERE person_id=?),
      updated_at=?
    WHERE person_id=?
  `);
  const timestamp = now();
  for (const personId of new Set(personIds)) update.run(personId, timestamp, personId);
}

function addMethods(
  database: Database.Database,
  personId: string,
  sourceIdentityId: string,
  source: string,
  addresses: readonly SourceAddress[]
): void {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO contact_methods
      (id, person_id, kind, value, normalized_value, label, source_identity_id, is_primary)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);
  for (const address of addresses) {
    const normalized = normalizedAddress(address);
    if (!normalized) continue;
    insert.run(
      randomUUID(),
      personId,
      methodKind(source, address),
      address.value,
      normalized,
      address.label ?? source,
      sourceIdentityId
    );
  }
}

export class SqliteAtomicIngestion implements AtomicIngestionPort {
  constructor(private readonly database: Database.Database) {}

  async ingest(bundle: NormalizedSourceBundle): Promise<AtomicIngestionResult> {
    return this.database.transaction(() => {
      const timestamp = bundle.capturedAt || now();
      let inserted = 0;
      let updated = 0;
      let ignored = 0;
      let deleted = 0;
      const touchedPeople = new Set<string>();
      const identityRows = new Map<string, { id: string; personId?: string; isSelf: boolean }>();
      const people = this.database.prepare(`
        SELECT p.id, p.preferred_name AS name, m.company
        FROM people p LEFT JOIN nett_metadata m ON m.person_id=p.id
      `).all() as Array<{ id: string; name: string; company?: string }>;
      const nameFuse = new Fuse(people, {
        threshold: 0.28,
        includeScore: true,
        keys: ["name"]
      });

      for (const identity of bundle.identities) {
        const existing = this.database.prepare(
          "SELECT id, person_id FROM source_identities WHERE connector_id=? AND external_id=?"
        ).get(bundle.connectorId, identity.externalId) as { id: string; person_id: string | null } | undefined;
        const personId = identity.isSelf
          ? undefined
          : existing?.person_id ?? linkedPlatformPerson(this.database, bundle.connectorId, identity);
        const identityId = existing?.id ?? identity.stableId;
        const linkedBy = existing?.person_id
          ? "existing"
          : personId
            ? "exact-contact-method"
            : "unlinked";
        this.database.prepare(`
          INSERT INTO source_identities
            (id, person_id, connector_id, external_id, display_name, raw_json, linked_by, confidence, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(connector_id, external_id) DO UPDATE SET
            person_id=COALESCE(source_identities.person_id, excluded.person_id),
            display_name=excluded.display_name,
            raw_json=excluded.raw_json,
            linked_by=CASE WHEN source_identities.person_id IS NOT NULL THEN source_identities.linked_by ELSE excluded.linked_by END,
            confidence=CASE WHEN source_identities.person_id IS NOT NULL THEN source_identities.confidence ELSE excluded.confidence END,
            updated_at=excluded.updated_at
        `).run(
          identityId,
          personId ?? null,
          bundle.connectorId,
          identity.externalId,
          identity.displayName,
          JSON.stringify({ name: identity.displayName, ...identity }),
          linkedBy,
          personId ? 1 : 0,
          timestamp,
          timestamp
        );
        const stored = this.database.prepare(
          "SELECT id, person_id FROM source_identities WHERE connector_id=? AND external_id=?"
        ).get(bundle.connectorId, identity.externalId) as { id: string; person_id: string | null };
        identityRows.set(identity.stableId, {
          id: stored.id,
          personId: stored.person_id ?? undefined,
          isSelf: identity.isSelf === true
        });
        this.database.prepare(`
          INSERT INTO source_records
            (id, connector_id, external_id, source_identity_id, person_id, entity_type, raw_json, captured_at)
          VALUES (?, ?, ?, ?, ?, 'identity', ?, ?)
          ON CONFLICT(connector_id, external_id, entity_type) DO UPDATE SET
            source_identity_id=excluded.source_identity_id,
            person_id=COALESCE(source_records.person_id, excluded.person_id),
            raw_json=excluded.raw_json,
            captured_at=excluded.captured_at
        `).run(
          randomUUID(),
          bundle.connectorId,
          identity.externalId,
          stored.id,
          stored.person_id,
          JSON.stringify(identity),
          timestamp
        );
        if (stored.person_id) {
          addMethods(this.database, stored.person_id, stored.id, bundle.connectorId, identity.addresses);
          touchedPeople.add(stored.person_id);
        } else if (!identity.isSelf && identity.displayName.trim()) {
          const hasSuggestions = this.database.prepare(
            "SELECT 1 FROM merge_suggestions WHERE source_identity_id=? LIMIT 1"
          ).get(stored.id);
          if (!hasSuggestions) {
            for (const candidate of nameFuse.search(identity.displayName).slice(0, 3)) {
              const confidence = 1 - (candidate.score ?? 1);
              if (confidence < 0.72) continue;
              this.database.prepare(`
                INSERT INTO merge_suggestions
                  (id, source_identity_id, candidate_person_id, reason, confidence, status, created_at)
                VALUES (?, ?, ?, 'fuzzy-name-review', ?, 'pending', ?)
              `).run(randomUUID(), stored.id, candidate.item.id, confidence, timestamp);
            }
          }
        }
        existing ? updated++ : inserted++;
      }

      const conversationRows = new Map<string, string>();
      for (const conversation of bundle.conversations) {
        const existing = this.database.prepare(
          "SELECT id FROM conversations WHERE connector_id=? AND external_id=?"
        ).get(bundle.connectorId, conversation.externalId) as { id: string } | undefined;
        const conversationId = existing?.id ?? conversation.stableId;
        this.database.prepare(`
          INSERT INTO conversations
            (id, connector_id, external_id, title, is_group, raw_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(connector_id, external_id) DO UPDATE SET
            title=excluded.title,
            is_group=excluded.is_group,
            raw_json=excluded.raw_json,
            updated_at=excluded.updated_at
        `).run(
          conversationId,
          bundle.connectorId,
          conversation.externalId,
          conversation.title ?? null,
          conversation.kind === "group" || conversation.kind === "channel" ? 1 : 0,
          JSON.stringify(conversation),
          timestamp,
          conversation.updatedAt ?? timestamp
        );
        const stored = this.database.prepare(
          "SELECT id FROM conversations WHERE connector_id=? AND external_id=?"
        ).get(bundle.connectorId, conversation.externalId) as { id: string };
        conversationRows.set(conversation.stableId, stored.id);
        for (const participant of conversation.participants) {
          const identity = identityRows.get(participant.identityStableId);
          if (!identity) continue;
          this.database.prepare(`
            INSERT OR IGNORE INTO conversation_participants
              (conversation_id, source_identity_id, handle)
            VALUES (?, ?, ?)
          `).run(stored.id, identity.id, participant.displayName ?? participant.identityStableId);
        }
        existing ? updated++ : inserted++;
      }

      for (const interaction of bundle.interactions) {
        const existing = this.database.prepare(
          "SELECT id FROM communications WHERE connector_id=? AND external_id=?"
        ).get(bundle.connectorId, interaction.externalId) as { id: string } | undefined;
        const communicationId = existing?.id ?? interaction.stableId;
        const sender = interaction.senderIdentityStableId
          ? identityRows.get(interaction.senderIdentityStableId)
          : undefined;
        const evidence = {
          direction: interaction.direction,
          subject: interaction.subject,
          snippet: interaction.snippet,
          attachments: interaction.attachments,
          rawRef: interaction.rawRef
        };
        this.database.prepare(`
          INSERT INTO communications
            (id, connector_id, external_id, guid, conversation_id, sender_identity_id, handle,
             direction, kind, body, occurred_at, evidence_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(connector_id, external_id) DO UPDATE SET
            conversation_id=excluded.conversation_id,
            sender_identity_id=excluded.sender_identity_id,
            direction=excluded.direction,
            kind=excluded.kind,
            body=excluded.body,
            occurred_at=excluded.occurred_at,
            evidence_json=excluded.evidence_json,
            updated_at=excluded.updated_at
        `).run(
          communicationId,
          bundle.connectorId,
          interaction.externalId,
          interaction.stableId,
          interaction.conversationStableId
            ? conversationRows.get(interaction.conversationStableId) ?? null
            : null,
          sender?.id ?? null,
          sender ? bundle.identities.find((item) => item.stableId === interaction.senderIdentityStableId)?.displayName ?? null : null,
          interaction.direction,
          interaction.kind,
          interaction.text ?? interaction.snippet ?? interaction.subject ?? null,
          interaction.occurredAt,
          JSON.stringify(evidence),
          timestamp,
          timestamp
        );
        this.database.prepare(`
          INSERT INTO source_records
            (id, connector_id, external_id, source_identity_id, person_id, entity_type, raw_json, captured_at)
          VALUES (?, ?, ?, ?, ?, 'interaction', ?, ?)
          ON CONFLICT(connector_id, external_id, entity_type) DO UPDATE SET
            source_identity_id=excluded.source_identity_id,
            person_id=COALESCE(source_records.person_id, excluded.person_id),
            raw_json=excluded.raw_json,
            captured_at=excluded.captured_at
        `).run(
          randomUUID(),
          bundle.connectorId,
          interaction.externalId,
          sender?.id ?? null,
          sender?.personId ?? null,
          JSON.stringify(interaction),
          timestamp
        );

        const linked = new Map<string, string>();
        for (const stableId of interaction.participantIdentityStableIds) {
          const participant = identityRows.get(stableId);
          if (participant?.personId) linked.set(participant.personId, participant.id);
        }
        if (sender?.personId) linked.set(sender.personId, sender.id);
        for (const [personId, identityId] of linked) {
          const role = sender?.personId === personId ? "sender" : "participant";
          this.database.prepare(`
            INSERT INTO communication_people (communication_id, person_id, role)
            VALUES (?, ?, ?)
            ON CONFLICT(communication_id, person_id) DO UPDATE SET role=excluded.role
          `).run(communicationId, personId, role);
          upsertLocalInteraction(this.database, {
            personId,
            kind: interaction.kind,
            occurredAt: interaction.occurredAt,
            summary: interaction.text ?? interaction.snippet ?? interaction.subject,
            sourceConnector: bundle.connectorId,
            sourceRecordId: interaction.externalId,
            evidence: { ...evidence, sourceIdentityId: identityId }
          });
          touchedPeople.add(personId);
        }
        existing ? updated++ : inserted++;
      }

      for (const tombstone of bundle.tombstones ?? []) {
        this.database.prepare(`
          INSERT INTO source_records
            (id, connector_id, external_id, entity_type, raw_json, captured_at)
          VALUES (?, ?, ?, 'tombstone', ?, ?)
          ON CONFLICT(connector_id, external_id, entity_type) DO UPDATE SET
            raw_json=excluded.raw_json,
            captured_at=excluded.captured_at
        `).run(randomUUID(), bundle.connectorId, tombstone.externalId, JSON.stringify(tombstone), timestamp);
        deleted++;
      }

      if (bundle.nextCursor) {
        this.database.prepare(`
          INSERT INTO sync_cursors
            (connector_id, account_id, scope, cursor_json, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(connector_id, account_id, scope) DO UPDATE SET
            cursor_json=excluded.cursor_json,
            updated_at=excluded.updated_at
        `).run(
          bundle.connectorId,
          bundle.accountId,
          bundle.nextCursor.scope,
          JSON.stringify(bundle.nextCursor),
          timestamp
        );
      }
      rollupLocalLastContact(this.database, touchedPeople);
      return {
        batchId: bundle.batchId,
        inserted,
        updated,
        ignored,
        deleted,
        committedCursor: bundle.nextCursor
      };
    })();
  }

  async readCursor(connectorId: string, scope: string): Promise<IngestionCursor | undefined> {
    const row = this.database.prepare(`
      SELECT cursor_json FROM sync_cursors
      WHERE connector_id=? AND scope=?
      ORDER BY updated_at DESC LIMIT 1
    `).get(connectorId, scope) as { cursor_json: string } | undefined;
    return row ? parseJson<IngestionCursor>(row.cursor_json, undefined as unknown as IngestionCursor) : undefined;
  }
}
