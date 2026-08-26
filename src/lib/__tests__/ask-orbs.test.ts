import assert from "node:assert/strict";
import test from "node:test";
import { askOrbState } from "../../lib/ask-orbs.js";

test("ask retrieval stages map onto thinking-orb verbs", () => {
  assert.equal(askOrbState("extract"), "listening");
  assert.equal(askOrbState("search"), "searching");
  assert.equal(askOrbState("match"), "connecting");
  assert.equal(askOrbState("records"), "weaving");
  assert.equal(askOrbState("write"), "composing");
  assert.equal(askOrbState("escalate"), "working");
  assert.equal(askOrbState("unknown"), "working");
});
