import assert from "node:assert/strict";
import test from "node:test";
import { applyAskStreamEvent, emptyAskLiveAnswer } from "../ask-stream.js";

test("applyAskStreamEvent maps stage token and done", () => {
  let state = emptyAskLiveAnswer();
  state = applyAskStreamEvent(state, { type: "stage", id: "search", label: "Searching 12 people" });
  state = applyAskStreamEvent(state, {
    type: "meta",
    path: "cloud",
    provider: "openrouter:test",
    citations: [{ personId: "p1", label: "Alex", field: "name", value: "Partner", source: "notes" }],
  });
  state = applyAskStreamEvent(state, { type: "token", text: "I found " });
  state = applyAskStreamEvent(state, { type: "token", text: "**Alex**." });
  state = applyAskStreamEvent(state, {
    type: "done",
    answer: "I found **Alex**.",
    citations: [{ personId: "p1", label: "Alex", field: "name", value: "Partner", source: "notes" }],
    provider: "openrouter:test",
  });
  assert.equal(state.loading, false);
  assert.equal(state.text, "I found **Alex**.");
  assert.equal(state.stages.every((stage) => stage.done), true);
  assert.equal(state.citations[0]?.label, "Alex");
});
