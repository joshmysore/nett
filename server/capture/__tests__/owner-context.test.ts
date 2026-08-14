import assert from "node:assert/strict";
import test from "node:test";
import { extractOwnerContext } from "../owner-context.js";

test("extracts a couple of hometowns and interests from spoken first person", () => {
  const text = "I grew up in Dallas and Austin. I'm into climbing and climate.";
  const result = extractOwnerContext(text);
  assert.deepEqual(result.hometowns, ["Dallas", "Austin"]);
  assert.deepEqual(result.interests, ["climbing", "climate"]);
  assert.equal(result.transcript, text);
  assert.equal(result.proposals.length, 2);
  for (const proposal of result.proposals) {
    assert.ok(text.includes(proposal.evidence));
    assert.ok(proposal.confidence > 0 && proposal.confidence <= 1);
  }
});

test("keeps city-region pairs when split on and", () => {
  const result = extractOwnerContext("I'm from Dallas, Texas and Lisbon.");
  assert.deepEqual(result.hometowns, ["Dallas, Texas", "Lisbon"]);
});

test("reads labelled lists", () => {
  const result = extractOwnerContext("Hometowns: Porto, Lisbon. Interests: climbing, design.");
  assert.deepEqual(result.hometowns, ["Porto", "Lisbon"]);
  assert.deepEqual(result.interests, ["climbing", "design"]);
});

test("does not treat a memory about someone else as owner context", () => {
  const result = extractOwnerContext(
    "Met Ana in Lisbon through Maya. She grew up in Porto and works in climate finance.",
  );
  assert.deepEqual(result.hometowns, []);
  assert.deepEqual(result.interests, []);
});

test("does not invent structure from a greeting", () => {
  const result = extractOwnerContext("Hey, just getting started.");
  assert.deepEqual(result.proposals, []);
  assert.deepEqual(result.hometowns, []);
  assert.deepEqual(result.interests, []);
});

test("keeps the transcript verbatim", () => {
  const messy = "  I'm from Dallas.  \n";
  assert.equal(extractOwnerContext(messy).transcript, messy);
});

test("reads typographic apostrophes in I'm from / I'm into", () => {
  const result = extractOwnerContext("I’m from Dallas. I’m into climbing.");
  assert.deepEqual(result.hometowns, ["Dallas"]);
  assert.deepEqual(result.interests, ["climbing"]);
});

test("extraction is pure and repeatable", () => {
  const text = "I grew up in Dallas. I care about climbing.";
  assert.deepEqual(extractOwnerContext(text), extractOwnerContext(text));
});
