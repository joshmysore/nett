import { createHash, randomUUID } from "node:crypto";
import type { StringCredentialVault } from "../security/credential-vault.js";
import {
  ConnectorError,
  type ConnectorAdapter,
  type ConnectorDescriptor,
  type ConnectorState,
  type ConnectorSyncContext,
  type ConnectorSyncRequest,
  type ConnectorSyncResult,
  type IngestionCursor,
  type NormalizedConversation,
  type NormalizedInteraction,
  type NormalizedSourceIdentity
} from "../domain.js";

type DynamicImporter = (specifier: string) => Promise<Record<string, any>>;
const runtimeImport: DynamicImporter = new Function("specifier", "return import(specifier)") as DynamicImporter;

export interface TelegramConnectorConfig {
  apiId: number;
  apiHashVaultKey: string;
  maxDialogs?: number;
  maxInitialMessages?: number;
  connectionRetries?: number;
}

export type TelegramAuthStep =
  | { step: "otp"; phoneCodeHash: string }
  | { step: "password" }
  | { step: "complete" };

interface PendingAuthorization {
  accountId: string;
  phone: string;
  phoneCodeHash: string;
  client: any;
  apiHash: string;
}

interface TelegramRuntime {
  TelegramClient: new (...args: any[]) => any;
  StringSession: new (session: string) => { save(): string };
  Api: Record<string, any>;
}

function stableId(...parts: string[]): string {
  return `telegram:${createHash("sha256").update(parts.join("\0")).digest("hex")}`;
}

function externalId(value: unknown): string {
  if (value && typeof value === "object" && "value" in value) return String((value as { value: unknown }).value);
  return String(value ?? "");
}

function entityName(entity: any): string {
  return [entity?.firstName, entity?.lastName].filter(Boolean).join(" ").trim()
    || entity?.title
    || entity?.username
    || externalId(entity?.id)
    || "Unknown Telegram user";
}

function telegramDate(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString();
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : undefined;
}

function identity(accountId: string, entity: any, selfId: string): NormalizedSourceIdentity | undefined {
  const id = externalId(entity?.id);
  if (!id) return undefined;
  const addresses: NormalizedSourceIdentity["addresses"] = [];
  if (entity?.username) {
    const username = String(entity.username).replace(/^@/, "").toLowerCase();
    addresses.push({ kind: "username", value: `@${entity.username}`, normalized: username });
  }
  if (entity?.phone) {
    const phone = `+${String(entity.phone).replace(/\D/g, "")}`;
    addresses.push({ kind: "phone", value: phone, normalized: phone, verified: id === selfId });
  }
  return {
    source: "telegram",
    externalId: id,
    stableId: stableId(accountId, "identity", id),
    displayName: entityName(entity),
    givenName: entity?.firstName || undefined,
    familyName: entity?.lastName || undefined,
    isSelf: id === selfId,
    addresses,
    rawRef: `tg://user?id=${encodeURIComponent(id)}`
  };
}

function classifyTelegramError(error: unknown, operation: string): ConnectorError {
  const message = error instanceof Error ? error.message : String(error);
  const flood = /FLOOD_WAIT_?(\d+)/i.exec(message);
  if (flood) {
    return new ConnectorError({
      code: "RATE_LIMITED",
      message: "Telegram requested a temporary backoff",
      retryable: true,
      retryAfterMs: Number(flood[1]) * 1000,
      operation,
      cause: error
    });
  }
  if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|USER_DEACTIVATED/i.test(message)) {
    return new ConnectorError({ code: "AUTH_REVOKED", message: "Telegram session is no longer authorized", retryable: false, operation, cause: error });
  }
  if (/PHONE_CODE_INVALID|PHONE_CODE_EXPIRED|PASSWORD_HASH_INVALID/i.test(message)) {
    return new ConnectorError({ code: "AUTH_REQUIRED", message: "Telegram verification failed", retryable: false, operation, cause: error });
  }
  return new ConnectorError({ code: "SOURCE_UNAVAILABLE", message: `Telegram ${operation} failed`, retryable: true, operation, cause: error });
}

export class TelegramConnector implements ConnectorAdapter {
  readonly descriptor: ConnectorDescriptor = {
    id: "telegram",
    displayName: "Telegram",
    version: "1.0.0",
    capabilities: [
      { resource: "identities", mode: "incremental", readOnly: true },
      { resource: "conversations", mode: "incremental", readOnly: true },
      { resource: "interactions", mode: "incremental", readOnly: true }
    ]
  };
  private state: ConnectorState = { lifecycle: "unconfigured", auth: "missing", status: "idle" };
  private pending?: PendingAuthorization;

