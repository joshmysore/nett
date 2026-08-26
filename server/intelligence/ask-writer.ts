import path from "node:path";
import { databasePath, db } from "../db.js";
import {
  FileCredentialVault,
  MacOSKeychainCredentialVault,
  type StringCredentialVault,
} from "../platform/security/credential-vault.js";

export const ASK_WRITERS = ["local", "openrouter"] as const;
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
const OPENROUTER_MODEL = "stealth/ox-alpha";
const LEGACY_HOSTED_WRITERS = new Set(["groq", "anthropic", "openai"]);

const DISCLOSURE: Record<AskWriterId, string> = {
  local: "Answers stay on this Mac. Matching records are not sent to a hosted model.",
  openrouter: "This question and matching profile, note, and message excerpts leave this Mac and are sent to OpenRouter, which forwards them to Ox Alpha (stealth/ox-alpha) — not Anthropic or OpenAI. The stealth provider retains prompts and completions and does not use them for training. Ask still does not write to your records.",
};

function coerceWriter(raw: unknown, fallback: AskWriterId = "local"): AskWriterId {
  if (raw === "local") return "local";
  if (raw === "openrouter" || LEGACY_HOSTED_WRITERS.has(String(raw))) return "openrouter";
  return fallback;
}

function parseSettings(value: unknown): { writer: AskWriterId; model: string | null } {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const writer = coerceWriter(record.writer);
  const model = writer === "openrouter" ? OPENROUTER_MODEL : null;
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
  if (!raw) return null;
  if (raw === "local") return "local";
  if (raw === "openrouter" || LEGACY_HOSTED_WRITERS.has(raw)) return "openrouter";
  return null;
}

function envKey(writer: AskWriterId): string | undefined {
  if (writer !== "openrouter") return undefined;
  return process.env.NETT_OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || undefined;
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
  const model = writer === "local" ? null : OPENROUTER_MODEL;
  return {
    writer,
    model,
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
  const writer = coerceWriter(input.writer, current.writer);
  const model = writer === "openrouter" ? OPENROUTER_MODEL : null;
  db.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value_json=excluded.value_json,
      updated_at=excluded.updated_at
  `).run(SETTINGS_KEY, JSON.stringify({ writer, model }));

  if (writer === "openrouter" && input.apiKey !== undefined) {
    const key = input.apiKey?.trim() || "";
    if (key) await writerVault().setString(`${VAULT_PREFIX}:openrouter`, key);
    else await writerVault().delete(`${VAULT_PREFIX}:openrouter`).catch(() => false);
  }
  return getAskWriterSettings();
}

export function defaultCloudModel(_writer?: string): string {
  return OPENROUTER_MODEL;
}

export function resolvedCloudModel(_writer?: string, _model?: string | null): string {
  return OPENROUTER_MODEL;
}

export function remoteEmbedModel(writer: AskWriterId): string | null {
  if (writer === "openrouter") return "openai/text-embedding-3-small";
  return null;
}

export function askWriterDisclosure(writer: AskWriterId, _model?: string | null): string {
  return DISCLOSURE[writer];
}
