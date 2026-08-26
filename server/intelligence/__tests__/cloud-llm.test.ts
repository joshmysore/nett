import assert from "node:assert/strict";
import test from "node:test";
import { streamCloudGenerate } from "../cloud-llm.js";

function sse(events: string[]): Response {
  return new Response(`${events.join("\n\n")}\n\n`, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

test("Anthropic stream yields text deltas only", async () => {
  const tokens: string[] = [];
  for await (const event of streamCloudGenerate({
    writer: "anthropic",
    model: "claude-haiku-4-5",
    apiKey: "test-key",
    system: "sys",
    prompt: "prompt",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://api.anthropic.com/v1/messages");
      assert.equal((init?.headers as Record<string, string>)["x-api-key"], "test-key");
      return sse([
        `data: ${JSON.stringify({ type: "content_block_delta", delta: { text: "Ada " } })}`,
        `data: ${JSON.stringify({ type: "content_block_delta", delta: { text: "Fong" } })}`,
        `data: ${JSON.stringify({ type: "message_stop" })}`,
      ]);
    },
  })) {
    if (event.type === "token") tokens.push(event.text);
  }
  assert.deepEqual(tokens, ["Ada ", "Fong"]);
});

test("OpenRouter stream yields choice deltas only", async () => {
  const tokens: string[] = [];
  for await (const event of streamCloudGenerate({
    writer: "openrouter",
    model: "stealth/ox-alpha",
    apiKey: "test-key",
    system: "sys",
    prompt: "prompt",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://openrouter.ai/api/v1/chat/completions");
      assert.match(String((init?.headers as Record<string, string>).authorization), /test-key/);
      assert.equal((init?.headers as Record<string, string>)["X-OpenRouter-Title"], "Nett");
      const body = JSON.parse(String(init?.body || "{}")) as {
        model?: string;
        provider?: { ignore?: string[]; allow_fallbacks?: boolean; only?: string[] };
      };
      assert.equal(body.model, "stealth/ox-alpha");
      assert.deepEqual(body.provider?.ignore, ["anthropic", "openai"]);
      assert.equal(body.provider?.allow_fallbacks, false);
      assert.deepEqual(body.provider?.only, ["stealth"]);
      return sse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}`,
        "data: [DONE]",
      ]);
    },
  })) {
    if (event.type === "token") tokens.push(event.text);
  }
  assert.deepEqual(tokens, ["Hello"]);
});

test("Groq stream yields choice deltas only", async () => {
  const tokens: string[] = [];
  for await (const event of streamCloudGenerate({
    writer: "groq",
    model: "openai/gpt-oss-120b",
    apiKey: "test-key",
    system: "sys",
    prompt: "prompt",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://api.groq.com/openai/v1/chat/completions");
      assert.match(String((init?.headers as Record<string, string>).authorization), /test-key/);
      return sse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}`,
        "data: [DONE]",
      ]);
    },
  })) {
    if (event.type === "token") tokens.push(event.text);
  }
  assert.deepEqual(tokens, ["Hello"]);
});

test("OpenAI stream yields choice deltas only", async () => {
  const tokens: string[] = [];
  for await (const event of streamCloudGenerate({
    writer: "openai",
    model: "gpt-4o-mini",
    apiKey: "test-key",
    system: "sys",
    prompt: "prompt",
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://api.openai.com/v1/chat/completions");
      assert.match(String((init?.headers as Record<string, string>).authorization), /test-key/);
      return sse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}`,
        "data: [DONE]",
      ]);
    },
  })) {
    if (event.type === "token") tokens.push(event.text);
  }
  assert.deepEqual(tokens, ["Hello"]);
});

test("OpenRouter errors include the API message", async () => {
  await assert.rejects(
    async () => {
      for await (const event of streamCloudGenerate({
        writer: "openrouter",
        model: "stealth/ox-alpha",
        apiKey: "test-key",
        system: "sys",
        prompt: "prompt",
        fetchImpl: async () => new Response(JSON.stringify({ error: { message: "no credits" } }), { status: 402 }),
      })) {
        void event;
      }
    },
    /no credits/,
  );
});
