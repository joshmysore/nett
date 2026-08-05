import assert from "node:assert/strict";
import test from "node:test";
import { extractCapture, type CaptureField } from "../extract.js";

const TODAY = new Date("2026-07-31T00:00:00Z");

const valueOf = (text: string, field: CaptureField) =>
  extractCapture(text, TODAY).proposals.find((proposal) => proposal.field === field)?.value;

const BRIEF =
  "Met Ana in Lisbon through Maya. She works in climate finance, speaks Portuguese, "
  + "Spanish and English, grew up in Porto, and I should follow up in September about "
  + "the Berlin conference.";

test("extracts the reviewable operations from a messy capture", () => {
  const result = extractCapture(BRIEF, TODAY);

  assert.equal(result.nameHint, "Ana");
  assert.equal(valueOf(BRIEF, "where_met"), "Lisbon");
  assert.equal(valueOf(BRIEF, "location"), "Lisbon");
  assert.equal(valueOf(BRIEF, "hometown"), "Porto");
  assert.equal(valueOf(BRIEF, "industry"), "climate finance");
  assert.equal(valueOf(BRIEF, "mutuals"), "Maya");
  assert.equal(valueOf(BRIEF, "how_met"), "Introduced by Maya");
  assert.equal(valueOf(BRIEF, "follow_up_date"), "2026-09-01");

  const languages = result.proposals.find((proposal) => proposal.field === "languages");
  assert.deepEqual(languages?.values, ["Portuguese", "Spanish", "English"]);
});

test("keeps the transcript verbatim", () => {
  const messy = "  Met Ana in Lisbon.  \n Trailing space kept.  ";
  assert.equal(extractCapture(messy, TODAY).transcript, messy);
});

test("every proposal carries a resolvable evidence span", () => {
  const result = extractCapture(BRIEF, TODAY);
  assert.ok(result.proposals.length > 0);
  for (const proposal of result.proposals) {
    assert.ok(proposal.evidence.length > 0, `${proposal.field} has empty evidence`);
    assert.ok(
      BRIEF.includes(proposal.evidence),
      `${proposal.field} evidence is not a substring of the transcript`,
    );
    assert.ok(proposal.confidence > 0 && proposal.confidence <= 1);
  }
});

test("proposes nothing when the text carries no facts", () => {
  const result = extractCapture("Good chat today.", TODAY);
  assert.deepEqual(result.proposals, []);
  assert.equal(result.nameHint, null);
});

test("does not invent a follow-up date when none is mentioned", () => {
  assert.equal(valueOf("Met Ana in Lisbon.", "follow_up_date"), undefined);
});

test("reads an explicit ISO follow-up date", () => {
  assert.equal(valueOf("Follow up with her on 2026-11-04 about the raise.", "follow_up_date"), "2026-11-04");
});

test("reads a relative follow-up window", () => {
  assert.equal(valueOf("Follow up in 2 weeks.", "follow_up_date"), "2026-08-14");
});

test("rolls a past month forward to its next occurrence", () => {
  assert.equal(valueOf("Follow up in March about the move.", "follow_up_date"), "2027-03-01");
});

test("ignores words that are not languages", () => {
  const result = extractCapture("She speaks bluntly and quickly.", TODAY);
  assert.equal(result.proposals.find((proposal) => proposal.field === "languages"), undefined);
});

test("stops a captured place at a connector", () => {
  assert.equal(valueOf("Met Ana in Lisbon through Maya.", "where_met"), "Lisbon");
});

test("handles non-ASCII names and places", () => {
  const text = "Met Zoë in München through Łukasz. She speaks German and Polish.";
  const result = extractCapture(text, TODAY);
  assert.equal(result.nameHint, "Zoë");
  assert.equal(valueOf(text, "where_met"), "München");
  assert.equal(valueOf(text, "mutuals"), "Łukasz");
  assert.deepEqual(
    result.proposals.find((proposal) => proposal.field === "languages")?.values,
    ["German", "Polish"],
  );
});

test("extraction is pure and repeatable", () => {
  assert.deepEqual(extractCapture(BRIEF, TODAY), extractCapture(BRIEF, TODAY));
});
