import type {
  AutofillSuggestion,
  Facet,
  GeoOption,
  PersonPatch,
  PublicProfileSuggestion,
  RelationshipInsight,
} from "@/lib/contracts";
import type { AgentAnswer, CommunicationPage, FullPerson, Overview, ParsedMemory, Person, SetupStatus } from "@/types";

export type { AutofillSuggestion, Facet, GeoOption, PersonPatch, PublicProfileSuggestion, RelationshipInsight };

export type PeopleFacets = {
  countries: Facet[];
  industries: Facet[];
  languages: Facet[];
  relationships: Facet[];
  tags: Facet[];
  recency: Facet[];
  missing: Facet[];
};

export type PeopleQuery = {
  query?: string;
  filter?: "all" | "strong" | "due" | "cold";
  country?: string;
  industry?: string;
  language?: string;
  relationship?: string;
  tag?: string;
  recency?: string;
  missing?: string; // any supported gap key: context, hometown, location, …
};

/** True when a rejected promise is a caller-initiated cancellation rather than
 *  a failure worth surfacing. */
export const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: options?.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

function peopleParams(input: PeopleQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.filter && input.filter !== "all") params.set("filter", input.filter);
  for (const key of ["country", "industry", "language", "relationship", "tag", "recency", "missing"] as const) {
    const value = input[key];
    if (value) params.set(key, value);
  }
  return params;
}

