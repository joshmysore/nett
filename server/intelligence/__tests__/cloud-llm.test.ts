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
