import assert from "node:assert/strict";
import test from "node:test";
import { OllamaProvider } from "../ollama.js";

test("Ollama rejects remote hosts unless explicitly enabled", () => {
  assert.throws(
    () => new OllamaProvider({ baseUrl: "http://example.com:11434" }),
    /Remote Ollama hosts are disabled/
  );
  assert.doesNotThrow(() => new OllamaProvider());
  assert.doesNotThrow(() => new OllamaProvider({
    baseUrl: "https://ollama.example.test",
    allowRemote: true
  }));
});

test("Ollama health reports a local version", async () => {
  const provider = new OllamaProvider({
    fetchImpl: async () => new Response(JSON.stringify({ version: "test" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  const health = await provider.health();
  assert.equal(health.ok, true);
  assert.equal(health.version, "test");
});

test("Ollama embeddings are validated before retrieval uses them", async () => {
  const provider = new OllamaProvider({
    fetchImpl: async (_input, init) => {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ embeddings: [[0.25, 0.5], [0.75, 1]] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.deepEqual(await provider.embed("local-model", ["one", "two"]), [[0.25, 0.5], [0.75, 1]]);
});
