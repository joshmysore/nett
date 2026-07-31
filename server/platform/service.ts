import { unzipSync } from "fflate";
import path from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { db, setConnectorState } from "../db.js";
import { GmailConnector } from "./connectors/gmail.js";
import { TelegramConnector } from "./connectors/telegram.js";
import {
  parseWhatsAppArchive,
  parseWhatsAppExport,
  type WhatsAppTextEntry,
  type WhatsAppZipExtractionPort
} from "./connectors/whatsapp-export.js";
import { ConnectorError, type ConnectorProgress, type IngestionCursor } from "./domain.js";
import { loadConnectorManifest } from "./mcp/manifest.js";
import { MacOSKeychainCredentialVault } from "./security/credential-vault.js";
import { SqliteAtomicIngestion } from "./sqlite-ingestion.js";

const vault = new MacOSKeychainCredentialVault("com.nett.local.connectors");
const ingestion = new SqliteAtomicIngestion(db);
const telegramInstances = new Map<string, TelegramConnector>();
const GMAIL_REDIRECT = `http://127.0.0.1:${Number(process.env.PORT || 4174)}/api/platform/gmail/callback`;

type AccountRow = {
  connector_id: string;
  account_id: string;
  account_label: string | null;
  credential_ref: string | null;
  auth_state: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
};

function json<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function account(connectorId: string, accountId: string): AccountRow | undefined {
  return db.prepare(
    "SELECT * FROM connector_accounts WHERE connector_id=? AND account_id=?"
  ).get(connectorId, accountId) as AccountRow | undefined;
}

function saveAccount(
  connectorId: string,
  accountId: string,
  values: {
    label?: string;
    credentialRef?: string;
    authState?: string;
    settings?: Record<string, unknown>;
  }
): void {
  const timestamp = new Date().toISOString();
  const existing = account(connectorId, accountId);
  const settings = { ...json(existing?.settings_json, {}), ...(values.settings ?? {}) };
  db.prepare(`
    INSERT INTO connector_accounts
      (connector_id, account_id, account_label, credential_ref, auth_state, settings_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connector_id, account_id) DO UPDATE SET
      account_label=COALESCE(excluded.account_label, connector_accounts.account_label),
      credential_ref=COALESCE(excluded.credential_ref, connector_accounts.credential_ref),
      auth_state=excluded.auth_state,
      settings_json=excluded.settings_json,
      updated_at=excluded.updated_at
  `).run(
    connectorId,
    accountId,
    values.label ?? existing?.account_label ?? null,
    values.credentialRef ?? existing?.credential_ref ?? null,
    values.authState ?? existing?.auth_state ?? "missing",
    JSON.stringify(settings),
    existing?.created_at ?? timestamp,
    timestamp
  );
}

function cursor(connectorId: string, accountId: string): IngestionCursor | undefined {
  const row = db.prepare(`
    SELECT cursor_json FROM sync_cursors
    WHERE connector_id=? AND account_id=?
    ORDER BY updated_at DESC LIMIT 1
  `).get(connectorId, accountId) as { cursor_json: string } | undefined;
  return row ? json<IngestionCursor | undefined>(row.cursor_json, undefined) : undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof ConnectorError) return `${error.message}${error.retryable ? " You can retry." : ""}`;
  return error instanceof Error ? error.message : String(error);
}

function progress(connectorId: string, accountId: string) {
  return (value: ConnectorProgress) => {
    saveAccount(connectorId, accountId, { settings: { progress: value } });
  };
}

function gmailFor(accountId: string): GmailConnector {
  const row = account("gmail", accountId);
  const settings = json<Record<string, unknown>>(row?.settings_json, {});
  const clientId = String(settings.clientId || process.env.GOOGLE_CLIENT_ID || "");
  if (!clientId) {
    throw new ConnectorError({
      code: "INVALID_CONFIGURATION",
      message: "Add a Google OAuth desktop client ID before connecting Gmail.",
      retryable: false
    });
  }
  return new GmailConnector({
    clientId,
    redirectUri: GMAIL_REDIRECT,
    clientSecretVaultKey: `gmail:${accountId}:client-secret`,
    maxInitialMessages: Number(settings.maxInitialMessages || 2_000)
  }, vault);
}

function telegramFor(accountId: string): TelegramConnector {
  const existing = telegramInstances.get(accountId);
  if (existing) return existing;
  const row = account("telegram", accountId);
  const settings = json<Record<string, unknown>>(row?.settings_json, {});
  const apiId = Number(settings.apiId);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    throw new ConnectorError({
      code: "INVALID_CONFIGURATION",
      message: "Add your Telegram api_id and api_hash before connecting.",
      retryable: false
    });
  }
  const connector = new TelegramConnector({
    apiId,
    apiHashVaultKey: `telegram:${accountId}:api-hash`,
    maxInitialMessages: Number(settings.maxInitialMessages || 2_000)
  }, vault);
  telegramInstances.set(accountId, connector);
  return connector;
}

