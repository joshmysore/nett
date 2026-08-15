import assert from "node:assert/strict";
import test from "node:test";
import { extractCaptureWithModel } from "../llm.js";

test("LLM extract degrades to regex when Ollama is down", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
  }) as typeof fetch;
  try {
    const result = await extractCaptureWithModel("Sam Weil likes red wine from Spain");
    assert.equal(result.nameHint, "Sam Weil");
    assert.deepEqual(
      result.proposals.find((proposal) => proposal.field === "foods")?.values,
      ["Spanish red wine"],
    );
  } finally {
    globalThis.fetch = previous;
  }
});
