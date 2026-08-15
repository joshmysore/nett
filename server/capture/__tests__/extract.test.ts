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

test("extracts person name and food likes into structured foods", () => {
  const text = "Sam Weil likes red wine from Spain";
  const result = extractCapture(text, TODAY);
  assert.equal(result.nameHint, "Sam Weil");
  const foods = result.proposals.find((proposal) => proposal.field === "foods");
  assert.deepEqual(foods?.values, ["Spanish red wine"]);
  assert.equal(result.proposals.find((proposal) => proposal.field === "follow_up_date"), undefined);
});

test("routes non-food likes to interests", () => {
  const text = "Maya likes hiking and pottery";
  const result = extractCapture(text, TODAY);
  assert.equal(result.nameHint, "Maya");
  assert.equal(result.proposals.find((proposal) => proposal.field === "foods"), undefined);
  assert.deepEqual(
    result.proposals.find((proposal) => proposal.field === "interests")?.values,
    ["hiking", "pottery"],
  );
});

test("does not invent preference structure from infinitives", () => {
  const result = extractCapture("Sam likes to travel more.", TODAY);
  assert.equal(result.proposals.find((proposal) => proposal.field === "foods"), undefined);
  assert.equal(result.proposals.find((proposal) => proposal.field === "interests"), undefined);
});

const FIXTURES: Array<{
  text: string;
  name?: string;
  fields: Partial<Record<CaptureField, string | string[]>>;
}> = [
  { text: "Sam Weil likes red wine from Spain", name: "Sam Weil", fields: { foods: ["Spanish red wine"] } },
  { text: "Maya likes hiking and pottery", name: "Maya", fields: { interests: ["hiking", "pottery"] } },
  { text: "She grew up in Porto.", fields: { hometown: "Porto" } },
  { text: "Ada is from Lisbon originally.", name: "Ada", fields: { hometown: "Lisbon" } },
  { text: "Jules lives in Philadelphia.", name: "Jules", fields: { location: "Philadelphia" } },
  { text: "Ken works at Stripe.", name: "Ken", fields: { company: "Stripe" } },
  { text: "Priya is a product designer at Notion.", name: "Priya", fields: { job_title: "product designer" } },
  { text: "She speaks Portuguese and French.", fields: { languages: ["Portuguese", "French"] } },
  { text: "Met Ana in Lisbon through Maya.", name: "Ana", fields: { where_met: "Lisbon", how_met: "Introduced by Maya" } },
  { text: "We met in June at the Berlin conference.", fields: { when_met: "June" } },
  { text: "Her birthday is March 4.", fields: { birthday: "03-04" } },
  { text: "Born on 1991-11-18.", fields: { birthday: "1991-11-18" } },
  { text: "Favourite food is dosa and filter coffee.", fields: { foods: ["dosa", "filter coffee"] } },
  { text: "He works in climate finance.", fields: { industry: "climate finance" } },
  {
    text: "Met Zoë in München. She speaks German, works at DeepL, and likes Riesling.",
    name: "Zoë",
    fields: { where_met: "München", company: "DeepL", foods: ["Riesling"] },
  },
];

test("fifteen capture fixtures produce reviewable field operations", () => {
  assert.equal(FIXTURES.length, 15);
  for (const fixture of FIXTURES) {
    const result = extractCapture(fixture.text, TODAY);
    if (fixture.name) assert.equal(result.nameHint, fixture.name, fixture.text);
    for (const [field, expected] of Object.entries(fixture.fields)) {
      const proposal = result.proposals.find((item) => item.field === field);
      assert.ok(proposal, `${fixture.text} missing ${field}`);
      if (Array.isArray(expected)) {
        assert.deepEqual(proposal?.values ?? proposal?.value.split(",").map((part) => part.trim()), expected);
      } else {
        assert.equal(proposal?.value, expected, `${fixture.text} ${field}`);
      }
      assert.ok(fixture.text.includes(proposal!.evidence));
    }
  }
});
