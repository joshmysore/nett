import { randomUUID } from "node:crypto";
import { db, getPerson, updatePerson } from "../db.js";

export type PublicProfileSuggestion = {
  field: "linkedin_url" | "headline" | "job_title" | "company" | "location";
  value: string;
  confidence: number;
  reason: string;
  evidence: string;
  source: "linkedin-public";
};

export type LinkedInPublicInput = {
  profileUrl: string;
  publicText?: string;
};

const ignoredLines = /^(about|activity|articles|connections?|contact info|education|experience|followers?|home|join now|message|people also viewed|posts|recommendations|sign in|skills)$/i;
const locationSignals = [
  /\bgreater .+ area\b/i,
  /\bmetropolitan area\b/i,
  /\b(?:remote|worldwide)\b/i,
  /\b(?:united states|united kingdom|canada|australia|india|germany|france|singapore|hong kong|switzerland|netherlands|hungary)\b/i,
  /\b(?:new york|san francisco|los angeles|london|paris|berlin|budapest|boston|chicago|miami|seattle|austin|washington|toronto|vancouver|sydney|melbourne|tokyo|dubai)\b/i,
  /^[\p{L} .'-]+,\s*[\p{L} .'-]{2,}$/u
];

export function normalizeLinkedInProfileUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("Paste a LinkedIn profile URL");
  let parsed: URL;
  try {
    parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    throw new Error("Enter a valid LinkedIn profile URL");
  }
  const hostname = parsed.hostname.toLocaleLowerCase().replace(/^www\./, "");
  if (parsed.protocol !== "https:" || hostname !== "linkedin.com" || !/^\/in\/[^/]+\/?$/i.test(parsed.pathname)) {
    throw new Error("Use a public LinkedIn profile URL in the form linkedin.com/in/name");
  }
  return `https://www.linkedin.com${parsed.pathname.replace(/\/$/, "")}`;
}

function cleanLines(value: string): string[] {
  const seen = new Set<string>();
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      const key = line.toLocaleLowerCase();
      if (!line || line.length > 220 || ignoredLines.test(line) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 80);
}

function sameValue(left: unknown, right: unknown): boolean {
  return String(left ?? "").trim().toLocaleLowerCase() === String(right ?? "").trim().toLocaleLowerCase();
}

export function previewLinkedInPublicProfile(
  input: LinkedInPublicInput,
  person: Record<string, unknown>
): { profileUrl: string; suggestions: PublicProfileSuggestion[] } {
  const profileUrl = normalizeLinkedInProfileUrl(input.profileUrl);
  const lines = cleanLines(String(input.publicText || "").slice(0, 20_000));
  const personNames = [person.name, person.preferred_name, person.first_name]
    .map((value) => String(value ?? "").trim().toLocaleLowerCase())
    .filter(Boolean);
  const usable = lines.filter((line) => !personNames.includes(line.toLocaleLowerCase()));
  const location = usable.find((line) => locationSignals.some((signal) => signal.test(line)));
  const headline = usable.find((line) =>
    line !== location
    && line.length >= 5
    && !/^\d|view .* profile|mutual connection/i.test(line)
  );
  const roleMatch = headline?.match(/^(.{2,80}?)\s+(?:at|@)\s+(.{2,100})$/i);
  const suggestions: PublicProfileSuggestion[] = [];
  const add = (
    field: PublicProfileSuggestion["field"],
    value: string | undefined,
    confidence: number,
    reason: string,
    evidence: string
  ) => {
    if (!value || sameValue(person[field], value)) return;
    suggestions.push({ field, value, confidence, reason, evidence, source: "linkedin-public" });
  };
  add("linkedin_url", profileUrl, 1, "Canonicalized from the profile URL you supplied.", profileUrl);
  add("headline", headline, 0.82, "Detected as the first profile summary line after the person's name.", headline || "");
  add("job_title", roleMatch?.[1]?.trim(), 0.86, "Parsed from a “role at company” headline.", headline || "");
  add("company", roleMatch?.[2]?.trim(), 0.84, "Parsed from a “role at company” headline.", headline || "");
  add("location", location, 0.8, "Detected from a public profile line with geographic wording.", location || "");
  return { profileUrl, suggestions };
}