  constructor(
    private readonly config: TelegramConnectorConfig,
    private readonly vault: StringCredentialVault
  ) {}

  async getState(): Promise<ConnectorState> {
    return { ...this.state };
  }

  async beginPhoneAuthorization(accountId: string, phone: string): Promise<TelegramAuthStep> {
    const normalizedPhone = phone.trim().replace(/[^\d+]/g, "");
    if (!/^\+\d{7,15}$/.test(normalizedPhone)) {
      throw new ConnectorError({ code: "INVALID_CONFIGURATION", message: "Telegram phone number must include a country code", retryable: false });
    }
    const runtime = await this.runtime();
    const apiHash = await this.requiredApiHash();
    const sessionValue = await this.vault.getString(this.sessionKey(accountId)) ?? "";
    const session = new runtime.StringSession(sessionValue);
    const client = new runtime.TelegramClient(session, this.config.apiId, apiHash, {
      connectionRetries: this.config.connectionRetries ?? 5,
      autoReconnect: true
    });
    try {
      await client.connect();
      const sent = await client.sendCode({ apiId: this.config.apiId, apiHash }, normalizedPhone);
      this.pending = {
        accountId,
        phone: normalizedPhone,
        phoneCodeHash: String(sent.phoneCodeHash),
        client,
        apiHash
      };
      await this.persistClientSession(accountId, client);
      this.state = { lifecycle: "authorizing", auth: "pending-user", status: "idle" };
      return { step: "otp", phoneCodeHash: String(sent.phoneCodeHash) };
    } catch (error) {
      await client.disconnect().catch(() => undefined);
      throw classifyTelegramError(error, "send-code");
    }
  }

  async submitOtp(accountId: string, otp: string): Promise<TelegramAuthStep> {
    const pending = this.requirePending(accountId);
    const runtime = await this.runtime();
    try {
      await pending.client.invoke(new runtime.Api.auth.SignIn({
        phoneNumber: pending.phone,
        phoneCodeHash: pending.phoneCodeHash,
        phoneCode: otp.trim()
      }));
      await this.completeAuthorization(pending);
      return { step: "complete" };
    } catch (error) {
      if (/SESSION_PASSWORD_NEEDED/i.test(error instanceof Error ? error.message : String(error))) {
        await this.persistClientSession(accountId, pending.client);
        return { step: "password" };
      }
      throw classifyTelegramError(error, "verify-code");
    }
  }

  async submitTwoFactorPassword(accountId: string, password: string): Promise<TelegramAuthStep> {
    const pending = this.requirePending(accountId);
    try {
      await pending.client.signInWithPassword(
        { apiId: this.config.apiId, apiHash: pending.apiHash },
        {
          password: async () => password,
          onError: async (error: unknown) => { throw error; }
        }
      );
      await this.completeAuthorization(pending);
      return { step: "complete" };
    } catch (error) {
      throw classifyTelegramError(error, "verify-password");
    }
  }

  async cancelAuthorization(): Promise<void> {
    const pending = this.pending;
    this.pending = undefined;
    await pending?.client.disconnect().catch(() => undefined);
    this.state = { lifecycle: "unconfigured", auth: "missing", status: "idle" };
  }

  async revokeLocalAuthorization(accountId: string): Promise<void> {
    await this.vault.delete(this.sessionKey(accountId));
    this.state = { lifecycle: "revoked", auth: "revoked", status: "idle" };
  }