export function connectorPlatformStatus() {
  const rows = db.prepare(
    "SELECT * FROM connector_accounts ORDER BY connector_id, account_label, account_id"
  ).all() as AccountRow[];
  return rows.map((row) => ({
    connectorId: row.connector_id,
    accountId: row.account_id,
    accountLabel: row.account_label,
    authState: row.auth_state,
    settings: json(row.settings_json, {}),
    updatedAt: row.updated_at
  }));
}

export async function configureGmail(input: {
  accountId?: string;
  accountLabel?: string;
  clientId: string;
  clientSecret?: string;
  maxInitialMessages?: number;
}) {
  const accountId = input.accountId?.trim() || "primary";
  if (!input.clientId?.trim()) throw new Error("Google OAuth client ID is required");
  if (input.clientSecret?.trim()) {
    await vault.setString(`gmail:${accountId}:client-secret`, input.clientSecret.trim());
  }
  saveAccount("gmail", accountId, {
    label: input.accountLabel?.trim() || "Gmail",
    credentialRef: `keychain:gmail:${accountId}`,
    authState: "missing",
    settings: {
      clientId: input.clientId.trim(),
      maxInitialMessages: Math.min(Math.max(Number(input.maxInitialMessages || 2_000), 50), 10_000)
    }
  });
  setConnectorState("gmail", { permission: "unknown", status: "idle" });
  return { accountId, redirectUri: GMAIL_REDIRECT };
}

export async function beginGmailAuthorization(accountId = "primary") {
  const connector = gmailFor(accountId);
  const authorization = await connector.beginAuthorization(accountId);
  saveAccount("gmail", accountId, {
    authState: "pending-user",
    settings: { oauthState: authorization.state }
  });
  return authorization;
}

export async function finishGmailAuthorization(code: string, state: string) {
  const rows = db.prepare(
    "SELECT * FROM connector_accounts WHERE connector_id='gmail' AND auth_state='pending-user' ORDER BY updated_at DESC"
  ).all() as AccountRow[];
  const row = rows.find((candidate) => json<Record<string, unknown>>(candidate.settings_json, {}).oauthState === state);
  if (!row) throw new Error("The Gmail authorization request is unknown or expired.");
  await gmailFor(row.account_id).finishAuthorization(row.account_id, code, state);
  saveAccount("gmail", row.account_id, { authState: "authenticated", settings: { oauthState: null } });
  setConnectorState("gmail", { permission: "granted", status: "success" });
  return row.account_id;
}

export async function syncGmail(accountId = "primary") {
  const connector = gmailFor(accountId);
  const existingCursor = cursor("gmail", accountId);
  setConnectorState("gmail", { permission: "granted", status: "syncing" });
  try {
    const result = await connector.sync({
      accountId,
      mode: existingCursor ? "incremental" : "initial",
      cursor: existingCursor
    }, {
      ingestion,
      reportProgress: progress("gmail", accountId)
    });
    saveAccount("gmail", accountId, { authState: "authenticated", settings: { progress: null } });
    setConnectorState("gmail", {
      permission: "granted",
      status: "success",
      seen: result.recordsSeen,
      linked: result.recordsSeen
    });
    return {
      ...result,
      message: `Read ${result.recordsSeen} Gmail records locally${result.partial ? " (bounded partial sync)" : ""}.`
    };
  } catch (error) {
    setConnectorState("gmail", { permission: "blocked", status: "error", error: errorMessage(error) });
    throw error;
  }
}

export async function disconnectGmail(accountId = "primary") {
  await gmailFor(accountId).revokeLocalAuthorization(accountId);
  saveAccount("gmail", accountId, { authState: "revoked" });
  setConnectorState("gmail", { permission: "unknown", status: "idle" });
}

export async function configureTelegram(input: {
  accountId?: string;
  accountLabel?: string;
  apiId: number;
  apiHash: string;
  maxInitialMessages?: number;
}) {
  const accountId = input.accountId?.trim() || "primary";
  if (!Number.isInteger(Number(input.apiId)) || Number(input.apiId) <= 0) throw new Error("Telegram api_id must be a positive integer");
  if (!input.apiHash?.trim()) throw new Error("Telegram api_hash is required");
  await vault.setString(`telegram:${accountId}:api-hash`, input.apiHash.trim());
  saveAccount("telegram", accountId, {
    label: input.accountLabel?.trim() || "Telegram",
    credentialRef: `keychain:telegram:${accountId}`,
    authState: "missing",
    settings: {
      apiId: Number(input.apiId),
      maxInitialMessages: Math.min(Math.max(Number(input.maxInitialMessages || 2_000), 50), 20_000)
    }
  });
  telegramInstances.delete(accountId);
  setConnectorState("telegram", { permission: "unknown", status: "idle" });
  return { accountId };
}

export async function beginTelegramAuthorization(accountId: string, phone: string) {
  const step = await telegramFor(accountId).beginPhoneAuthorization(accountId, phone);
  saveAccount("telegram", accountId, { authState: "pending-user", settings: { phone } });
  return step;
}

export async function submitTelegramOtp(accountId: string, otp: string) {
  const step = await telegramFor(accountId).submitOtp(accountId, otp);
  if (step.step === "complete") {
    saveAccount("telegram", accountId, { authState: "authenticated" });
    setConnectorState("telegram", { permission: "granted", status: "success" });
  }
  return step;
}

