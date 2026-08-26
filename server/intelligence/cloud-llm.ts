import type { AnswerCitation, AnswerEvidence, CitedAnswer, StructuredGenerationRequest } from "./ollama.js";

export type CloudWriter = "anthropic" | "openai" | "openrouter" | "groq";

export type CloudStreamEvent =
  | { type: "token"; text: string }
  | { type: "complete"; model: string };

export type CloudGenerateRequest = {
  writer: CloudWriter;
  model: string;
  apiKey: string;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

const DEFAULT_FETCH = fetch;

const OPENROUTER_HEADERS = {
  "HTTP-Referer": "http://127.0.0.1:5173",
  "X-OpenRouter-Title": "Nett",
} as const;

const OPENROUTER_IGNORED_PROVIDERS = ["anthropic", "openai"] as const;
const OPENROUTER_CHAT_MAX_TOKENS = 4096;
const OPENROUTER_TIMEOUT_MS = 180_000;
const DEFAULT_TIMEOUT_MS = 90_000;

function openRouterChatRouting(model: string): {
  ignore: string[];
  allow_fallbacks: false;
  only?: string[];
} {
  return {
    ignore: [...OPENROUTER_IGNORED_PROVIDERS],
    allow_fallbacks: false,
    ...(model.toLowerCase().startsWith("stealth/") ? { only: ["stealth"] } : {}),
  };
}

function chatTimeoutMs(writer: CloudWriter): number {
  return writer === "openrouter" ? OPENROUTER_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
}

function combineSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function isOpenAiCompatible(writer: CloudWriter): boolean {
  return writer === "openai" || writer === "openrouter" || writer === "groq";
}

function chatCompletionsUrl(writer: CloudWriter): string | null {
  if (writer === "openai") return "https://api.openai.com/v1/chat/completions";
  if (writer === "openrouter") return "https://openrouter.ai/api/v1/chat/completions";
  if (writer === "groq") return "https://api.groq.com/openai/v1/chat/completions";
  return null;
}

function embeddingsUrl(writer: CloudWriter): string | null {
  if (writer === "openai") return "https://api.openai.com/v1/embeddings";
  if (writer === "openrouter") return "https://openrouter.ai/api/v1/embeddings";
  return null;
}

function authHeaders(writer: CloudWriter, apiKey: string): Record<string, string> {
  if (writer === "anthropic") {
    return {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    ...(writer === "openrouter" ? OPENROUTER_HEADERS : {}),
  };
}

export function askSystemPrompt(): string {
  return [
    "You are Nett, a private relationship memory for one person on one Mac.",
    "You only see retrieved evidence documents attached to this turn — never assume the full graph.",
    "A block titled working brief is prior model synthesis for Ask reuse. It is not source evidence and must not be written into the profile.",
    "Prefer newer evidence blocks when they conflict with a working brief.",
    "Write a reasoned answer, not a field dump and not a one-line index card.",
    "Format with short paragraphs and markdown: headings when listing people, bullets for multiple matches, and **bold** person names.",
    "Do not emit a single undifferentiated wall of text.",
    "When the question is who someone is, cover: who they are; why they matter (relationship, how/where/when met); role and company; place and hometown; last contact; then one or two verbatim quotes from notes or messages when those exist.",
    "Answer the user's actual question. Do not force a biography unless they asked who someone is.",
    "Name people. If two people share a first name, distinguish them with company, place, or a quoted fact.",
    "Quote stored messages, emails, and notes verbatim when they answer the question. Keep dates that appear in evidence.",
    "If a constraint has no evidence, say so. Never invent facts.",
    "Never infer health, politics, religion, sexuality, ethnicity, or other protected traits. Absence of evidence is not evidence.",
    "Ask does not write or update records. Do not claim you saved anything.",
    "For a list question, list people with one distinguishing stored fact each.",
  ].join(" ");
}

export function citedPrompt(question: string, evidence: readonly AnswerEvidence[]): string {
  const blocks = evidence.map((item) =>
    `<evidence id=${JSON.stringify(item.id)} title=${JSON.stringify(item.title)}>\n${item.text}\n</evidence>`
  ).join("\n\n");
  return [
    "Answer using only the supplied evidence blocks. Write natural sentences, not labelled fields.",
    "Use short paragraphs, markdown lists, and **bold** names so the answer is scannable.",
    "Name people. If evidence is insufficient, say so.",
    `Question: ${question}`,
    blocks || "(No evidence blocks were retrieved.)",
  ].join("\n\n");
}

async function* readSse(
  response: Response,
  pickText: (payload: Record<string, unknown>) => string | null,
): AsyncGenerator<CloudStreamEvent> {
  if (!response.body) throw new CloudLlmError("Cloud model returned no body", "INVALID_RESPONSE");
  const decoder = new TextDecoder();
  let buffer = "";
  let model = "";
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of block.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (typeof payload.model === "string") model = payload.model;
        const text = pickText(payload);
        if (text) yield { type: "token", text };
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
  yield { type: "complete", model };
}

function openaiDeltaText(payload: Record<string, unknown>): string | null {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : null;
  const delta = first?.delta && typeof first.delta === "object" ? first.delta as Record<string, unknown> : null;
  return typeof delta?.content === "string" ? delta.content : null;
}

export class CloudLlmError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "INVALID_CONFIGURATION" | "INVALID_RESPONSE" | "CANCELLED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CloudLlmError";
  }
}