  async sync(request: ConnectorSyncRequest, context: ConnectorSyncContext): Promise<ConnectorSyncResult> {
    this.state = { lifecycle: "syncing", auth: "authenticated", status: "running", lastAttemptAt: new Date().toISOString() };
    const runtime = await this.runtime();
    const apiHash = await this.requiredApiHash();
    const sessionValue = await this.vault.getString(this.sessionKey(request.accountId));
    if (!sessionValue) throw new ConnectorError({ code: "AUTH_REQUIRED", message: "Telegram is not authorized", retryable: false });
    const session = new runtime.StringSession(sessionValue);
    const client = new runtime.TelegramClient(session, this.config.apiId, apiHash, {
      connectionRetries: this.config.connectionRetries ?? 5,
      autoReconnect: true
    });

    try {
      await client.connect();
      if (!await client.isUserAuthorized()) {
        throw new ConnectorError({ code: "AUTH_REQUIRED", message: "Telegram session requires authorization", retryable: false });
      }
      const self = await client.getMe();
      const selfId = externalId(self.id);
      const selfIdentity = identity(request.accountId, self, selfId);
      const identityMap = new Map<string, NormalizedSourceIdentity>();
      if (selfIdentity) identityMap.set(selfIdentity.stableId, selfIdentity);
      const conversations: NormalizedConversation[] = [];
      const interactions: NormalizedInteraction[] = [];
      const previous = this.parseCursor(request.cursor);
      const next: Record<string, string> = { ...previous };
      const maxMessages = Math.min(
        Math.max(request.maxRecords ?? this.config.maxInitialMessages ?? 2_000, 1),
        20_000
      );
      const maxDialogs = Math.min(Math.max(this.config.maxDialogs ?? 200, 1), 1_000);

      let dialogsSeen = 0;
      for await (const dialog of client.iterDialogs({ limit: maxDialogs })) {
        if (interactions.length >= maxMessages) break;
        dialogsSeen++;
        const dialogId = externalId(dialog.id ?? dialog.entity?.id);
        if (!dialogId) continue;
        const peerIdentity = dialog.isGroup || dialog.isChannel
          ? undefined
          : identity(request.accountId, dialog.entity, selfId);
        if (peerIdentity) identityMap.set(peerIdentity.stableId, peerIdentity);
        const participantIds = [
          selfIdentity?.stableId,
          peerIdentity?.stableId
        ].filter((value): value is string => Boolean(value));
        const conversationParticipantIds = new Set(participantIds);
        const conversationStableId = stableId(request.accountId, "dialog", dialogId);
        const normalizedConversation: NormalizedConversation = {
          source: "telegram",
          externalId: dialogId,
          stableId: conversationStableId,
          title: dialog.title || entityName(dialog.entity),
          kind: dialog.isGroup || dialog.isChannel ? (dialog.isChannel ? "channel" : "group") : "direct",
          participants: participantIds.map((identityStableId) => ({
            identityStableId,
            role: identityStableId === selfIdentity?.stableId ? "self" : "member"
          })),
          updatedAt: telegramDate(dialog.date),
          rawRef: `tg://resolve?domain=${encodeURIComponent(dialog.entity?.username ?? dialogId)}`
        };
        conversations.push(normalizedConversation);
        const remaining = maxMessages - interactions.length;
        const options: Record<string, unknown> = { limit: remaining, reverse: request.mode === "incremental" };
        if (request.mode === "incremental" && previous[dialogId]) options.minId = Number(previous[dialogId]);

        for await (const message of client.iterMessages(dialog.entity, options)) {
          const messageId = externalId(message.id);
          if (!messageId) continue;
          const senderEntity = message.sender ?? (message.out ? self : dialog.entity);
          const senderIdentity = identity(request.accountId, senderEntity, selfId);
          if (senderIdentity) identityMap.set(senderIdentity.stableId, senderIdentity);
          if (senderIdentity) conversationParticipantIds.add(senderIdentity.stableId);
          const occurredAt = telegramDate(message.date) ?? new Date(0).toISOString();
          normalizedConversation.participants = [...conversationParticipantIds].map((identityStableId) => ({
            identityStableId,
            role: identityStableId === selfIdentity?.stableId ? "self" : "member"
          }));
          interactions.push({
            source: "telegram",
            externalId: `${dialogId}:${messageId}`,
            stableId: stableId(request.accountId, "message", dialogId, messageId),
            conversationStableId,
            senderIdentityStableId: senderIdentity?.stableId,
            participantIdentityStableIds: [...conversationParticipantIds],
            direction: message.out ? "outgoing" : "incoming",
            kind: "message",
            occurredAt,
            text: typeof message.message === "string" ? message.message : undefined,
            inReplyToStableId: message.replyTo?.replyToMsgId
              ? stableId(request.accountId, "message", dialogId, externalId(message.replyTo.replyToMsgId))
              : undefined,
            rawRef: `tg://message?dialog=${encodeURIComponent(dialogId)}&id=${encodeURIComponent(messageId)}`
          });
          if (!next[dialogId] || BigInt(messageId) > BigInt(next[dialogId])) next[dialogId] = messageId;
          if (interactions.length >= maxMessages) break;
        }
        await context.reportProgress?.({
          phase: "fetch",
          completed: interactions.length,
          total: maxMessages,
          unit: "records",
          message: `Read ${dialogsSeen} Telegram dialogs`,
          observedAt: new Date().toISOString()
        });
      }

      const cursor: IngestionCursor = {
        connectorId: "telegram",
        scope: request.accountId,
        value: JSON.stringify(next),
        version: 1,
        observedAt: new Date().toISOString()
      };
      await context.ingestion.ingest({
        connectorId: "telegram",
        accountId: request.accountId,
        batchId: randomUUID(),
        capturedAt: new Date().toISOString(),
        identities: [...identityMap.values()],
        conversations,
        interactions,
        nextCursor: cursor,
        completeSnapshot: request.mode === "initial" && interactions.length < maxMessages
      }, { signal: context.signal });
      await this.persistClientSession(request.accountId, client);
      this.state = {
        lifecycle: "ready",
        auth: "authenticated",
        status: interactions.length >= maxMessages ? "partial" : "succeeded",
        lastAttemptAt: this.state.lastAttemptAt,
        lastSuccessAt: new Date().toISOString()
      };
      return {
        bundles: 1,
        recordsSeen: interactions.length,
        finalCursor: cursor,
        partial: interactions.length >= maxMessages
      };
    } catch (error) {
      const classified = error instanceof ConnectorError ? error : classifyTelegramError(error, "sync");
      this.state = {
        lifecycle: "error",
        auth: classified.code === "AUTH_REQUIRED" || classified.code === "AUTH_REVOKED" ? "expired" : "authenticated",
        status: "failed",
        lastAttemptAt: this.state.lastAttemptAt,
        error: {
          code: classified.code,
          message: classified.message,
          retryable: classified.retryable,
          retryAfterMs: classified.retryAfterMs,
          operation: classified.operation
        }
      };
      throw classified;
    } finally {
      await client.disconnect().catch(() => undefined);
    }
  }

