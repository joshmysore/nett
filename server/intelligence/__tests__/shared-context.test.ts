import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nett-shared-context-"));
process.env.NETT_DB_PATH = path.join(temporaryDirectory, "nett.db");
process.env.NETT_MESSAGES_DB = path.join(temporaryDirectory, "chat.db");
delete process.env.NETT_OLLAMA_MODEL;

globalThis.fetch = (async () => {
  throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
}) as typeof fetch;

const { createPerson, db, getPerson, updatePerson } = await import("../../db.js");
const { getOwnerContext, setAppSetting } = await import("../../setup.js");
const { collectSharedContextSuggestions } = await import("../shared-context.js");
const { intelligentAutofill, reviewInferenceSuggestion } = await import("../service.js");

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function seed(name: string, metadata: Record<string, unknown>): string {
  const id = createPerson(name);
  updatePerson(id, metadata);
  return id;
}

test("shared context proposes mutuals from Dallas + same school overlap", () => {
  seed("Maya Chen", {
    hometown: ["Dallas, Texas"],
    location: "Dallas, TX",
    institutions: ["Southern Methodist University"],
    mutuals: ["Jordan Lee", "Sam Ortiz"],
  });
  seed("Jordan Lee", {
    hometown: ["Dallas"],
    institutions: ["Southern Methodist University"],
    mutuals: ["Maya Chen"],
  });
  seed("Sam Ortiz", {
    hometown: ["Dallas, Texas"],
    institutions: ["SMU"],
    company: "Stripe",
    mutuals: ["Maya Chen"],
  });
  // Unrelated person — should not appear.
  seed("Priya Nair", {
    hometown: ["Lisbon"],
    institutions: ["University of Lisbon"],
    mutuals: [],
  });

  const targetId = seed("Alex Rivera", {
    hometown: ["Dallas, Texas"],
    institutions: ["Southern Methodist University"],
    mutuals: [],
  });
  const person = getPerson(targetId) as Record<string, unknown>;
  const suggestions = collectSharedContextSuggestions(person);
  const mutuals = suggestions.find((item) => item.field === "mutuals");
  assert.ok(mutuals, "expected a mutuals suggestion");
  const names = (mutuals!.value as string[]).map((name) => name.toLocaleLowerCase());
  assert.equal(names.includes("maya chen"), true);
  assert.equal(names.includes("jordan lee"), true);
  assert.equal(names.includes("sam ortiz"), true);
  assert.equal(names.includes("priya nair"), false);
  assert.equal(mutuals!.evidence.length > 0, true);
  assert.equal(mutuals!.evidence[0]?.sourceType, "shared-context");
  assert.match(mutuals!.reason, /shared context|mutual/i);
});

test("reciprocal mutuals are proposed even without place overlap", () => {
  seed("Ben Cole", {
    hometown: ["Seattle"],
    mutuals: ["Casey Quinn"],
  });
  const targetId = seed("Casey Quinn", {
    hometown: ["Austin"],
    mutuals: [],
  });
  const suggestions = collectSharedContextSuggestions(getPerson(targetId) as Record<string, unknown>);
  const mutuals = suggestions.find((item) => item.field === "mutuals");
  assert.ok(mutuals);
  assert.equal(
    (mutuals!.value as string[]).some((name) => name.toLocaleLowerCase() === "ben cole"),
    true,
  );
  assert.ok(mutuals!.confidence >= 0.85);
});

test("empty institution can be filled from high-overlap peer consensus", () => {
  seed("Dana Wu", {
    hometown: ["Dallas, Texas"],
    location: "Dallas",
    institutions: ["Greenhill School"],
    company: "Notion",
  });
  seed("Eli Park", {
    hometown: ["Dallas"],
    location: "Dallas, TX",
    institutions: ["Greenhill School"],
    company: "Notion",
  });
  const targetId = seed("Fran Okonkwo", {
    hometown: ["Dallas, Texas"],
    location: "Dallas",
    company: "Notion",
    institutions: [],
  });
  const suggestions = collectSharedContextSuggestions(getPerson(targetId) as Record<string, unknown>);
  const institutions = suggestions.find((item) => item.field === "institutions");
  assert.ok(institutions, "expected institutions consensus");
  assert.deepEqual(institutions!.value, ["Greenhill School"]);
});

