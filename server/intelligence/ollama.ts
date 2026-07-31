import type { EvidenceSpan } from "./contracts.js";

export interface OllamaModel {
  name: string;
  modifiedAt?: string;
  size?: number;
  digest?: string;
  details?: Record<string, unknown>;
}

export interface OllamaHealth {
  ok: boolean;
  version?: string;
  latencyMs: number;
}

export interface StructuredGenerationRequest<T> {
  model: string;
  prompt: string;
  system?: string;
  jsonSchema: Record<string, unknown>;
  options?: Record<string, number | string | boolean>;
  signal?: AbortSignal;
  validate?: (value: unknown) => value is T;
}

export interface AnswerEvidence {
  id: string;
  title: string;
  text: string;
  spans?: EvidenceSpan[];
}

export interface CitedAnswerRequest {
  model: string;
  question: string;
  evidence: readonly AnswerEvidence[];
  system?: string;
  signal?: AbortSignal;
}

export interface AnswerCitation {
  evidenceId: string;
  quote?: string;
}

export interface CitedAnswer {
  answer: string;
  citations: AnswerCitation[];
  model: string;
}

export type OllamaStreamEvent =
  | { type: "token"; text: string }
  | { type: "complete"; model: string; promptTokens?: number; completionTokens?: number; totalDurationNs?: number };

export interface StreamingGenerationRequest {
  model: string;
  prompt: string;
  system?: string;
  format?: "json" | Record<string, unknown>;
  options?: Record<string, number | string | boolean>;
  signal?: AbortSignal;
}

export interface OllamaProviderOptions {
  baseUrl?: string;
  allowRemote?: boolean;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class OllamaProviderError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "INVALID_CONFIGURATION" | "INVALID_RESPONSE" | "MODEL_NOT_FOUND" | "CANCELLED",
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "OllamaProviderError";
  }
}

function validateBaseUrl(value: string, allowRemote: boolean): URL {
  const url = new URL(value);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  if (url.protocol !== "http:" && !(allowRemote && url.protocol === "https:")) {
    throw new OllamaProviderError("Ollama URL must use HTTP locally or HTTPS when remote access is explicitly enabled", "INVALID_CONFIGURATION");
  }
  if (!allowRemote && !localHosts.has(url.hostname)) {
    throw new OllamaProviderError("Remote Ollama hosts are disabled by default", "INVALID_CONFIGURATION");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new OllamaProviderError("Ollama URL must not contain credentials, query, or fragment", "INVALID_CONFIGURATION");
  }
  return url;
}

function combineSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const timeout = AbortSignal.timeout(timeoutMs);
  return {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    cleanup: () => undefined
  };
}

const citedAnswerSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "citations"],
  properties: {
    answer: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidenceId"],
        properties: {
          evidenceId: { type: "string" },
          quote: { type: "string" }
        }
      }
    }
  }
};