export const api = {
  bootstrap: () => request<Overview>("/api/bootstrap"),
  setupStatus: () => request<SetupStatus>("/api/setup/status"),
  updateSetup: (input: { phase?: SetupStatus["phase"]; ownerDisplayName?: string; skipStep?: string; complete?: boolean }) =>
    request<SetupStatus>("/api/setup/onboarding", { method: "PATCH", body: JSON.stringify(input) }),
  people: () => request<Person[]>("/api/people"),
  peoplePage: (input: PeopleQuery & { page?: number; limit?: number }, signal?: AbortSignal) => {
    const params = peopleParams(input);
    params.set("page", String(input.page || 1));
    params.set("limit", String(input.limit || 50));
    return request<{ people: Person[]; total: number; page: number; limit: number }>(`/api/people/page?${params}`, { signal });
  },
  peopleFacets: (input: PeopleQuery, signal?: AbortSignal) =>
    request<PeopleFacets>(`/api/people/facets?${peopleParams(input)}`, { signal }),
  person: (id: string, signal?: AbortSignal) => request<FullPerson>(`/api/people/${id}`, { signal }),
  communications: (id: string, limit = 50, cursor?: string, signal?: AbortSignal) =>
    request<CommunicationPage>(
      `/api/people/${id}/communications?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { signal },
    ),
  updatePerson: (id: string, input: PersonPatch, signal?: AbortSignal) =>
    request<FullPerson>(`/api/people/${id}`, { method: "PATCH", body: JSON.stringify(input), signal }),
  autofill: (
    id: string,
    signal?: AbortSignal,
    options: { generate?: boolean; reindex?: boolean } = {},
  ) => {
    const params = new URLSearchParams();
    if (options.generate === false) params.set("generate", "false");
    if (options.reindex) params.set("reindex", "true");
    const query = params.toString();
    return request<{
      suggestions: AutofillSuggestion[];
      degraded: boolean;
      note?: string;
      model: string | null;
      provider: string | null;
      generatedAt: string;
      index: {
        documents: number;
        indexedAt: string | null;
        stale: boolean;
        reason: "not-indexed" | "profile-changed" | null;
      };
    }>(`/api/people/${id}/autofill${query ? `?${query}` : ""}`, { method: "POST", signal });
  },
  refreshPersonEvidence: (id: string, signal?: AbortSignal) =>
    request<{ indexed: number; written: number; removed: number; cancelled: boolean }>(
      `/api/people/${id}/evidence/refresh`,
      { method: "POST", signal },
    ),
  personInsights: (id: string, signal?: AbortSignal) =>
    request<RelationshipInsight>(`/api/people/${id}/insights`, { method: "POST", signal }),
  previewLinkedIn: (
    id: string,
    input: { profileUrl: string; publicText: string },
    signal?: AbortSignal,
  ) =>
    request<{ profileUrl: string; suggestions: PublicProfileSuggestion[] }>(
      `/api/people/${id}/enrichment/linkedin/preview`,
      { method: "POST", body: JSON.stringify(input), signal },
    ),
  applyLinkedIn: (
    id: string,
    input: { profileUrl: string; publicText: string; acceptedFields: string[] },
    signal?: AbortSignal,
  ) =>
    request<{ person: FullPerson; applied: PublicProfileSuggestion[]; sourceRecordId: string }>(
      `/api/people/${id}/enrichment/linkedin/apply`,
      { method: "POST", body: JSON.stringify(input), signal },
    ),
  reviewSuggestion: (
    id: string,
    decision: "accepted" | "rejected",
    apply = false,
    signal?: AbortSignal,
  ) =>
    request<{ id: string; decision: string; applied: boolean }>(
      `/api/inference/suggestions/${id}/review`,
      { method: "POST", body: JSON.stringify({ decision, apply }), signal },
    ),
  relationshipSignals: (id: string, signal?: AbortSignal) => request<{
    personId: string; calculatedAt: string; recency: number; cadenceDrift: number;
    reciprocity: number; channelDiversity: number; interactionFrequency: number;
    explanation: Record<string, unknown>;
  }>(`/api/people/${id}/signals`, { signal }),
  intelligenceStatus: () => request<{
    ok: boolean; version?: string; selectedModel?: string;
    fastModel?: string; reasonModel?: string; embedModel?: string;
    evidenceDocuments: number;
    embeddedDocuments: number; models: { name: string; size?: number }[];
  }>("/api/intelligence/status"),
  refreshIntelligence: (limit = 250) =>
    request<{ indexed: number; embedded: number; model?: string }>("/api/intelligence/index", { method: "POST", body: JSON.stringify({ limit }) }),
  search: (query: string, signal?: AbortSignal) => request<Person[]>(`/api/search?q=${encodeURIComponent(query)}`, { signal }),
  parseMemory: (text: string, signal?: AbortSignal) =>
    request<ParsedMemory>("/api/memories/parse", { method: "POST", body: JSON.stringify({ text }), signal }),
  saveMemory: (
    id: string,
    text: string,
    structured: Record<string, unknown>,
    source = "manual",
    signal?: AbortSignal,
  ) =>
    request<FullPerson>(`/api/people/${id}/memories`, {
      method: "POST",
      body: JSON.stringify({ text, structured, source }),
      signal,
    }),
  sync: (connector: string, accountId?: string, maxBatches?: number) => request<{
    message: string; seen?: number; linked?: number; done?: boolean; cursor?: number; batchesCompleted?: number; totalSeen?: number;
  }>(`/api/connectors/${connector}/sync`, { method: "POST", body: JSON.stringify({ accountId, maxBatches }) }),
  messagesStatus: () => request<{
    source: "local_copy" | "environment" | "system" | "none";
    usingLocalCopy: boolean;
    usingEnv: boolean;
    localCopyExists: boolean;
    systemExists: boolean;
    readable: boolean;
    messageCount: number | null;
    bytes: number | null;
    preparedAt: string | null;
    syncCursor: { lastRowId: number; lastGuid: string | null };
    error: string | null;
  }>("/api/connectors/messages/status"),
  prepareMessagesCopy: (options?: { resetCursor?: boolean }) =>
    request<{
      messageCount: number;
      bytes: number;
      preparedAt: string;
      cursorReset: boolean;
      syncCursor: { lastRowId: number; lastGuid: string | null };
      message: string;
    }>("/api/connectors/messages/prepare", {
      method: "POST",
      body: JSON.stringify({ resetCursor: options?.resetCursor === true })
    }),
  importMessagesDb: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ messageCount: number; bytes: number; preparedAt: string; cursorReset: boolean; message: string }>("/api/connectors/messages/import-db", { method: "POST", body });
  },
  platformStatus: () => request<{
    accounts: { connectorId: string; accountId: string; accountLabel?: string; authState: string; settings: Record<string, unknown>; updatedAt: string }[];
    mcp: { configured: boolean; error?: string; servers: { id: string; displayName: string; enabled: boolean }[] };
  }>("/api/platform/status"),
  gmailDefaults: () =>
    request<{ bundledClientId: string | null; redirectUri: string }>("/api/platform/gmail/defaults"),
  configureGmail: (input: {
    accountId?: string;
    accountLabel?: string;
    clientId?: string;
    clientSecret?: string;
    maxInitialMessages?: number;
    useBundledClient?: boolean;
  }) =>
    request<{ accountId: string; redirectUri: string; clientId: string }>(
      "/api/platform/gmail/configure",
      { method: "POST", body: JSON.stringify(input) },
    ),
  authorizeGmail: (accountId = "primary") =>
    request<{ url: string; state: string }>("/api/platform/gmail/authorize", { method: "POST", body: JSON.stringify({ accountId }) }),
  disconnectGmail: (accountId = "primary") =>
    request<{ ok: boolean }>(`/api/platform/gmail/${encodeURIComponent(accountId)}`, { method: "DELETE" }),
  configureTelegram: (input: { accountId?: string; accountLabel?: string; apiId: number; apiHash: string; maxInitialMessages?: number }) =>
    request<{ accountId: string }>("/api/platform/telegram/configure", { method: "POST", body: JSON.stringify(input) }),
  authorizeTelegram: (accountId: string, phone: string) =>
    request<{ step: "otp" | "password" | "complete" }>("/api/platform/telegram/authorize", { method: "POST", body: JSON.stringify({ accountId, phone }) }),
  submitTelegramOtp: (accountId: string, otp: string) =>
    request<{ step: "otp" | "password" | "complete" }>("/api/platform/telegram/otp", { method: "POST", body: JSON.stringify({ accountId, otp }) }),
  submitTelegramPassword: (accountId: string, password: string) =>
    request<{ step: "complete" }>("/api/platform/telegram/password", { method: "POST", body: JSON.stringify({ accountId, password }) }),
  disconnectTelegram: (accountId = "primary") =>
    request<{ ok: boolean }>(`/api/platform/telegram/${encodeURIComponent(accountId)}`, { method: "DELETE" }),
  whatsappStatus: () => request<{
    binary: string | null;
    binaryFound: boolean;
    sourcePath: string;
    desktopExists: boolean;
    desktopAvailable: boolean;
    desktopMessageCount: number | null;
    desktopChatCount: number | null;
    desktopContactCount: number | null;
    oldestMessage: string | null;
    newestMessage: string | null;
    archivePath: string;
    archiveExists: boolean;
    archiveReadable: boolean;
    archiveMessageCount: number | null;
    archiveBytes: number | null;
    lastArchiveImportAt: string | null;
    preparedAt: string | null;
    syncCursor: { lastRowId: number };
    readable: boolean;
    error: string | null;
  }>("/api/connectors/whatsapp/status"),
  prepareWhatsAppArchive: (options?: { resetCursor?: boolean }) =>
    request<{
      messageCount: number;
      bytes: number;
      preparedAt: string;
      cursorReset: boolean;
      archivePath: string;
      syncCursor: { lastRowId: number };
      message: string;
    }>("/api/connectors/whatsapp/prepare", {
      method: "POST",
      body: JSON.stringify({ resetCursor: options?.resetCursor === true })
    }),
  importWhatsApp: (file: File, input: { accountId?: string; conversationId?: string; conversationTitle?: string; selfNames?: string; selfPhones?: string; dateOrder?: "DMY" | "MDY" | "YMD" }) => {
    const body = new FormData();
    body.append("file", file);
    Object.entries(input).forEach(([key, value]) => { if (value) body.append(key, value); });
    return request<{ recordsSeen: number; bundles: number; message: string }>("/api/platform/whatsapp/import", { method: "POST", body });
  },
  query: (query: string, signal?: AbortSignal) =>
    request<AgentAnswer>("/api/agent/query", { method: "POST", body: JSON.stringify({ query }), signal }),
  importCsv: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{
      importId: string;
      duplicate: boolean;
      rows: number;
      merged: number;
      created: number;
      review: number;
      invalid: number;
      conflicts: number;
    }>("/api/import/csv", { method: "POST", body });
  },
  importLinkedInArchive: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{
      importId: string;
      duplicate: boolean;
      filename: string;
      rows: number;
      merged: number;
      created: number;
      review: number;
      invalid: number;
      conflicts: number;
      contents: { provided: readonly string[]; notProvided: readonly string[] };
    }>("/api/import/linkedin", { method: "POST", body });
  },
  previewLinkedInArchive: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{
      filename: string;
      rows: number;
      rowsWithEmail: number;
      rowsWithProfileUrl: number;
      alreadyImported: { importId: string; completedAt: string | null } | null;
      contents: { provided: readonly string[]; notProvided: readonly string[] };
    }>("/api/import/linkedin/preview", { method: "POST", body });
  },
  mergeQueue: () => request<{ sourceIdentityId: string; displayName: string; connectorId: string; raw: Record<string, unknown>; candidates: { suggestionId: string; personId: string; name: string; company?: string; confidence: number; reason: string }[] }[]>("/api/merges"),
  resolveMerge: (sourceIdentityId: string, personId?: string, createNew = false) => request<FullPerson>(`/api/merges/${sourceIdentityId}/resolve`, { method: "POST", body: JSON.stringify({ personId, createNew }) }),
  reviewInbox: (signal?: AbortSignal, options: { limit?: number; offset?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.limit) params.set("limit", String(options.limit));
    if (options.offset) params.set("offset", String(options.offset));
    const query = params.toString();
    return request<{
      counts: { merges: number; suggestions: number; total: number };
      merges: {
        sourceIdentityId: string;
        displayName: string;
        connectorId: string;
        raw: Record<string, unknown>;
        candidates: {
          suggestionId: string;
          personId: string;
          name: string;
          company?: string;
          confidence: number;
          reason: string;
        }[];
      }[];
      mergesTotal: number;
      suggestions: {
        id: string;
        personId: string;
        personName: string;
        fieldName: string;
        proposedValue: unknown;
        currentValue: unknown;
        rationale: string;
        confidence: number | null;
        createdAt: string;
      }[];
    }>(`/api/review${query ? `?${query}` : ""}`, { signal });
  },
  reviewCounts: (signal?: AbortSignal) =>
    request<{ merges: number; suggestions: number; total: number }>("/api/review/counts", { signal }),
  freshness: (signal?: AbortSignal) =>
    request<{
      enabled: boolean;
      running: string | null;
      queued?: boolean;
      lastTickAt: string | null;
      intervalsMs?: Record<string, number>;
      lastResults: Record<string, { at: string; ok: boolean; message?: string; error?: string }>;
      nextDue: Record<string, string | null>;
      constraint?: string;
    }>("/api/freshness", { signal }),
  setFreshness: (enabled: boolean) =>
    request<{
      enabled: boolean;
      running: string | null;
      queued?: boolean;
      lastTickAt: string | null;
      intervalsMs?: Record<string, number>;
      lastResults: Record<string, { at: string; ok: boolean; message?: string; error?: string }>;
      nextDue: Record<string, string | null>;
      constraint?: string;
    }>("/api/freshness", { method: "POST", body: JSON.stringify({ enabled }) }),
  syncFreshness: (connectorId?: string) =>
    request<{
      accepted: boolean;
      message?: string;
      results?: Record<string, { at: string; ok: boolean; message?: string; error?: string }>;
    }>("/api/freshness/sync", { method: "POST", body: JSON.stringify({ connectorId }) }),
  unmerge: (sourceIdentityId: string) => request<FullPerson>(`/api/identities/${sourceIdentityId}/unmerge`, { method: "POST" }),
  geoCountries: (signal?: AbortSignal) => request<GeoOption[]>("/api/geo/countries", { signal }),
  geoStates: (country: string, signal?: AbortSignal) =>
    request<GeoOption[]>(`/api/geo/states?country=${encodeURIComponent(country)}`, { signal }),
  geoCities: (country: string, state?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ country });
    if (state) params.set("state", state);
    return request<GeoOption[]>(`/api/geo/cities?${params}`, { signal });
  },
  geoNormalize: (text: string, signal?: AbortSignal) =>
    request<{ label: string }>("/api/geo/normalize", {
      method: "POST",
      body: JSON.stringify({ text }),
      signal,
    }),
};
