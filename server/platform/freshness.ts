import { connectorSettings, connectorStates, updateConnectorSettings } from "../db.js";

export type FreshnessConnectorId = "apple-contacts" | "messages" | "whatsapp" | "gmail";

export type FreshnessStatus = {
  enabled: boolean;
  running: FreshnessConnectorId | null;
  queued: boolean;
  lastTickAt: string | null;
  intervalsMs: Record<FreshnessConnectorId, number>;
  lastResults: Partial<
    Record<FreshnessConnectorId, { at: string; ok: boolean; message?: string; error?: string }>
  >;
  nextDue: Partial<Record<FreshnessConnectorId, string | null>>;
  constraint: string;
};

type SyncRunner = (
  connectorId: FreshnessConnectorId,
  signal: AbortSignal,
) => Promise<{ message?: string; done?: boolean } | void>;

/** Local-only idle pulls. WhatsApp/Messages need the Mac awake and Nett running. */
export const INTERVAL_MS: Record<FreshnessConnectorId, number> = {
  "apple-contacts": 60 * 60 * 1000,
  messages: 6 * 60 * 60 * 1000,
  whatsapp: 6 * 60 * 60 * 1000,
  gmail: 60 * 60 * 1000,
};

const FRESHNESS_SETTINGS_ID = "__freshness__";
const CONSTRAINT =
  "Runs only while Nett is open and this Mac is awake. Sleep, quit, or locked Full Disk Access skips a cycle — nothing syncs from the cloud.";

function envFreshnessOverride(): boolean | null {
  const raw = process.env.NETT_FRESHNESS?.trim();
  if (raw === "1" || raw?.toLowerCase() === "true") return true;
  if (raw === "0" || raw?.toLowerCase() === "false") return false;
  return null;
}

function readPersistedEnabled(): boolean {
  const override = envFreshnessOverride();
  if (override !== null) return override;
  try {
    return connectorSettings(FRESHNESS_SETTINGS_ID).enabled === true;
  } catch {
    return false;
  }
}

/** Opt-in only. Auto sync can block the API because better-sqlite3 is synchronous. */
let enabled = false;
let timer: ReturnType<typeof setInterval> | null = null;
let running: FreshnessConnectorId | null = null;
let queued = false;
let lastTickAt: string | null = null;
const lastResults: FreshnessStatus["lastResults"] = {};
const lastAttempt = new Map<FreshnessConnectorId, number>();
let runner: SyncRunner | null = null;
let isBusy: ((id: string) => boolean) | null = null;
let readyCheck: ((id: FreshnessConnectorId) => Promise<boolean> | boolean) | null = null;
let started = false;

function due(id: FreshnessConnectorId): boolean {
  const previous = lastAttempt.get(id) ?? 0;
  return Date.now() - previous >= INTERVAL_MS[id];
}

function yieldEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function ensureTimer() {
  if (!started || !enabled || timer) return;
  const seeded = Date.now();
  for (const id of Object.keys(INTERVAL_MS) as FreshnessConnectorId[]) {
    if (!lastAttempt.has(id)) lastAttempt.set(id, seeded);
  }
  timer = setInterval(() => {
    void tick();
  }, 60_000);
}

function clearTimer() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function freshnessStatus(): FreshnessStatus {
  const nextDue: FreshnessStatus["nextDue"] = {};
  for (const id of Object.keys(INTERVAL_MS) as FreshnessConnectorId[]) {
    const previous = lastAttempt.get(id);
    nextDue[id] = previous && enabled
      ? new Date(previous + INTERVAL_MS[id]).toISOString()
      : null;
  }
  return {
    enabled,
    running,
    queued,
    lastTickAt,
    intervalsMs: { ...INTERVAL_MS },
    lastResults: { ...lastResults },
    nextDue,
    constraint: CONSTRAINT,
  };
}

export function setFreshnessEnabled(value: boolean) {
  enabled = value;
  try {
    const existing = connectorSettings(FRESHNESS_SETTINGS_ID);
    updateConnectorSettings(FRESHNESS_SETTINGS_ID, {
      ...existing,
      enabled: value,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Persistence is best-effort; in-memory toggle still applies for this process.
  }
  if (value) ensureTimer();
  else clearTimer();
  return freshnessStatus();
}

async function runOne(id: FreshnessConnectorId): Promise<void> {
  if (!runner || !isBusy || running || isBusy(id)) return;
  if (readyCheck && !(await readyCheck(id))) {
    lastAttempt.set(id, Date.now());
    lastResults[id] = { at: new Date().toISOString(), ok: false, error: "Source not ready" };
    return;
  }
  running = id;
  lastAttempt.set(id, Date.now());
  const controller = new AbortController();
  try {
    const result = await runner(id, controller.signal);
    lastResults[id] = {
      at: new Date().toISOString(),
      ok: true,
      message: result && "message" in (result || {}) ? String(result?.message || "") : "Synced",
    };
  } catch (error) {
    lastResults[id] = {
      at: new Date().toISOString(),
      ok: false,
      error: error instanceof Error ? error.message : "Sync failed",
    };
  } finally {
    running = null;
    await yieldEventLoop();
  }
}

async function tick() {
  if (!enabled || !runner || !isBusy || running || queued) return;
  lastTickAt = new Date().toISOString();
  const states = connectorStates() as {
    connector_id: string;
    permission_state: string;
    last_sync_at?: string | null;
  }[];
  // Never auto-run Apple Contacts — full export blocks the API for minutes.
  const order: FreshnessConnectorId[] = ["messages", "whatsapp", "gmail"];
  for (const id of order) {
    if (!due(id) || isBusy(id)) continue;
    const state = states.find((row) => row.connector_id === id);
    if (id === "gmail" && !state?.last_sync_at) continue;
    await runOne(id);
    break;
  }
}

export function startFreshnessAgent(options: {
  sync: SyncRunner;
  isBusy: (id: string) => boolean;
  ready?: (id: FreshnessConnectorId) => Promise<boolean> | boolean;
}) {
  runner = options.sync;
  isBusy = options.isBusy;
  readyCheck = options.ready ?? null;
  started = true;
  enabled = readPersistedEnabled();
  if (enabled) ensureTimer();
}

export function stopFreshnessAgent() {
  clearTimer();
  started = false;
}

/**
 * Queue a sync and return immediately so HTTP stays responsive.
 * Does not include Apple Contacts (use Sources → Pull for that).
 */
export function queueFreshnessNow(connectorId?: FreshnessConnectorId) {
  if (!runner || !isBusy) throw new Error("Freshness agent is not started");
  if (queued || running) {
    return { accepted: false, message: "A sync is already running or queued" };
  }
  queued = true;
  const ids = connectorId
    ? [connectorId]
    : (["messages", "whatsapp", "gmail"] as FreshnessConnectorId[]);
  setImmediate(() => {
    void (async () => {
      try {
        for (const id of ids) {
          await runOne(id);
          await yieldEventLoop();
        }
      } finally {
        queued = false;
      }
    })();
  });
  return { accepted: true, message: "Sync queued — the API stays responsive while it runs" };
}

/** @deprecated Prefer queueFreshnessNow — this blocks until done. */
export async function runFreshnessNow(connectorId?: FreshnessConnectorId) {
  const queuedResult = queueFreshnessNow(connectorId);
  return { results: {}, ...queuedResult };
}
