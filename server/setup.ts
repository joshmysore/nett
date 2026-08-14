import { db } from "./db.js";
import { messagesDatabaseStatus } from "./connectors.js";

export type SetupPhase = "welcome" | "you" | "contacts" | "conversations" | "complete";

export type OwnerContext = {
  hometowns: string[];
  interests: string[];
  captureTranscript?: string;
};

type OnboardingState = {
  phase: SetupPhase;
  completedAt?: string;
  ownerDisplayName?: string;
  ownerHometowns: string[];
  ownerInterests: string[];
  ownerCaptureTranscript?: string;
  skippedSteps: string[];
  gmailReturnTo?: string;
};

const phases = new Set<SetupPhase>(["welcome", "you", "contacts", "conversations", "complete"]);
const legacyPhases: Record<string, SetupPhase> = {
  messages: "conversations",
  optional: "conversations",
};
const skippableSteps = new Set(["you", "contacts", "conversations", "messages", "optional"]);

function parse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function getAppSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value_json FROM app_settings WHERE key=?").get(key) as
    | { value_json: string }
    | undefined;
  return parse(row?.value_json, fallback);
}

export function setAppSetting(key: string, value: unknown): void {
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,
      updated_at=excluded.updated_at
  `).run(key, JSON.stringify(value));
}

function cleanStringList(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value) && typeof value !== "string") return [];
  const items = Array.isArray(value)
    ? value.map((item) => String(item ?? ""))
    : String(value).split(/[,;\n]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const next = item.replace(/\s+/g, " ").trim();
    if (next.length < 2 || next.length > maxLength) continue;
    const key = next.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizePhase(value: unknown): SetupPhase {
  const raw = String(value || "");
  if (phases.has(raw as SetupPhase)) return raw as SetupPhase;
  return legacyPhases[raw] ?? "welcome";
}

export function getOnboardingState(): OnboardingState {
  const stored = getAppSetting<Partial<OnboardingState> & { phase?: string }>("onboarding", {});
  return {
    phase: normalizePhase(stored.phase),
    completedAt: stored.completedAt,
    ownerDisplayName: stored.ownerDisplayName,
    ownerHometowns: cleanStringList(stored.ownerHometowns, 6, 80),
    ownerInterests: cleanStringList(stored.ownerInterests, 8, 60),
    ownerCaptureTranscript: typeof stored.ownerCaptureTranscript === "string"
      ? stored.ownerCaptureTranscript.slice(0, 4000)
      : undefined,
    skippedSteps: Array.isArray(stored.skippedSteps)
      ? stored.skippedSteps.filter((step): step is string => typeof step === "string")
      : [],
    gmailReturnTo: typeof stored.gmailReturnTo === "string" ? stored.gmailReturnTo : undefined,
  };
}

export function getOwnerContext(): OwnerContext {
  const onboarding = getOnboardingState();
  return {
    hometowns: onboarding.ownerHometowns,
    interests: onboarding.ownerInterests,
    captureTranscript: onboarding.ownerCaptureTranscript,
  };
}

export function updateOnboarding(input: Record<string, unknown>): OnboardingState {
  const current = getOnboardingState();
  const next: OnboardingState = { ...current, skippedSteps: [...current.skippedSteps] };

  if (input.phase !== undefined) {
    next.phase = normalizePhase(input.phase);
  }
  if (input.ownerDisplayName !== undefined) {
    const ownerDisplayName = String(input.ownerDisplayName).trim();
    if (ownerDisplayName.length > 80) throw new Error("Owner name must be 80 characters or fewer");
    next.ownerDisplayName = ownerDisplayName || undefined;
  }
  if (input.ownerHometowns !== undefined) {
    next.ownerHometowns = cleanStringList(input.ownerHometowns, 6, 80);
  }
  if (input.ownerInterests !== undefined) {
    next.ownerInterests = cleanStringList(input.ownerInterests, 8, 60);
  }
  if (input.ownerCaptureTranscript !== undefined) {
    const transcript = String(input.ownerCaptureTranscript);
    if (transcript.length > 4000) throw new Error("That recording is too long to keep as evidence");
    next.ownerCaptureTranscript = transcript.trim() || undefined;
  }
  if (input.gmailReturnTo !== undefined) {
    const path = String(input.gmailReturnTo).trim();
    if (path && !path.startsWith("/")) throw new Error("Return path must be local");
    next.gmailReturnTo = path || undefined;
  }
  if (input.skipStep !== undefined) {
    const step = String(input.skipStep);
    if (!skippableSteps.has(step)) throw new Error("That setup step cannot be skipped");
    next.skippedSteps = [...new Set([...next.skippedSteps, step])];
  }
  if (input.complete === true) {
    next.phase = "complete";
    next.completedAt = new Date().toISOString();
    next.gmailReturnTo = undefined;
  }

  setAppSetting("onboarding", next);
  return next;
}

function connectorMilestone(connectorId: string) {
  const row = db.prepare(`
    SELECT permission_state, status, last_sync_at, records_seen, last_error
    FROM connector_states WHERE connector_id=?
  `).get(connectorId) as Record<string, unknown> | undefined;
  return {
    permission: String(row?.permission_state || "unknown"),
    status: String(row?.status || "idle"),
    synced: Boolean(row?.last_sync_at),
    seen: Number(row?.records_seen || 0),
    error: row?.last_error ? String(row.last_error) : null,
  };
}

export function setupStatus() {
  const onboarding = getOnboardingState();
  const peopleCount = (db.prepare("SELECT COUNT(*) AS count FROM people").get() as { count: number }).count;
  const contacts = connectorMilestone("apple-contacts");
  const messages = connectorMilestone("messages");
  const gmail = connectorMilestone("gmail");
  const whatsapp = connectorMilestone("whatsapp");
  const messagesDb = messagesDatabaseStatus();

  const inferredExistingWorkspace = peopleCount > 0 && !onboarding.completedAt && onboarding.phase === "welcome";
  const isUsable = peopleCount > 0 || Boolean(onboarding.completedAt);
  const phase: SetupPhase = inferredExistingWorkspace ? "complete" : onboarding.phase;

  return {
    phase,
    isFirstRun: peopleCount === 0 && !onboarding.completedAt,
    isUsable,
    ownerDisplayName: onboarding.ownerDisplayName ?? null,
    ownerHometowns: onboarding.ownerHometowns,
    ownerInterests: onboarding.ownerInterests,
    ownerCaptureTranscript: onboarding.ownerCaptureTranscript ?? null,
    completedAt: onboarding.completedAt ?? null,
    skippedSteps: onboarding.skippedSteps,
    milestones: {
      hasPeople: peopleCount > 0,
      peopleCount,
      contacts,
      messages: {
        readable: messagesDb.readable,
        usingLocalCopy: messagesDb.usingLocalCopy,
        messageCount: messagesDb.messageCount,
        status: messages.status,
        synced: messages.synced,
        seen: messages.seen,
        error: messages.error ? messages.error : messagesDb.error,
      },
      gmail,
      whatsapp,
    },
    nextAction: phase === "welcome"
      ? { step: "welcome", label: "Start local setup", route: "/setup" }
      : phase === "you"
        ? { step: "you", label: "Add your hometowns and interests", route: "/setup" }
        : phase === "contacts"
          ? { step: "contacts", label: "Import Apple Contacts", route: "/setup" }
          : phase === "conversations"
            ? { step: "conversations", label: "Connect conversations", route: "/setup" }
            : null,
  };
}
