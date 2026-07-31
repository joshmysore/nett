import { db } from "./db.js";
import { messagesDatabaseStatus } from "./connectors.js";

export type SetupPhase = "welcome" | "contacts" | "messages" | "optional" | "complete";

type OnboardingState = {
  phase: SetupPhase;
  completedAt?: string;
  ownerDisplayName?: string;
  skippedSteps: string[];
};

const phases = new Set<SetupPhase>(["welcome", "contacts", "messages", "optional", "complete"]);
const skippableSteps = new Set(["contacts", "messages", "optional"]);

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

export function getOnboardingState(): OnboardingState {
  const stored = getAppSetting<Partial<OnboardingState>>("onboarding", {});
  return {
    phase: phases.has(stored.phase as SetupPhase) ? stored.phase as SetupPhase : "welcome",
    completedAt: stored.completedAt,
    ownerDisplayName: stored.ownerDisplayName,
    skippedSteps: Array.isArray(stored.skippedSteps)
      ? stored.skippedSteps.filter((step): step is string => typeof step === "string")
      : []
  };
}

export function updateOnboarding(input: Record<string, unknown>): OnboardingState {
  const current = getOnboardingState();
  const next: OnboardingState = { ...current, skippedSteps: [...current.skippedSteps] };

  if (input.phase !== undefined) {
    if (!phases.has(input.phase as SetupPhase)) throw new Error("Choose a valid setup step");
    next.phase = input.phase as SetupPhase;
  }
  if (input.ownerDisplayName !== undefined) {
    const ownerDisplayName = String(input.ownerDisplayName).trim();
    if (ownerDisplayName.length > 80) throw new Error("Owner name must be 80 characters or fewer");
    next.ownerDisplayName = ownerDisplayName || undefined;
  }
  if (input.skipStep !== undefined) {
    const step = String(input.skipStep);
    if (!skippableSteps.has(step)) throw new Error("That setup step cannot be skipped");
    next.skippedSteps = [...new Set([...next.skippedSteps, step])];
  }
  if (input.complete === true) {
    next.phase = "complete";
    next.completedAt = new Date().toISOString();
  }

  setAppSetting("onboarding", next);
  return next;
}

export function setupStatus() {
  const onboarding = getOnboardingState();
  const peopleCount = (db.prepare("SELECT COUNT(*) AS count FROM people").get() as { count: number }).count;
  const contacts = db.prepare(`
    SELECT permission_state, status, last_sync_at, records_seen, last_error
    FROM connector_states WHERE connector_id='apple-contacts'
  `).get() as Record<string, unknown> | undefined;
  const messages = db.prepare(`
    SELECT permission_state, status, last_sync_at, records_seen, last_error
    FROM connector_states WHERE connector_id='messages'
  `).get() as Record<string, unknown> | undefined;
  const messagesDb = messagesDatabaseStatus();

  const inferredExistingWorkspace = peopleCount > 0 && !onboarding.completedAt && onboarding.phase === "welcome";
  const isUsable = peopleCount > 0 || Boolean(onboarding.completedAt);
  const phase: SetupPhase = inferredExistingWorkspace ? "complete" : onboarding.phase;

  return {
    phase,
    isFirstRun: peopleCount === 0 && !onboarding.completedAt,
    isUsable,
    ownerDisplayName: onboarding.ownerDisplayName ?? null,
    completedAt: onboarding.completedAt ?? null,
    skippedSteps: onboarding.skippedSteps,
    milestones: {
      hasPeople: peopleCount > 0,
      peopleCount,
      contacts: {
        permission: String(contacts?.permission_state || "unknown"),
        status: String(contacts?.status || "idle"),
        synced: Boolean(contacts?.last_sync_at),
        seen: Number(contacts?.records_seen || 0),
        error: contacts?.last_error ? String(contacts.last_error) : null
      },
      messages: {
        readable: messagesDb.readable,
        usingLocalCopy: messagesDb.usingLocalCopy,
        messageCount: messagesDb.messageCount,
        status: String(messages?.status || "idle"),
        synced: Boolean(messages?.last_sync_at),
        seen: Number(messages?.records_seen || 0),
        error: messages?.last_error ? String(messages.last_error) : messagesDb.error
      }
    },
    nextAction: phase === "welcome"
      ? { step: "welcome", label: "Start local setup", route: "/setup" }
      : phase === "contacts"
        ? { step: "contacts", label: "Import Apple Contacts", route: "/setup" }
        : phase === "messages"
          ? { step: "messages", label: "Connect Messages", route: "/setup" }
          : null
  };
}
