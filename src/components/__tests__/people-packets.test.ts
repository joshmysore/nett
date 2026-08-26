import assert from "node:assert/strict";
import test from "node:test";
import { packetSummary, peekFacts, sourceLabels, type PacketFields } from "../../lib/packet-summary.js";

function person(overrides: Partial<PacketFields> = {}): PacketFields {
  return {
    hometown: ["Walnut Creek"],
    sources: ["nett"],
    ...overrides,
  };
}

test("packet summaries use stored facts and never invent a memory", () => {
  const brief = packetSummary(person({
    relationship: "girlfriend",
    company: "Cornerstone Research",
    location: "Menlo Park",
    sources: ["messages", "apple-contacts"],
  }));
  assert.match(brief, /Girlfriend/);
  assert.match(brief, /Cornerstone Research\. Held in Messages, Contacts/);
  assert.doesNotMatch(brief, /probably|seems|might be/i);

  const remembered = packetSummary(person({
    relationship: "colleague",
    hometown: [],
    quick_memories: "Met at HMUN China in 2024.",
  }));
  assert.match(remembered, /Colleague\. Met at HMUN China in 2024/);
  assert.doesNotMatch(remembered, /Held in/);
});

test("source labels name connectors and drop the local store", () => {
  assert.deepEqual(sourceLabels(["nett", "messages", "apple-contacts", "whatsapp"]), [
    "Messages",
    "Contacts",
    "WhatsApp",
  ]);
});

test("peek facts cite stored fields and omit empty ones", () => {
  const facts = peekFacts({
    relationship: "girlfriend",
    company: "Cornerstone Research",
    location: "Menlo Park",
    sources: ["messages", "apple-contacts"],
  });
  assert.deepEqual(facts.map((fact) => fact.label), ["Relationship", "Role", "Place", "Sources"]);
  assert.equal(facts[0].value, "Girlfriend");
  assert.match(facts.find((fact) => fact.label === "Sources")?.detail || "", /Held in Messages, Contacts/);
  assert.equal(peekFacts({ sources: ["nett"] }).length, 0);
});