async function failedCloudResponse(writer: CloudWriter, response: Response): Promise<CloudLlmError> {
  const detail = await response.text().catch(() => "");
  let message = `${writer} request failed with status ${response.status}`;
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } | string };
    const err = parsed.error;
    const fromApi = typeof err === "string" ? err : err?.message;
    if (fromApi) message = fromApi;
  } catch {
    if (detail.trim()) message = `${message}: ${detail.slice(0, 200)}`;
  }
  return new CloudLlmError(message, "UNAVAILABLE");
}

export async function* streamCloudGenerate(request: CloudGenerateRequest): AsyncGenerator<CloudStreamEvent> {
  if (request.signal?.aborted) throw new CloudLlmError("Cloud request cancelled", "CANCELLED");
  const fetchImpl = request.fetchImpl ?? DEFAULT_FETCH;
  const signal = combineSignal(request.signal, chatTimeoutMs(request.writer));
  if (request.writer === "anthropic") {
    let response: Response;
    try {
      response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: authHeaders("anthropic", request.apiKey),
        body: JSON.stringify({
          model: request.model,
          max_tokens: 1200,
          system: request.system,
          stream: true,
          messages: [{ role: "user", content: request.prompt }],
        }),
        signal,
      });
    } catch (error) {
      if (request.signal?.aborted) throw new CloudLlmError("Cloud request cancelled", "CANCELLED", { cause: error });
      throw new CloudLlmError("Could not reach Anthropic", "UNAVAILABLE", { cause: error });
    }
    if (!response.ok) throw await failedCloudResponse("anthropic", response);
    yield* readSse(response, (payload) => {
      if (payload.type !== "content_block_delta") return null;
      const delta = payload.delta && typeof payload.delta === "object"
        ? payload.delta as Record<string, unknown>
        : null;
      return typeof delta?.text === "string" ? delta.text : null;
    });
    return;
  }

  const url = chatCompletionsUrl(request.writer);
  if (!url) throw new CloudLlmError("Unsupported writer", "INVALID_CONFIGURATION");
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: authHeaders(request.writer, request.apiKey),
      body: JSON.stringify({
        model: request.model,
        stream: true,
        max_tokens: request.writer === "openrouter" ? OPENROUTER_CHAT_MAX_TOKENS : 1200,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
        ...(request.writer === "openrouter"
          ? { provider: openRouterChatRouting(request.model) }
          : {}),
      }),
      signal,
    });
  } catch (error) {
    if (request.signal?.aborted) throw new CloudLlmError("Cloud request cancelled", "CANCELLED", { cause: error });
    throw new CloudLlmError(`Could not reach ${request.writer}`, "UNAVAILABLE", { cause: error });
  }
  if (!response.ok) throw await failedCloudResponse(request.writer, response);
  yield* readSse(response, openaiDeltaText);
}

