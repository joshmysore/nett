import type { AnswerCitation, AnswerEvidence, CitedAnswer } from "./ollama.js";

export type CloudWriter = "anthropic" | "openai";

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

function combineSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
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

function citedPrompt(question: string, evidence: readonly AnswerEvidence[]): string {
  const blocks = evidence.map((item) =>
    `<evidence id=${JSON.stringify(item.id)} title=${JSON.stringify(item.title)}>\n${item.text}\n</evidence>`
  ).join("\n\n");
  return [
    "Answer the question using only the supplied evidence.",
    "Name people. If evidence is insufficient, say so.",
    "Never invent facts or infer health, politics, religion, sexuality, or ethnicity.",
    `Question: ${question}`,
    blocks,
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

export async function* streamCloudGenerate(request: CloudGenerateRequest): AsyncGenerator<CloudStreamEvent> {
  const fetchImpl = request.fetchImpl ?? DEFAULT_FETCH;
  const signal = combineSignal(request.signal, 90_000);
  if (request.writer === "anthropic") {
    let response: Response;
    try {
      response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": request.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: 800,
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
    if (!response.ok) {
      throw new CloudLlmError(`Anthropic request failed with status ${response.status}`, "UNAVAILABLE");
    }
    yield* readSse(response, (payload) => {
      if (payload.type !== "content_block_delta") return null;
      const delta = payload.delta && typeof payload.delta === "object"
        ? payload.delta as Record<string, unknown>
        : null;
      return typeof delta?.text === "string" ? delta.text : null;
    });
    return;
  }

  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        stream: true,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.prompt },
        ],
      }),
      signal,
    });
  } catch (error) {
    if (request.signal?.aborted) throw new CloudLlmError("Cloud request cancelled", "CANCELLED", { cause: error });
    throw new CloudLlmError("Could not reach OpenAI", "UNAVAILABLE", { cause: error });
  }
  if (!response.ok) {
    throw new CloudLlmError(`OpenAI request failed with status ${response.status}`, "UNAVAILABLE");
  }
  yield* readSse(response, (payload) => {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : null;
    const delta = first?.delta && typeof first.delta === "object" ? first.delta as Record<string, unknown> : null;
    return typeof delta?.content === "string" ? delta.content : null;
  });
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
  const citations: AnswerCitation[] = request.evidence.slice(0, 6).map((item) => ({
    evidenceId: item.id,
  }));
  return { answer: answer.trim(), citations, model };
}

export function cloudStreamPrompt(question: string, evidence: readonly AnswerEvidence[]): string {
  return citedPrompt(question, evidence);
}