export function applyLinkedInPublicProfile(
  personId: string,
  input: LinkedInPublicInput & { acceptedFields: string[] }
) {
  const person = getPerson(personId) as Record<string, unknown> | null;
  if (!person) throw new Error("Person not found");
  const preview = previewLinkedInPublicProfile(input, person);
  const accepted = new Set(input.acceptedFields);
  const selected = preview.suggestions.filter((suggestion) => accepted.has(suggestion.field));
  if (!selected.length) throw new Error("Select at least one supported fact");
  const existingIdentity = db.prepare(
    "SELECT person_id FROM source_identities WHERE connector_id='linkedin-public' AND external_id=?"
  ).get(preview.profileUrl) as { person_id: string | null } | undefined;
  if (existingIdentity?.person_id && existingIdentity.person_id !== personId) {
    throw new Error("This LinkedIn profile is already linked to another person. Separate that identity before relinking it.");
  }
  const timestamp = new Date().toISOString();
  const identityId = randomUUID();
  const recordId = randomUUID();
  const snapshot = {
    profileUrl: preview.profileUrl,
    publicText: String(input.publicText || "").slice(0, 20_000),
    capturedAt: timestamp,
    capturedBy: "user-paste",
    suggestions: selected
  };
  db.transaction(() => {
    db.prepare(`
      INSERT INTO source_identities
        (id, person_id, connector_id, external_id, display_name, raw_json, linked_by,
         confidence, created_at, updated_at)
      VALUES (?, ?, 'linkedin-public', ?, ?, ?, 'manual-public-profile', 1, ?, ?)
      ON CONFLICT(connector_id, external_id) DO UPDATE SET
        person_id=excluded.person_id, display_name=excluded.display_name,
        raw_json=excluded.raw_json, linked_by=excluded.linked_by,
        confidence=excluded.confidence, updated_at=excluded.updated_at
    `).run(
      identityId, personId, preview.profileUrl, String(person.name || person.preferred_name || ""),
      JSON.stringify(snapshot), timestamp, timestamp
    );
    const storedIdentity = db.prepare(
      "SELECT id FROM source_identities WHERE connector_id='linkedin-public' AND external_id=?"
    ).get(preview.profileUrl) as { id: string };
    db.prepare(`
      INSERT INTO source_records
        (id, connector_id, external_id, source_identity_id, person_id, entity_type, raw_json, captured_at)
      VALUES (?, 'linkedin-public', ?, ?, ?, 'public-profile-snapshot', ?, ?)
      ON CONFLICT(connector_id, external_id, entity_type) DO UPDATE SET
        source_identity_id=excluded.source_identity_id, person_id=excluded.person_id,
        raw_json=excluded.raw_json, captured_at=excluded.captured_at
    `).run(recordId, preview.profileUrl, storedIdentity.id, personId, JSON.stringify(snapshot), timestamp);
    updatePerson(
      personId,
      Object.fromEntries(selected.map((suggestion) => [suggestion.field, suggestion.value])),
      "linkedin-public"
    );
    db.prepare(
      "UPDATE connector_states SET permission_state='user-assisted', status='idle', last_sync_at=?, last_error=NULL, records_seen=records_seen+1, records_linked=records_linked+1 WHERE connector_id='linkedin-public'"
    ).run(timestamp);
    for (const suggestion of selected) {
      db.prepare(`
        UPDATE field_provenance SET source_record_id=?, confidence=?
        WHERE id=(
          SELECT id FROM field_provenance
          WHERE person_id=? AND connector_id='linkedin-public' AND field_name=?
          ORDER BY observed_at DESC LIMIT 1
        )
      `).run(preview.profileUrl, suggestion.confidence, personId, suggestion.field);
    }
  })();
  return { person: getPerson(personId), applied: selected, sourceRecordId: preview.profileUrl };
}
