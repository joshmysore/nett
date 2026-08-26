import assert from "node:assert/strict";
import test from "node:test";
import { groupCitations, threadDayLabel, upsertStage } from "../ask-display.js";

test("groupCitations collapses people and keeps first eight", () => {
  const hits = groupCitations([
    { personId: "a", label: "Alex", field: "role", value: "Partner", source: "notes" },
    { personId: "a", label: "Alex", field: "note", value: "Met at Sequoia", source: "messages" },
    { personId: "b", label: "Blair", field: "role", value: "Founder", source: "notes" },
  ]);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.name, "Alex");
  assert.deepEqual(hits[0]?.sources, ["notes", "messages"]);
  assert.equal(hits[0]?.excerpts.length, 2);
});

test("upsertStage marks earlier stages done", () => {
  const first = upsertStage([], { id: "search", label: "Searching records" });
  const next = upsertStage(first, { id: "write", label: "Writing" });
  assert.equal(next[0]?.done, true);
  assert.equal(next[1]?.done, false);
});

test("threadDayLabel buckets recent dates", () => {
  assert.equal(threadDayLabel(new Date().toISOString()), "Today");
});
