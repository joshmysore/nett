export type IndexDocumentKind = "identity" | "conversation" | "interaction" | "memory" | "profile-field";

export interface IndexDocument {
  id: string;
  personId?: string;
  kind: IndexDocumentKind;
  text: string;
  source: string;
  sourceRecordId: string;
  occurredAt?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface IndexMutationResult {
  inserted: number;
  updated: number;
  deleted: number;
}

export interface LexicalIndexPort {
  upsert(documents: readonly IndexDocument[], options?: { signal?: AbortSignal }): Promise<IndexMutationResult>;
  remove(documentIds: readonly string[], options?: { signal?: AbortSignal }): Promise<number>;
  search(query: string, options: RetrievalOptions): Promise<RetrievalHit[]>;
}

export interface VectorIndexPort {
  upsert(
    documents: ReadonlyArray<IndexDocument & { embedding: readonly number[] }>,
    options?: { signal?: AbortSignal }
  ): Promise<IndexMutationResult>;
  remove(documentIds: readonly string[], options?: { signal?: AbortSignal }): Promise<number>;
  search(embedding: readonly number[], options: RetrievalOptions): Promise<RetrievalHit[]>;
}

export interface EmbeddingPort {
  readonly dimensions: number;
  embed(texts: readonly string[], options?: { signal?: AbortSignal }): Promise<readonly (readonly number[])[]>;
}

export interface RetrievalOptions {
  limit: number;
  personIds?: readonly string[];
  kinds?: readonly IndexDocumentKind[];
  sources?: readonly string[];
  occurredAfter?: string;
  occurredBefore?: string;
  signal?: AbortSignal;
}

export interface EvidenceSpan {
  documentId: string;
  source: string;
  sourceRecordId: string;
  start: number;
  end: number;
  quote: string;
  occurredAt?: string;
}

export interface RetrievalHit {
  document: IndexDocument;
  score: number;
  scoreKind: "lexical" | "vector" | "hybrid" | "reranked";
  highlights: EvidenceSpan[];
}

export interface HybridRetrievalQuery {
  text: string;
  options: RetrievalOptions;
  lexicalWeight?: number;
  vectorWeight?: number;
}

export interface HybridRetrievalPort {
  retrieve(query: HybridRetrievalQuery): Promise<RetrievalHit[]>;
}

export interface RerankerPort {
  rerank(query: string, hits: readonly RetrievalHit[], options?: { signal?: AbortSignal }): Promise<RetrievalHit[]>;
}

export type AutofillValue = string | number | boolean | readonly string[] | null;

export interface AutofillSuggestion {
  id: string;
  personId: string;
  field: string;
  proposedValue: AutofillValue;
  confidence: number;
  rationale: string;
  evidence: EvidenceSpan[];
  model?: string;
  createdAt: string;
  status: "pending" | "accepted" | "rejected" | "superseded";
}

export interface AutofillSuggestionBatch {
  id: string;
  personId: string;
  suggestions: AutofillSuggestion[];
  sourceDocumentIds: string[];
  generatedAt: string;
}

export interface AutofillFeedback {
  suggestionId: string;
  decision: "accepted" | "rejected";
  decidedAt: string;
  originalValue: AutofillValue;
  finalValue?: AutofillValue;
  reason?: "incorrect" | "stale" | "insufficient-evidence" | "duplicate" | "privacy" | "other";
  note?: string;
}

export interface AutofillFeedbackPort {
  recordFeedback(feedback: AutofillFeedback, options?: { signal?: AbortSignal }): Promise<void>;
  getFeedback(suggestionIds: readonly string[], options?: { signal?: AbortSignal }): Promise<AutofillFeedback[]>;
}

export type RelationshipSignalKind =
  | "interaction-frequency"
  | "interaction-recency"
  | "response-reciprocity"
  | "conversation-depth"
  | "shared-context"
  | "follow-up-commitment"
  | "introduction-potential"
  | "relationship-decay";

export interface RelationshipSignalContribution {
  feature: string;
  value: number | string | boolean;
  weight: number;
  contribution: number;
  explanation: string;
  evidence: EvidenceSpan[];
}

export interface RelationshipSignal {
  id: string;
  personId: string;
  kind: RelationshipSignalKind;
  score: number;
  confidence: number;
  window: { start?: string; end: string };
  explanation: string;
  contributions: RelationshipSignalContribution[];
  computedAt: string;
  algorithmVersion: string;
}

export interface RelationshipSignalPort {
  compute(personId: string, options?: { signal?: AbortSignal; asOf?: string }): Promise<RelationshipSignal[]>;
}
