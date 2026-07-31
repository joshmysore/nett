import type { AgentAnswer, CommunicationPage, FullPerson, Overview, ParsedMemory, Person, SetupStatus } from "@/types";

export type PublicProfileSuggestion = {
  field: "linkedin_url" | "headline" | "job_title" | "company" | "location";
  value: string;
  confidence: number;
  reason: string;
  evidence: string;
  source: "linkedin-public";
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: options?.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

export const api = {
  bootstrap: () => request<Overview>("/api/bootstrap"),
  setupStatus: () => request<SetupStatus>("/api/setup/status"),
  updateSetup: (input: { phase?: SetupStatus["phase"]; ownerDisplayName?: string; skipStep?: string; complete?: boolean }) =>
    request<SetupStatus>("/api/setup/onboarding", { method: "PATCH", body: JSON.stringify(input) }),
  people: () => request<Person[]>("/api/people"),
  peoplePage: (input: { query?: string; filter?: "all" | "strong" | "due" | "cold"; page?: number; limit?: number }) => {
    const params = new URLSearchParams({
      q: input.query || "",
      filter: input.filter || "all",
      page: String(input.page || 1),
      limit: String(input.limit || 50),
    });
    return request<{ people: Person[]; total: number; page: number; limit: number }>(`/api/people/page?${params}`);
  },
  person: (id: string) => request<FullPerson>(`/api/people/${id}`),
  communications: (id: string, limit = 50, cursor?: string) => request<CommunicationPage>(
    `/api/people/${id}/communications?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
  ),
  updatePerson: (id: string, input: Record<string, unknown>) => request<FullPerson>(`/api/people/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  autofill: (id: string) => request<{ suggestions: { id?: string; field: string; value: unknown; confidence: number; reason: string; source: string; evidenceIds?: string[] }[] }>(`/api/people/${id}/autofill`, { method: "POST" }),
  previewLinkedIn: (id: string, input: { profileUrl: string; publicText: string }) =>
    request<{ profileUrl: string; suggestions: PublicProfileSuggestion[] }>(
      `/api/people/${id}/enrichment/linkedin/preview`,
      { method: "POST", body: JSON.stringify(input) }
    ),
  applyLinkedIn: (id: string, input: { profileUrl: string; publicText: string; acceptedFields: string[] }) =>
    request<{ person: FullPerson; applied: PublicProfileSuggestion[]; sourceRecordId: string }>(
      `/api/people/${id}/enrichment/linkedin/apply`,
      { method: "POST", body: JSON.stringify(input) }
    ),
  reviewSuggestion: (id: string, decision: "accepted" | "rejected", apply = false) =>
    request<{ id: string; decision: string; applied: boolean }>(`/api/inference/suggestions/${id}/review`, { method: "POST", body: JSON.stringify({ decision, apply }) }),
  relationshipSignals: (id: string) => request<{
    personId: string; calculatedAt: string; recency: number; cadenceDrift: number;
    reciprocity: number; channelDiversity: number; interactionFrequency: number;
    explanation: Record<string, unknown>;
  }>(`/api/people/${id}/signals`),
  intelligenceStatus: () => request<{
    ok: boolean; version?: string; selectedModel?: string; evidenceDocuments: number;
    embeddedDocuments: number; models: { name: string; size?: number }[];
  }>("/api/intelligence/status"),
  refreshIntelligence: (limit = 250) =>
    request<{ indexed: number; embedded: number; model?: string }>("/api/intelligence/index", { method: "POST", body: JSON.stringify({ limit }) }),
  search: (query: string) => request<Person[]>(`/api/search?q=${encodeURIComponent(query)}`),
  parseMemory: (text: string) => request<ParsedMemory>("/api/memories/parse", { method: "POST", body: JSON.stringify({ text }) }),
  saveMemory: (id: string, text: string, structured: Record<string, unknown>, source = "manual") => request<FullPerson>(`/api/people/${id}/memories`, { method: "POST", body: JSON.stringify({ text, structured, source }) }),
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
  configureGmail: (input: { accountId?: string; accountLabel?: string; clientId: string; clientSecret?: string; maxInitialMessages?: number }) =>
    request<{ accountId: string; redirectUri: string }>("/api/platform/gmail/configure", { method: "POST", body: JSON.stringify(input) }),
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
  importWhatsApp: (file: File, input: { accountId?: string; conversationId?: string; conversationTitle?: string; selfNames?: string; selfPhones?: string; dateOrder?: "DMY" | "MDY" | "YMD" }) => {
    const body = new FormData();
    body.append("file", file);
    Object.entries(input).forEach(([key, value]) => { if (value) body.append(key, value); });
    return request<{ recordsSeen: number; bundles: number; message: string }>("/api/platform/whatsapp/import", { method: "POST", body });
  },
  query: (query: string) => request<AgentAnswer>("/api/agent/query", { method: "POST", body: JSON.stringify({ query }) }),
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
  mergeQueue: () => request<{ sourceIdentityId: string; displayName: string; connectorId: string; raw: Record<string, unknown>; candidates: { suggestionId: string; personId: string; name: string; company?: string; confidence: number; reason: string }[] }[]>("/api/merges"),
  resolveMerge: (sourceIdentityId: string, personId?: string, createNew = false) => request<FullPerson>(`/api/merges/${sourceIdentityId}/resolve`, { method: "POST", body: JSON.stringify({ personId, createNew }) }),
  unmerge: (sourceIdentityId: string) => request<FullPerson>(`/api/identities/${sourceIdentityId}/unmerge`, { method: "POST" })
};