function parseJsonContent(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

export async function generateCloudStructured<T>(
  request: CloudGenerateRequest & Pick<StructuredGenerationRequest<T>, "jsonSchema" | "validate">,
): Promise<T> {
  const fetchImpl = request.fetchImpl ?? DEFAULT_FETCH;
  const signal = combineSignal(request.signal, chatTimeoutMs(request.writer));
  const prompt = `${request.prompt}\n\nReturn JSON only. Schema:\n${JSON.stringify(request.jsonSchema)}`;
  const url = chatCompletionsUrl(request.writer);
  if (!url) throw new CloudLlmError("Structured generation needs an OpenAI-compatible writer", "INVALID_CONFIGURATION");
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: authHeaders(request.writer, request.apiKey),
      body: JSON.stringify({
        model: request.model,
        temperature: 0,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: prompt },
        ],
        ...(request.writer === "openrouter"
          ? { provider: openRouterChatRouting(request.model) }
          : {}),
      }),
      signal,
    });
  } catch (error) {
    if (request.signal?.aborted) throw new CloudLlmError("Cloud request cancelled", "CANCELLED", { cause: error });
    throw new CloudLlmError(`Could not reach ${request.writer}`, "UNAVAILABLE", { cause: error });
  }
  if (!response.ok) throw await failedCloudResponse(request.writer, response);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new CloudLlmError("Cloud model returned no JSON content", "INVALID_RESPONSE");
  }
  let value: unknown;
  try {
    value = parseJsonContent(content);
  } catch (error) {
    throw new CloudLlmError("Cloud model did not return valid JSON", "INVALID_RESPONSE", { cause: error });
  }
  if (request.validate && !request.validate(value)) {
    throw new CloudLlmError("Cloud JSON did not satisfy the requested contract", "INVALID_RESPONSE");
  }
  return value as T;
}

export async function embedCloud(request: {
  writer: CloudWriter;
  model: string;
  apiKey: string;
  input: readonly string[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<number[][]> {
  if (!request.input.length) return [];
  const url = embeddingsUrl(request.writer);
  if (!url) return [];
  const fetchImpl = request.fetchImpl ?? DEFAULT_FETCH;
  const signal = combineSignal(request.signal, 60_000);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: authHeaders(request.writer, request.apiKey),
      body: JSON.stringify({ model: request.model, input: request.input }),
      signal,
    });
  } catch (error) {
    if (request.signal?.aborted) throw new CloudLlmError("Cloud request cancelled", "CANCELLED", { cause: error });
    throw new CloudLlmError(`Could not reach ${request.writer} embeddings`, "UNAVAILABLE", { cause: error });
  }
  if (!response.ok) throw await failedCloudResponse(request.writer, response);
  const payload = await response.json() as { data?: Array<{ embedding?: unknown }> };
  const vectors = (payload.data || []).map((row) => row.embedding);
  if (vectors.some((value) => !Array.isArray(value) || value.some((number) => typeof number !== "number"))) {
    throw new CloudLlmError("Cloud embeddings were invalid", "INVALID_RESPONSE");
  }
  return vectors as number[][];
}

export async function answerWithCloud(request: CloudGenerateRequest & {
  question: string;
  evidence: readonly AnswerEvidence[];
}): Promise<CitedAnswer> {
  const prompt = citedPrompt(request.question, request.evidence);
  let answer = "";
  let model = request.model;
  for await (const event of streamCloudGenerate({ ...request, prompt })) {
    if (event.type === "token") answer += event.text;
    if (event.type === "complete" && event.model) model = event.model;
  }
  const citations: AnswerCitation[] = request.evidence.slice(0, 8).map((item) => ({
    evidenceId: item.id,
  }));
  return { answer: answer.trim(), citations, model };
}

export function cloudStreamPrompt(question: string, evidence: readonly AnswerEvidence[]): string {
  return citedPrompt(question, evidence);
}