export async function submitTelegramPassword(accountId: string, password: string) {
  const step = await telegramFor(accountId).submitTwoFactorPassword(accountId, password);
  saveAccount("telegram", accountId, { authState: "authenticated" });
  setConnectorState("telegram", { permission: "granted", status: "success" });
  return step;
}

export async function syncTelegram(accountId = "primary") {
  const connector = telegramFor(accountId);
  const existingCursor = cursor("telegram", accountId);
  setConnectorState("telegram", { permission: "granted", status: "syncing" });
  try {
    const result = await connector.sync({
      accountId,
      mode: existingCursor ? "incremental" : "initial",
      cursor: existingCursor
    }, {
      ingestion,
      reportProgress: progress("telegram", accountId)
    });
    saveAccount("telegram", accountId, { authState: "authenticated", settings: { progress: null } });
    setConnectorState("telegram", {
      permission: "granted",
      status: "success",
      seen: result.recordsSeen,
      linked: result.recordsSeen
    });
    return { ...result, message: `Read ${result.recordsSeen} Telegram records locally.` };
  } catch (error) {
    setConnectorState("telegram", { permission: "blocked", status: "error", error: errorMessage(error) });
    throw error;
  }
}

export async function disconnectTelegram(accountId = "primary") {
  await telegramFor(accountId).revokeLocalAuthorization(accountId);
  telegramInstances.delete(accountId);
  saveAccount("telegram", accountId, { authState: "revoked" });
  setConnectorState("telegram", { permission: "unknown", status: "idle" });
}

class FflateZipExtractor implements WhatsAppZipExtractionPort {
  async extractTextEntries(
    archive: Uint8Array,
    options: { maxEntries?: number; maxUncompressedBytes?: number } = {}
  ): Promise<WhatsAppTextEntry[]> {
    const files = unzipSync(archive);
    const names = Object.keys(files);
    if (names.length > (options.maxEntries ?? 100)) throw new Error("WhatsApp archive contains too many files");
    let bytes = 0;
    const decoder = new TextDecoder();
    return names.flatMap((name) => {
      const value = files[name];
      bytes += value.byteLength;
      if (bytes > (options.maxUncompressedBytes ?? 64 * 1024 * 1024)) {
        throw new Error("WhatsApp archive is too large after extraction");
      }
      if (!name.toLocaleLowerCase().endsWith(".txt")) return [];
      return [{ name: path.basename(name), text: decoder.decode(value) }];
    });
  }
}

export async function importWhatsApp(input: {
  buffer: Buffer;
  filename: string;
  accountId?: string;
  conversationId?: string;
  conversationTitle?: string;
  selfNames?: string[];
  selfPhones?: string[];
  dateOrder?: "DMY" | "MDY" | "YMD";
}) {
  const accountId = input.accountId?.trim() || "personal";
  const baseOptions = {
    accountId,
    conversationExternalId: input.conversationId?.trim() || path.parse(input.filename).name,
    conversationTitle: input.conversationTitle?.trim() || path.parse(input.filename).name,
    selfNames: input.selfNames,
    selfPhones: input.selfPhones,
    dateOrder: input.dateOrder,
    sourceFileName: input.filename
  };
  const bundles = input.filename.toLocaleLowerCase().endsWith(".zip")
    ? await parseWhatsAppArchive(
      input.buffer,
      new FflateZipExtractor(),
      (entry) => ({
        ...baseOptions,
        conversationExternalId: `${baseOptions.conversationExternalId}:${entry.name}`,
        conversationTitle: input.conversationTitle?.trim() || path.parse(entry.name).name,
        sourceFileName: entry.name
      })
    )
    : [parseWhatsAppExport(input.buffer.toString("utf8"), baseOptions)];
  let recordsSeen = 0;
  for (const bundle of bundles) {
    await ingestion.ingest(bundle);
    recordsSeen += bundle.interactions.length;
  }
  saveAccount("whatsapp-export", accountId, {
    label: "WhatsApp exports",
    authState: "not-required",
    settings: { lastFile: input.filename, lastImportAt: new Date().toISOString() }
  });
  setConnectorState("whatsapp", {
    permission: "granted",
    status: "success",
    seen: recordsSeen,
    linked: recordsSeen
  });
  return { recordsSeen, bundles: bundles.length, message: `Imported ${recordsSeen} WhatsApp messages from ${bundles.length} conversation export${bundles.length === 1 ? "" : "s"}.` };
}

export async function mcpPlatformStatus() {
  const manifestPath = process.env.NETT_MCP_MANIFEST;
  if (!manifestPath) return { configured: false, servers: [] };
  if (!existsSync(manifestPath)) return { configured: true, error: "Manifest file does not exist", servers: [] };
  const manifest = await loadConnectorManifest(manifestPath);
  return {
    configured: true,
    servers: manifest.servers.map(({ id, displayName, enabled }) => ({ id, displayName, enabled }))
  };
}

export function createConnectorAccountId() {
  return randomUUID();
}