test("intelligentAutofill surfaces shared-context mutuals without the local model", async () => {
  seed("Harper Diaz", {
    hometown: ["Dallas, Texas"],
    institutions: ["Booker T. Washington High School, Dallas"],
    mutuals: ["Ian Brooks"],
  });
  seed("Ian Brooks", {
    hometown: ["Dallas"],
    institutions: ["Booker T. Washington High School"],
    mutuals: ["Harper Diaz"],
  });
  const targetId = seed("Jules Nguyen", {
    hometown: ["Dallas, Texas"],
    institutions: ["Booker T. Washington High School, Dallas"],
    mutuals: [],
  });

  const result = await intelligentAutofill(targetId, { generate: false });
  const mutuals = result.suggestions.find((item) => item.field === "mutuals");
  assert.ok(mutuals, "autofill should include shared-context mutuals");
  assert.equal(mutuals!.sourceType, "derived-signal");
  assert.match(mutuals!.source, /shared-context/);
  assert.equal(
    Array.isArray(mutuals!.value)
      && (mutuals!.value as string[]).some((name) => /harper|ian/i.test(name)),
    true,
  );

  // Rejection fingerprint suppresses an identical re-proposal.
  reviewInferenceSuggestion(mutuals!.id, "rejected", false);
  const again = await intelligentAutofill(targetId, { generate: false });
  assert.equal(
    again.suggestions.some((item) => item.field === "mutuals"),
    false,
    "rejected mutuals suggestion must not return without new evidence",
  );
});

test("does not invent mutuals from a single weak signal", () => {
  seed("Only Texas A", { hometown: ["Texas"], mutuals: [] });
  seed("Only Texas B", { hometown: ["Texas"], mutuals: [] });
  const targetId = seed("Only Texas C", { hometown: ["Texas"], mutuals: [] });
  const suggestions = collectSharedContextSuggestions(getPerson(targetId) as Record<string, unknown>);
  assert.equal(
    suggestions.some((item) => item.field === "mutuals"),
    false,
    "state-only overlap must not propose mutuals",
  );
});

test("company and city alone do not propose mutuals", () => {
  seed("Alice Google SF", {
    location: "San Francisco, CA",
    company: "Google",
    mutuals: [],
  });
  seed("Bob Google SF", {
    location: "San Francisco",
    company: "Google",
    mutuals: [],
  });
  const targetId = seed("Carol Google SF", {
    location: "San Francisco, California",
    company: "Google",
    mutuals: [],
  });
  const suggestions = collectSharedContextSuggestions(getPerson(targetId) as Record<string, unknown>);
  assert.equal(
    suggestions.some((item) => item.field === "mutuals"),
    false,
    "coworkers in the same city are not assumed mutuals",
  );
});

test("unresolved ghost mutuals are never proposed", () => {
  seed("Dana Strong", {
    hometown: ["Dallas, Texas"],
    institutions: ["Greenhill School"],
    mutuals: ["Ghost Name Not In DB", "Eli Peer"],
  });
  seed("Eli Peer", {
    hometown: ["Dallas"],
    institutions: ["Greenhill School"],
    mutuals: ["Dana Strong"],
  });
  const targetId = seed("Fran Target", {
    hometown: ["Dallas, Texas"],
    institutions: ["Greenhill School"],
    mutuals: [],
  });
  const suggestions = collectSharedContextSuggestions(getPerson(targetId) as Record<string, unknown>);
  const mutuals = suggestions.find((item) => item.field === "mutuals");
  assert.ok(mutuals);
  const names = (mutuals!.value as string[]).map((name) => name.toLocaleLowerCase());
  assert.equal(names.includes("ghost name not in db"), false);
  assert.equal(names.includes("dana strong"), true);
  assert.equal(names.includes("eli peer"), true);
});