export class OllamaProvider {
  private readonly baseUrl: URL;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaProviderOptions = {}) {
    this.baseUrl = validateBaseUrl(options.baseUrl ?? "http://127.0.0.1:11434", options.allowRemote === true);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(signal?: AbortSignal): Promise<OllamaHealth> {
    const started = performance.now();
    try {
      const response = await this.request("/api/version", { method: "GET" }, signal);
      const payload = await response.json() as { version?: unknown };
      return {
        ok: true,
        version: typeof payload.version === "string" ? payload.version : undefined,
        latencyMs: Math.round(performance.now() - started)
      };
    } catch (error) {
      if (error instanceof OllamaProviderError && error.code === "CANCELLED") throw error;
      return { ok: false, latencyMs: Math.round(performance.now() - started) };
    }
  }

  async listModels(signal?: AbortSignal): Promise<OllamaModel[]> {
    const response = await this.request("/api/tags", { method: "GET" }, signal);
    const payload = await response.json() as { models?: unknown };
    if (!Array.isArray(payload.models)) {
      throw new OllamaProviderError("Ollama returned an invalid model list", "INVALID_RESPONSE");
    }
    return payload.models.map((model: any) => ({
      name: String(model.name ?? model.model ?? ""),
      modifiedAt: typeof model.modified_at === "string" ? model.modified_at : undefined,
      size: typeof model.size === "number" ? model.size : undefined,
      digest: typeof model.digest === "string" ? model.digest : undefined,
      details: model.details && typeof model.details === "object" ? model.details : undefined
    })).filter((model) => model.name);
  }

  async embed(model: string, input: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    if (!model || !input.length) return [];
    const response = await this.request("/api/embed", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ model, input })
    }, signal);
    const payload = await response.json() as { embeddings?: unknown };
    if (!Array.isArray(payload.embeddings) || payload.embeddings.some((value) =>
      !Array.isArray(value) || value.some((number) => typeof number !== "number")
    )) {
      throw new OllamaProviderError("Ollama returned invalid embeddings", "INVALID_RESPONSE");
    }
    return payload.embeddings as number[][];
  }

  async generateStructured<T>(request: StructuredGenerationRequest<T>): Promise<T> {
    const response = await this.request("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        system: request.system,
        format: request.jsonSchema,
        options: request.options,
        stream: false
      })
    }, request.signal);
    const payload = await response.json() as { response?: unknown; error?: unknown };
    if (typeof payload.response !== "string") {
      throw new OllamaProviderError("Ollama returned an invalid generation response", "INVALID_RESPONSE");
    }
    let value: unknown;
    try {
      value = JSON.parse(payload.response);
    } catch (error) {
      throw new OllamaProviderError("Ollama did not return valid structured JSON", "INVALID_RESPONSE", { cause: error });
    }
    if (request.validate && !request.validate(value)) {
      throw new OllamaProviderError("Ollama JSON did not satisfy the requested contract", "INVALID_RESPONSE");
    }
    return value as T;
  }

  async answerWithCitations(request: CitedAnswerRequest): Promise<CitedAnswer> {
    const evidenceIds = new Set(request.evidence.map((item) => item.id));
    const evidence = request.evidence.map((item) =>
      `<evidence id=${JSON.stringify(item.id)} title=${JSON.stringify(item.title)}>\n${item.text}\n</evidence>`
    ).join("\n\n");
    const prompt = [
      "Answer the question using only the supplied evidence.",
      "Every factual claim must be supported by a citation whose evidenceId exactly matches an evidence block.",
      "If evidence is insufficient, say so. Return only the requested JSON object.",
      `Question: ${request.question}`,
      evidence
    ].join("\n\n");
    const generated = await this.generateStructured<{ answer: string; citations: AnswerCitation[] }>({
      model: request.model,
      prompt,
      system: request.system,
      jsonSchema: citedAnswerSchema,
      signal: request.signal,
      validate: (value): value is { answer: string; citations: AnswerCitation[] } => {
        if (!value || typeof value !== "object") return false;
        const candidate = value as Record<string, unknown>;
        return typeof candidate.answer === "string"
          && Array.isArray(candidate.citations)
          && candidate.citations.every((citation) =>
            citation && typeof citation === "object"
            && typeof (citation as Record<string, unknown>).evidenceId === "string"
          );
      }
    });
    if (generated.citations.some((citation) => !evidenceIds.has(citation.evidenceId))) {
      throw new OllamaProviderError("Ollama cited evidence that was not supplied", "INVALID_RESPONSE");
    }
    return { ...generated, model: request.model };
  }

  async *streamGenerate(request: StreamingGenerationRequest): AsyncGenerator<OllamaStreamEvent> {
    const response = await this.request("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify({
        model: request.model,
        prompt: request.prompt,
        system: request.system,
        format: request.format,
        options: request.options,
        stream: true
      })
    }, request.signal);
    if (!response.body) throw new OllamaProviderError("Ollama streaming response has no body", "INVALID_RESPONSE");

    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) {
          const event = this.parseStreamLine(line, request.model);
          if (event) yield event;
        }
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const event = this.parseStreamLine(buffer.trim(), request.model);
      if (event) yield event;
    }
  }

  private parseStreamLine(line: string, fallbackModel: string): OllamaStreamEvent | undefined {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(line) as Record<string, unknown>;
    } catch (error) {
      throw new OllamaProviderError("Ollama stream contained invalid JSON", "INVALID_RESPONSE", { cause: error });
    }
    if (typeof payload.error === "string") {
      throw new OllamaProviderError(payload.error, "UNAVAILABLE");
    }
    if (payload.done === true) {
      return {
        type: "complete",
        model: typeof payload.model === "string" ? payload.model : fallbackModel,
        promptTokens: typeof payload.prompt_eval_count === "number" ? payload.prompt_eval_count : undefined,
        completionTokens: typeof payload.eval_count === "number" ? payload.eval_count : undefined,
        totalDurationNs: typeof payload.total_duration === "number" ? payload.total_duration : undefined
      };
    }
    return typeof payload.response === "string" && payload.response
      ? { type: "token", text: payload.response }
      : undefined;
  }

  private async request(path: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const combined = combineSignal(signal, this.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), { ...init, signal: combined.signal });
    } catch (error) {
      if (combined.signal.aborted && signal?.aborted) {
        throw new OllamaProviderError("Ollama request cancelled", "CANCELLED", { cause: error });
      }
      throw new OllamaProviderError("Could not reach Ollama", "UNAVAILABLE", { cause: error });
    } finally {
      combined.cleanup();
    }
    if (!response.ok) {
      if (response.status === 404) {
        throw new OllamaProviderError("Ollama endpoint or requested model was not found", "MODEL_NOT_FOUND");
      }
      throw new OllamaProviderError(`Ollama request failed with status ${response.status}`, "UNAVAILABLE");
    }
    return response;
  }
}
