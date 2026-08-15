import path from "node:path";
import { databasePath, db } from "../db.js";
import {
  FileCredentialVault,
  MacOSKeychainCredentialVault,
  type StringCredentialVault,
} from "../platform/security/credential-vault.js";

export const ASK_WRITERS = ["local", "anthropic", "openai"] as const;
export type AskWriterId = (typeof ASK_WRITERS)[number];

export type AskWriterSettings = {
  writer: AskWriterId;
  model: string | null;
  hasKey: boolean;
  envKey: boolean;
  disclosure: string;
};

const SETTINGS_KEY = "ask_writer";
const VAULT_PREFIX = "ask-writer";

const DEFAULT_MODELS: Record<Exclude<AskWriterId, "local">, string> = {
  anthropic: "claude-haiku-4-5",
  openai: "gpt-4o-mini",
};

const DISCLOSURE: Record<AskWriterId, string> = {
  local: "Answers stay on this Mac. Ollama never leaves loopback.",
  anthropic: "This question and matching profile, note, and message excerpts leave this Mac and are sent to Anthropic. Ask still does not write to your records.",
  openai: "This question and matching profile, note, and message excerpts leave this Mac and are sent to OpenAI. Ask still does not write to your records.",
};

function parseSettings(value: unknown): { writer: AskWriterId; model: string | null } {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const writer = ASK_WRITERS.includes(record.writer as AskWriterId)
    ? record.writer as AskWriterId
    : "local";
  const model = typeof record.model === "string" && record.model.trim() ? record.model.trim() : null;
  return { writer, model };
}

function readStoredSettings(): { writer: AskWriterId; model: string | null } {
  const row = db.prepare("SELECT value_json FROM app_settings WHERE key=?").get(SETTINGS_KEY) as
    | { value_json: string }
    | undefined;
  if (!row) return { writer: "local", model: null };
  try {
    return parseSettings(JSON.parse(row.value_json));
  } catch {
    return { writer: "local", model: null };
  }
}

function envWriter(): AskWriterId | null {
  const raw = String(process.env.NETT_ASK_WRITER || "").trim().toLocaleLowerCase();
  return ASK_WRITERS.includes(raw as AskWriterId) ? raw as AskWriterId : null;
}

function envKey(writer: AskWriterId): string | undefined {
  if (writer === "anthropic") {
    return process.env.NETT_ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  }
  if (writer === "openai") {
    return process.env.NETT_OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || undefined;
  }
  return undefined;
}

let vault: StringCredentialVault | null = null;

function writerVault(): StringCredentialVault {
  if (vault) return vault;
  if (process.platform === "darwin") {
    vault = new MacOSKeychainCredentialVault("com.nett.local.ask");
    return vault;
  }
  vault = new FileCredentialVault(path.join(path.dirname(databasePath), "ask-writer.secret"));
  return vault;
}

export function resetAskWriterVault(next?: StringCredentialVault): void {
  vault = next ?? null;
}

export async function getAskWriterKey(writer: AskWriterId): Promise<string | undefined> {
  if (writer === "local") return undefined;
  return envKey(writer) || writerVault().getString(`${VAULT_PREFIX}:${writer}`).catch(() => undefined);
}

export async function getAskWriterSettings(): Promise<AskWriterSettings> {
  const stored = readStoredSettings();
  const writer = envWriter() ?? stored.writer;
  const key = await getAskWriterKey(writer);
  return {
    writer,
    model: stored.model || (writer === "local" ? null : DEFAULT_MODELS[writer]),
    hasKey: Boolean(key),
    envKey: Boolean(envKey(writer)),
    disclosure: DISCLOSURE[writer],
  };
}

export async function setAskWriterSettings(input: {
  writer?: string;
  model?: string | null;
  apiKey?: string | null;
}): Promise<AskWriterSettings> {
  const current = readStoredSettings();
  const writer = ASK_WRITERS.includes(input.writer as AskWriterId)
    ? input.writer as AskWriterId
    : current.writer;
  const model = input.model === undefined
    ? current.model
    : (input.model?.trim() || null);
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,
      updated_at=excluded.updated_at
  `).run(SETTINGS_KEY, JSON.stringify({ writer, model }));

  if (writer !== "local" && input.apiKey !== undefined) {
    const key = input.apiKey?.trim() || "";
    if (key) await writerVault().setString(`${VAULT_PREFIX}:${writer}`, key);
    else await writerVault().delete(`${VAULT_PREFIX}:${writer}`).catch(() => false);
  }
  return getAskWriterSettings();
}

export function defaultCloudModel(writer: Exclude<AskWriterId, "local">): string {
  return DEFAULT_MODELS[writer];
}

export function askWriterDisclosure(writer: AskWriterId): string {
  return DISCLOSURE[writer];
}
