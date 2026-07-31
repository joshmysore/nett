import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { StringCredentialVault } from "../security/credential-vault.js";
import {
  ConnectorError,
  type ConnectorAdapter,
  type ConnectorDescriptor,
  type ConnectorState,
  type ConnectorSyncContext,
  type ConnectorSyncRequest,
  type ConnectorSyncResult,
  type NormalizedConversation,
  type NormalizedInteraction,
  type NormalizedSourceBundle,
  type NormalizedSourceIdentity,
  type SourceTombstone
} from "../domain.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export interface GmailConnectorConfig {
  clientId: string;
  redirectUri: string;
  clientSecretVaultKey?: string;
  maxInitialMessages?: number;
  pageSize?: number;
  maxRetries?: number;
}

export interface GmailAuthorizationRequest {
  url: string;
  state: string;
}

interface GmailTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scope: string;
  tokenType: string;
}

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  historyId?: string;
  internalDate?: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPart & { headers?: GmailHeader[] };
}

type FetchLike = typeof fetch;

function stableId(...parts: string[]): string {
  return `gmail:${createHash("sha256").update(parts.join("\0")).digest("hex")}`;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function parseAddressList(value: string | undefined): Array<{ name?: string; email: string }> {
  if (!value) return [];
  const results: Array<{ name?: string; email: string }> = [];
  const pattern = /(?:"([^"]*)"\s*|([^,<"]+?)\s*)?<([^<>\s]+@[^<>\s]+)>|([^,\s<>]+@[^,\s<>]+)/g;
  for (const match of value.matchAll(pattern)) {
    const email = (match[3] ?? match[4] ?? "").trim().toLowerCase();
    if (!email) continue;
    const name = (match[1] ?? match[2] ?? "").trim().replace(/^"|"$/g, "");
    results.push(name ? { name, email } : { email });
  }
  return results;
}

function headers(message: GmailMessage): Map<string, string> {
  const result = new Map<string, string>();
  for (const header of message.payload?.headers ?? []) {
    if (header.name && header.value) result.set(header.name.toLowerCase(), header.value);
  }
  return result;
}

function plainText(part: GmailPart | undefined): string | undefined {
  if (!part) return undefined;
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8").trim() || undefined;
  }
  for (const child of part.parts ?? []) {
    const text = plainText(child);
    if (text) return text;
  }
  return undefined;
}

function normalizeMessage(
  accountId: string,
  selfEmail: string,
  message: GmailMessage
): { identities: NormalizedSourceIdentity[]; conversation: NormalizedConversation; interaction: NormalizedInteraction } {
  const messageHeaders = headers(message);
  const from = parseAddressList(messageHeaders.get("from"));
  const recipients = [
    ...parseAddressList(messageHeaders.get("to")),
    ...parseAddressList(messageHeaders.get("cc")),
    ...parseAddressList(messageHeaders.get("bcc"))
  ];
  const people = new Map<string, { name?: string; email: string }>();
  for (const person of [...from, ...recipients, { email: selfEmail }]) people.set(person.email, person);
  const identities = [...people.values()].map((person): NormalizedSourceIdentity => ({
    source: "gmail",
    externalId: person.email,
    stableId: stableId(accountId, "identity", person.email),
    displayName: person.name || person.email,
    isSelf: person.email === selfEmail,
    addresses: [{ kind: "email", value: person.email, normalized: person.email, verified: person.email === selfEmail }]
  }));
  const identityByEmail = new Map(identities.map((identity) => [identity.externalId, identity]));
  const sender = from[0] ? identityByEmail.get(from[0].email) : undefined;
  const participants = identities.map((identity) => ({
    identityStableId: identity.stableId,
    role: identity.isSelf ? "self" as const : "member" as const,
    displayName: identity.displayName
  }));
  const internalTimestamp = Number(message.internalDate);
  const headerTimestamp = Date.parse(messageHeaders.get("date") ?? "");
  const timestamp = new Date(
    Number.isFinite(internalTimestamp)
      ? internalTimestamp
      : Number.isFinite(headerTimestamp) ? headerTimestamp : 0
  ).toISOString();
  const conversationStableId = stableId(accountId, "thread", message.threadId);
  const isOutgoing = sender?.isSelf === true || message.labelIds?.includes("SENT") === true;

  return {
    identities,
    conversation: {
      source: "gmail",
      externalId: message.threadId,
      stableId: conversationStableId,
      title: messageHeaders.get("subject"),
      kind: "thread",
      participants,
      updatedAt: timestamp,
      rawRef: `gmail://thread/${message.threadId}`
    },
    interaction: {
      source: "gmail",
      externalId: message.id,
      stableId: stableId(accountId, "message", message.id),
      conversationStableId,
      senderIdentityStableId: sender?.stableId,
      participantIdentityStableIds: participants.map((participant) => participant.identityStableId),
      direction: isOutgoing ? "outgoing" : "incoming",
      kind: "email",
      occurredAt: timestamp,
      subject: messageHeaders.get("subject"),
      text: plainText(message.payload),
      snippet: message.snippet,
      inReplyToStableId: messageHeaders.get("in-reply-to")
        ? stableId(accountId, "rfc-message-id", messageHeaders.get("in-reply-to")!)
        : undefined,
      rawRef: `gmail://message/${message.id}`
    }
  };
}