test("rejected mutual names stay suppressed when the batch grows", async () => {
  seed("Harper One", {
    hometown: ["Dallas, Texas"],
    institutions: ["Booker T. Washington High School"],
    mutuals: [],
  });
  const targetId = seed("Jules Target", {
    hometown: ["Dallas, Texas"],
    institutions: ["Booker T. Washington High School"],
    mutuals: [],
  });

  const first = await intelligentAutofill(targetId, { generate: false });
  const mutuals = first.suggestions.find((item) => item.field === "mutuals");
  assert.ok(mutuals);
  reviewInferenceSuggestion(mutuals!.id, "rejected", false);

  seed("Ian Two", {
    hometown: ["Dallas"],
    institutions: ["Booker T. Washington High School"],
    mutuals: [],
  });

  const second = await intelligentAutofill(targetId, { generate: false });
  const again = second.suggestions.find((item) => item.field === "mutuals");
  if (again) {
    const names = (again.value as string[]).map((name) => name.toLocaleLowerCase());
    assert.equal(names.includes("harper one"), false, "previously rejected Harper must stay out");
  }
});

test("confidence is not inflated by a single reciprocal in a mixed batch", () => {
  seed("Reciprocal Peer", {
    hometown: ["Austin, Texas"],
    institutions: ["St. Mark's School of Texas"],
    mutuals: ["Mixed Target"],
  });
  seed("School Peer", {
    hometown: ["Dallas, Texas"],
    institutions: ["St. Mark's School of Texas"],
    mutuals: [],
  });
  const targetId = seed("Mixed Target", {
    hometown: ["Dallas, Texas"],
    institutions: ["St. Mark's School of Texas"],
    mutuals: [],
  });
  const suggestions = collectSharedContextSuggestions(getPerson(targetId) as Record<string, unknown>);
  const mutuals = suggestions.find((item) => item.field === "mutuals");
  assert.ok(mutuals);
  assert.ok(
    mutuals!.confidence < 0.9,
    `mixed-batch confidence should stay below a pure reciprocal (${mutuals!.confidence})`,
  );
});

test("owner hometown fills a missing hometown along existing edges only", () => {
  setAppSetting("onboarding", {
    phase: "complete",
    ownerHometowns: ["Dallas, Texas"],
    ownerInterests: ["climbing"],
  });
  assert.deepEqual(getOwnerContext().hometowns, ["Dallas, Texas"]);
  seed("Maya Neighbor", {
    hometown: ["Dallas, Texas"],
    mutuals: ["Alex Gap"],
  });
  seed("Jordan Neighbor", {
    hometown: ["Dallas"],
    mutuals: ["Alex Gap"],
  });
  seed("Lisbon Stranger", {
    hometown: ["Lisbon"],
    mutuals: [],
  });
  const targetId = seed("Alex Gap", {
    hometown: [],
    mutuals: ["Maya Neighbor", "Jordan Neighbor"],
  });
  const person = getPerson(targetId) as Record<string, unknown>;
  assert.equal(Array.isArray(person.hometown) && person.hometown.length === 0, true, `hometown was ${JSON.stringify(person.hometown)}`);
  const suggestions = collectSharedContextSuggestions(person);
  const hometown = suggestions.find((item) => item.field === "hometown");
  assert.ok(hometown, `expected an owner-seeded hometown suggestion, got ${suggestions.map((item) => item.field).join(",") || "none"}`);
  const values = Array.isArray(hometown!.value) ? hometown!.value : [hometown!.value];
  assert.equal(
    values.some((value) => /dallas/i.test(String(value))),
    true,
  );
  assert.match(hometown!.reason, /your hometowns/i);
});

test("owner hometown alone does not invent mutuals among strangers", () => {
  setAppSetting("onboarding", {
    phase: "complete",
    ownerHometowns: ["Dallas, Texas"],
    ownerInterests: [],
  });
  seed("Dallas Stranger A", { hometown: ["Dallas, Texas"], mutuals: [] });
  seed("Dallas Stranger B", { hometown: ["Dallas"], mutuals: [] });
  const targetId = seed("Dallas Stranger C", { hometown: ["Dallas, Texas"], mutuals: [] });
  const suggestions = collectSharedContextSuggestions(getPerson(targetId) as Record<string, unknown>);
  assert.equal(
    suggestions.some((item) => item.field === "mutuals"),
    false,
    "people who only share the owner's hometown must not be assumed to know each other",
  );
});