  private parseCursor(cursor: IngestionCursor | undefined): Record<string, string> {
    if (!cursor || cursor.version !== 1) return {};
    try {
      const value = JSON.parse(cursor.value) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^\d+$/.test(entry[1]))
      );
    } catch {
      throw new ConnectorError({ code: "CURSOR_EXPIRED", message: "Telegram cursor is invalid", retryable: false });
    }
  }

  private async runtime(): Promise<TelegramRuntime> {
    try {
      const [telegram, sessions] = await Promise.all([
        runtimeImport("teleproto"),
        runtimeImport("teleproto/sessions/index.js")
      ]);
      if (!telegram.TelegramClient || !telegram.Api || !sessions.StringSession) throw new Error("Unexpected Teleproto exports");
      return {
        TelegramClient: telegram.TelegramClient,
        StringSession: sessions.StringSession,
        Api: telegram.Api
      };
    } catch (error) {
      throw new ConnectorError({
        code: "UNSUPPORTED",
        message: "Telegram support requires the maintained teleproto MTProto client",
        retryable: false,
        cause: error
      });
    }
  }

  private async requiredApiHash(): Promise<string> {
    const value = await this.vault.getString(this.config.apiHashVaultKey);
    if (!value) throw new ConnectorError({ code: "INVALID_CONFIGURATION", message: "Telegram API hash is missing from the credential vault", retryable: false });
    return value;
  }

  private requirePending(accountId: string): PendingAuthorization {
    if (!this.pending || this.pending.accountId !== accountId) {
      throw new ConnectorError({ code: "AUTH_REQUIRED", message: "Telegram phone authorization was not started", retryable: false });
    }
    return this.pending;
  }

  private async completeAuthorization(pending: PendingAuthorization): Promise<void> {
    await this.persistClientSession(pending.accountId, pending.client);
    await pending.client.disconnect();
    this.pending = undefined;
    this.state = { lifecycle: "ready", auth: "authenticated", status: "idle" };
  }

  private async persistClientSession(accountId: string, client: any): Promise<void> {
    const value = String(client.session.save());
    if (value) await this.vault.setString(this.sessionKey(accountId), value);
  }

  private sessionKey(accountId: string): string {
    return `telegram:${accountId}:session`;
  }
}
