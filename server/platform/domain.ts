export type ConnectorId = string;
export type SourceRecordId = string;

export type ConnectorLifecycle =
  | "unconfigured"
  | "authorizing"
  | "ready"
  | "syncing"
  | "paused"
  | "revoked"
  | "error";

export type ConnectorAuthState =
  | "not-required"
  | "missing"
  | "pending-user"
  | "authenticated"
  | "expired"
  | "revoked";

export type ConnectorRunStatus =
  | "idle"
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "cancelled";

export type ConnectorErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_REVOKED"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "INVALID_CONFIGURATION"
  | "INVALID_RESPONSE"
  | "CURSOR_EXPIRED"
  | "SOURCE_UNAVAILABLE"
  | "UNSUPPORTED"
  | "CANCELLED"
  | "INTERNAL";

export interface ConnectorErrorDetails {
  code: ConnectorErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  operation?: string;
  cause?: unknown;
}

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly operation?: string;

  constructor(details: ConnectorErrorDetails) {
    super(details.message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "ConnectorError";
    this.code = details.code;
    this.retryable = details.retryable;
    this.retryAfterMs = details.retryAfterMs;
    this.operation = details.operation;
  }
}

export interface ConnectorProgress {
  phase: "authorize" | "discover" | "fetch" | "normalize" | "commit" | "complete";
  completed: number;
  total?: number;
  unit: "records" | "pages" | "bytes" | "steps";
  message?: string;
  observedAt: string;
}

export interface ConnectorCapability {
  resource: "identities" | "conversations" | "interactions" | "attachments";
  mode: "snapshot" | "incremental" | "export";
  readOnly: true;
  maxPageSize?: number;
}

export interface ConnectorDescriptor {
  id: ConnectorId;
  displayName: string;
  version: string;
  capabilities: readonly ConnectorCapability[];
}

export interface ConnectorState {
  lifecycle: ConnectorLifecycle;
  auth: ConnectorAuthState;
  status: ConnectorRunStatus;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  progress?: ConnectorProgress;
  error?: Omit<ConnectorErrorDetails, "cause">;
}

export interface SourceAddress {
  kind: "email" | "phone" | "username" | "url" | "platform";
  value: string;
  normalized: string;
  label?: string;
  verified?: boolean;
}

export interface NormalizedSourceIdentity {
  source: ConnectorId;
  externalId: SourceRecordId;
  stableId: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  isSelf?: boolean;
  addresses: SourceAddress[];
  avatarUrl?: string;
  rawRef?: string;
}

export interface ConversationParticipant {
  identityStableId: string;
  role?: "self" | "member" | "sender" | "recipient";
  displayName?: string;
}

export interface NormalizedConversation {
  source: ConnectorId;
  externalId: SourceRecordId;
  stableId: string;
  title?: string;
  kind: "direct" | "group" | "thread" | "channel" | "unknown";
  participants: ConversationParticipant[];
  startedAt?: string;
  updatedAt?: string;
  rawRef?: string;
}

export interface InteractionAttachment {
  externalId?: string;
  name?: string;
  mediaType?: string;
  sizeBytes?: number;
  remoteRef?: string;
}

export interface NormalizedInteraction {
  source: ConnectorId;
  externalId: SourceRecordId;
  stableId: string;
  conversationStableId?: string;
  senderIdentityStableId?: string;
  participantIdentityStableIds: string[];
  direction: "incoming" | "outgoing" | "system" | "unknown";
  kind: "message" | "email" | "call" | "event" | "reaction" | "system";
  occurredAt: string;
  subject?: string;
  text?: string;
  snippet?: string;
  inReplyToStableId?: string;
  attachments?: InteractionAttachment[];
  deleted?: boolean;
  rawRef?: string;
}

export interface SourceTombstone {
  entity: "identity" | "conversation" | "interaction";
  externalId: SourceRecordId;
  stableId: string;
  deletedAt?: string;
}

export interface IngestionCursor {
  connectorId: ConnectorId;
  scope: string;
  value: string;
  version: number;
  observedAt: string;
}

export interface NormalizedSourceBundle {
  connectorId: ConnectorId;
  accountId: string;
  batchId: string;
  capturedAt: string;
  identities: NormalizedSourceIdentity[];
  conversations: NormalizedConversation[];
  interactions: NormalizedInteraction[];
  tombstones?: SourceTombstone[];
  nextCursor?: IngestionCursor;
  completeSnapshot: boolean;
}

export interface AtomicIngestionResult {
  batchId: string;
  inserted: number;
  updated: number;
  ignored: number;
  deleted: number;
  committedCursor?: IngestionCursor;
}

/**
 * Implementations must atomically persist every entity and the cursor. If any
 * write fails, neither records nor cursor may become visible.
 */
export interface AtomicIngestionPort {
  ingest(bundle: NormalizedSourceBundle, options?: { signal?: AbortSignal }): Promise<AtomicIngestionResult>;
  readCursor(connectorId: ConnectorId, scope: string): Promise<IngestionCursor | undefined>;
}

export interface ConnectorSyncContext {
  ingestion: AtomicIngestionPort;
  signal?: AbortSignal;
  reportProgress?: (progress: ConnectorProgress) => void | Promise<void>;
  now?: () => Date;
}

export interface ConnectorSyncRequest {
  accountId: string;
  mode: "initial" | "incremental";
  cursor?: IngestionCursor;
  maxRecords?: number;
}

export interface ConnectorSyncResult {
  bundles: number;
  recordsSeen: number;
  finalCursor?: IngestionCursor;
  partial: boolean;
}

export interface ConnectorAdapter {
  readonly descriptor: ConnectorDescriptor;
  getState(): Promise<ConnectorState>;
  sync(request: ConnectorSyncRequest, context: ConnectorSyncContext): Promise<ConnectorSyncResult>;
}