function classifyHttpError(status: number, retryAfterMs: number | undefined, operation: string): ConnectorError {
  if (status === 401) return new ConnectorError({ code: "AUTH_REQUIRED", message: "Gmail authorization expired", retryable: false, operation });
  if (status === 403) return new ConnectorError({ code: "PERMISSION_DENIED", message: "Gmail denied the requested operation", retryable: false, operation });
  if (status === 404 && operation === "history") return new ConnectorError({ code: "CURSOR_EXPIRED", message: "Gmail history cursor expired; a new bounded sync is required", retryable: false, operation });
  if (status === 429) return new ConnectorError({ code: "RATE_LIMITED", message: "Gmail rate limit reached", retryable: true, retryAfterMs, operation });
  if (status >= 500) return new ConnectorError({ code: "SOURCE_UNAVAILABLE", message: "Gmail is temporarily unavailable", retryable: true, retryAfterMs, operation });
  return new ConnectorError({ code: "INVALID_RESPONSE", message: `Gmail request failed with status ${status}`, retryable: false, operation });
}

function retryAfter(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

export class GmailConnector implements ConnectorAdapter {
  readonly descriptor: ConnectorDescriptor = {
    id: "gmail",
    displayName: "Gmail",
    version: "1.0.0",
    capabilities: [
      { resource: "identities", mode: "incremental", readOnly: true, maxPageSize: 500 },
      { resource: "conversations", mode: "incremental", readOnly: true, maxPageSize: 500 },
      { resource: "interactions", mode: "incremental", readOnly: true, maxPageSize: 500 }
    ]
  };
  private state: ConnectorState = { lifecycle: "unconfigured", auth: "missing", status: "idle" };

  constructor(
    private readonly config: GmailConnectorConfig,
    private readonly vault: StringCredentialVault,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async getState(): Promise<ConnectorState> {
    return { ...this.state };
  }

  async beginAuthorization(accountId: string): Promise<GmailAuthorizationRequest> {
    const verifier = base64Url(randomBytes(48));
    const challenge = base64Url(createHash("sha256").update(verifier).digest());
    const state = base64Url(randomBytes(32));
    await this.vault.setString(this.pendingKey(accountId), JSON.stringify({ verifier, state, createdAt: Date.now() }));
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: GMAIL_READONLY_SCOPE,
      access_type: "offline",
      prompt: "consent",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state
    });
    this.state = { lifecycle: "authorizing", auth: "pending-user", status: "idle" };
    return { url: `${GOOGLE_AUTH}?${params.toString()}`, state };
  }

  async finishAuthorization(accountId: string, code: string, returnedState: string): Promise<void> {
    const pendingRaw = await this.vault.getString(this.pendingKey(accountId));
    if (!pendingRaw) throw new ConnectorError({ code: "AUTH_REQUIRED", message: "OAuth flow was not started or has expired", retryable: false });
    const pending = JSON.parse(pendingRaw) as { verifier: string; state: string; createdAt: number };
    if (pending.state !== returnedState || Date.now() - pending.createdAt > 10 * 60_000) {
      await this.vault.delete(this.pendingKey(accountId));
      throw new ConnectorError({ code: "AUTH_REQUIRED", message: "OAuth state is invalid or expired", retryable: false });
    }
    const form = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      grant_type: "authorization_code",
      code,
      code_verifier: pending.verifier
    });
    const clientSecret = await this.clientSecret();
    if (clientSecret) form.set("client_secret", clientSecret);
    const token = await this.exchangeToken(form);
    await this.vault.setString(this.tokenKey(accountId), JSON.stringify(token));
    await this.vault.delete(this.pendingKey(accountId));
    this.state = { lifecycle: "ready", auth: "authenticated", status: "idle" };
  }

  async revokeLocalAuthorization(accountId: string): Promise<void> {
    await Promise.all([
      this.vault.delete(this.tokenKey(accountId)),
      this.vault.delete(this.pendingKey(accountId))
    ]);
    this.state = { lifecycle: "revoked", auth: "revoked", status: "idle" };
  }

  async sync(request: ConnectorSyncRequest, context: ConnectorSyncContext): Promise<ConnectorSyncResult> {
    this.state = { lifecycle: "syncing", auth: "authenticated", status: "running", lastAttemptAt: new Date().toISOString() };
    try {
      const profile = await this.api<{ emailAddress: string; historyId: string }>(
        request.accountId, "/users/me/profile", "profile", context.signal
      );
      const result = request.mode === "incremental" && request.cursor
        ? await this.syncHistory(request, context, profile.emailAddress)
        : await this.syncInitial(request, context, profile.emailAddress, profile.historyId);
      this.state = {
        lifecycle: "ready",
        auth: "authenticated",
        status: result.partial ? "partial" : "succeeded",
        lastAttemptAt: this.state.lastAttemptAt,
        lastSuccessAt: new Date().toISOString()
      };
      return result;
    } catch (error) {
      const connectorError = error instanceof ConnectorError
        ? error
        : new ConnectorError({ code: "NETWORK", message: "Gmail sync failed", retryable: true, cause: error });
      this.state = {
        lifecycle: connectorError.code.startsWith("AUTH") ? "error" : "ready",
        auth: connectorError.code.startsWith("AUTH") ? "expired" : "authenticated",
        status: "failed",
        lastAttemptAt: this.state.lastAttemptAt,
        error: {
          code: connectorError.code,
          message: connectorError.message,
          retryable: connectorError.retryable,
          retryAfterMs: connectorError.retryAfterMs,
          operation: connectorError.operation
        }
      };
      throw connectorError;
    }
  }

  private async syncInitial(
    request: ConnectorSyncRequest,
    context: ConnectorSyncContext,
    selfEmail: string,
    historyId: string
  ): Promise<ConnectorSyncResult> {
    const limit = Math.min(Math.max(request.maxRecords ?? this.config.maxInitialMessages ?? 2_000, 1), 10_000);
    const ids: string[] = [];
    let pageToken: string | undefined;
    while (ids.length < limit) {
      const pageSize = Math.min(this.config.pageSize ?? 100, 500, limit - ids.length);
      const query = new URLSearchParams({ maxResults: String(pageSize) });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await this.api<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
        request.accountId, `/users/me/messages?${query}`, "list-messages", context.signal
      );
      ids.push(...(page.messages ?? []).map((message) => message.id));
      pageToken = page.nextPageToken;
      await context.reportProgress?.({
        phase: "fetch", completed: ids.length, total: limit, unit: "records",
        message: "Discovering recent Gmail messages", observedAt: new Date().toISOString()
      });
      if (!pageToken) break;
    }
    const messages = await this.fetchMessages(request.accountId, ids, context.signal);
    const cursor = {
      connectorId: "gmail",
      scope: request.accountId,
      value: historyId,
      version: 1,
      observedAt: new Date().toISOString()
    };
    const bundle = this.bundle(request.accountId, messages, selfEmail, cursor, !pageToken);
    await context.ingestion.ingest(bundle, { signal: context.signal });
    return { bundles: 1, recordsSeen: messages.length, finalCursor: cursor, partial: Boolean(pageToken) };
  }

  private async syncHistory(
    request: ConnectorSyncRequest,
    context: ConnectorSyncContext,
    selfEmail: string
  ): Promise<ConnectorSyncResult> {
    const maxRecords = Math.min(Math.max(request.maxRecords ?? 5_000, 1), 20_000);
    const addedIds = new Set<string>();
    const deletedIds = new Set<string>();
    let pageToken: string | undefined;
    let newestHistoryId = request.cursor!.value;
    let partial = false;
    let stop = false;
    do {
      const query = new URLSearchParams({
        startHistoryId: request.cursor!.value,
        maxResults: "500"
      });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await this.api<{
        history?: Array<{
          id: string;
          messagesAdded?: Array<{ message: { id: string } }>;
          messagesDeleted?: Array<{ message: { id: string } }>;
        }>;
        historyId?: string;
        nextPageToken?: string;
      }>(request.accountId, `/users/me/history?${query}`, "history", context.signal);
      const historyItems = page.history ?? [];
      for (let index = 0; index < historyItems.length; index++) {
        const history = historyItems[index];
        newestHistoryId = history.id || newestHistoryId;
        for (const item of history.messagesAdded ?? []) {
          deletedIds.delete(item.message.id);
          addedIds.add(item.message.id);
        }
        for (const item of history.messagesDeleted ?? []) {
          addedIds.delete(item.message.id);
          deletedIds.add(item.message.id);
        }
        if (addedIds.size + deletedIds.size >= maxRecords) {
          partial = index < historyItems.length - 1 || Boolean(page.nextPageToken);
          stop = true;
          break;
        }
      }
      if (!stop && page.historyId && !page.nextPageToken) newestHistoryId = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken && !stop);

    const messages = await this.fetchMessages(request.accountId, [...addedIds], context.signal);
    const tombstones: SourceTombstone[] = [...deletedIds].map((id) => ({
      entity: "interaction",
      externalId: id,
      stableId: stableId(request.accountId, "message", id)
    }));
    const cursor = {
      connectorId: "gmail",
      scope: request.accountId,
      value: newestHistoryId,
      version: 1,
      observedAt: new Date().toISOString()
    };
    const bundle = this.bundle(request.accountId, messages, selfEmail, cursor, false, tombstones);
    await context.ingestion.ingest(bundle, { signal: context.signal });
    return { bundles: 1, recordsSeen: messages.length + tombstones.length, finalCursor: cursor, partial };
  }

  private bundle(
    accountId: string,
    messages: GmailMessage[],
    selfEmail: string,
    nextCursor: NormalizedSourceBundle["nextCursor"],
    completeSnapshot: boolean,
    tombstones: SourceTombstone[] = []
  ): NormalizedSourceBundle {
    const identities = new Map<string, NormalizedSourceIdentity>();
    const conversations = new Map<string, NormalizedConversation>();
    const interactions: NormalizedInteraction[] = [];
    for (const message of messages) {
      const normalized = normalizeMessage(accountId, selfEmail.toLowerCase(), message);
      for (const identity of normalized.identities) identities.set(identity.stableId, identity);
      const existing = conversations.get(normalized.conversation.stableId);
      if (existing) {
        const participants = new Map(existing.participants.map((participant) => [participant.identityStableId, participant]));
        for (const participant of normalized.conversation.participants) participants.set(participant.identityStableId, participant);
        existing.participants = [...participants.values()];
        if ((normalized.conversation.updatedAt ?? "") > (existing.updatedAt ?? "")) {
          existing.updatedAt = normalized.conversation.updatedAt;
          existing.title = normalized.conversation.title ?? existing.title;
        }
      } else conversations.set(normalized.conversation.stableId, normalized.conversation);
      interactions.push(normalized.interaction);
    }
    return {
      connectorId: "gmail",
      accountId,
      batchId: randomUUID(),
      capturedAt: new Date().toISOString(),
      identities: [...identities.values()],
      conversations: [...conversations.values()],
      interactions,
      tombstones,
      nextCursor,
      completeSnapshot
    };
  }

  private async fetchMessages(accountId: string, ids: string[], signal?: AbortSignal): Promise<GmailMessage[]> {
    const output: GmailMessage[] = [];
    const concurrency = 6;
    let offset = 0;
    const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (offset < ids.length) {
        const index = offset++;
        const id = ids[index];
        output[index] = await this.api<GmailMessage>(
          accountId,
          `/users/me/messages/${encodeURIComponent(id)}?format=full`,
          "get-message",
          signal
        );
      }
    });
    await Promise.all(workers);
    return output.filter(Boolean);
  }

  private async api<T>(accountId: string, path: string, operation: string, signal?: AbortSignal): Promise<T> {
    let token = await this.accessToken(accountId);
    const maxRetries = this.config.maxRetries ?? 4;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(`${GMAIL_API}${path}`, {
          headers: { authorization: `Bearer ${token.accessToken}`, accept: "application/json" },
          signal
        });
      } catch (error) {
        if (signal?.aborted) throw new ConnectorError({ code: "CANCELLED", message: "Gmail sync cancelled", retryable: false, operation, cause: error });
        if (attempt < maxRetries) {
          await delay(Math.min(30_000, 500 * 2 ** attempt + Math.random() * 250), signal);
          continue;
        }
        throw new ConnectorError({ code: "NETWORK", message: "Could not reach Gmail", retryable: true, operation, cause: error });
      }
      if (response.status === 401 && attempt === 0 && token.refreshToken) {
        token = await this.refresh(accountId, token.refreshToken);
        continue;
      }
      if (!response.ok) {
        const error = classifyHttpError(response.status, retryAfter(response), operation);
        if (error.retryable && attempt < maxRetries) {
          await delay(error.retryAfterMs ?? Math.min(30_000, 500 * 2 ** attempt + Math.random() * 250), signal);
          continue;
        }
        throw error;
      }
      try {
        return await response.json() as T;
      } catch (error) {
        throw new ConnectorError({ code: "INVALID_RESPONSE", message: "Gmail returned invalid JSON", retryable: false, operation, cause: error });
      }
    }
  }

  private async accessToken(accountId: string): Promise<GmailTokenSet> {
    const raw = await this.vault.getString(this.tokenKey(accountId));
    if (!raw) throw new ConnectorError({ code: "AUTH_REQUIRED", message: "Gmail is not authorized", retryable: false });
    let token: GmailTokenSet;
    try {
      token = JSON.parse(raw) as GmailTokenSet;
    } catch (error) {
      throw new ConnectorError({ code: "AUTH_REQUIRED", message: "Stored Gmail authorization is invalid", retryable: false, cause: error });
    }
    if (token.expiresAt <= Date.now() + 60_000) {
      if (!token.refreshToken) throw new ConnectorError({ code: "AUTH_REQUIRED", message: "Gmail authorization must be renewed", retryable: false });
      return this.refresh(accountId, token.refreshToken);
    }
    return token;
  }

  private async refresh(accountId: string, refreshToken: string): Promise<GmailTokenSet> {
    const form = new URLSearchParams({
      client_id: this.config.clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    });
    const clientSecret = await this.clientSecret();
    if (clientSecret) form.set("client_secret", clientSecret);
    const refreshed = await this.exchangeToken(form);
    const token = { ...refreshed, refreshToken: refreshed.refreshToken ?? refreshToken };
    await this.vault.setString(this.tokenKey(accountId), JSON.stringify(token));
    return token;
  }

  private async exchangeToken(form: URLSearchParams): Promise<GmailTokenSet> {
    let response: Response;
    try {
      response = await this.fetchImpl(GOOGLE_TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: form
      });
    } catch (error) {
      throw new ConnectorError({ code: "NETWORK", message: "Could not reach Google OAuth", retryable: true, cause: error });
    }
    if (!response.ok) {
      throw new ConnectorError({
        code: response.status >= 500 ? "SOURCE_UNAVAILABLE" : "AUTH_REQUIRED",
        message: "Google OAuth rejected the authorization",
        retryable: response.status >= 500
      });
    }
    const payload = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };
    if (!payload.access_token || typeof payload.expires_in !== "number") {
      throw new ConnectorError({ code: "INVALID_RESPONSE", message: "Google OAuth returned an invalid token response", retryable: false });
    }
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: Date.now() + payload.expires_in * 1000,
      scope: payload.scope ?? GMAIL_READONLY_SCOPE,
      tokenType: payload.token_type ?? "Bearer"
    };
  }

  private async clientSecret(): Promise<string | undefined> {
    return this.config.clientSecretVaultKey
      ? this.vault.getString(this.config.clientSecretVaultKey)
      : undefined;
  }

  private tokenKey(accountId: string): string {
    return `gmail:${accountId}:oauth`;
  }

  private pendingKey(accountId: string): string {
    return `gmail:${accountId}:oauth-pending`;
  }
}
