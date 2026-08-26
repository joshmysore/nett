import assert from "node:assert/strict";
import test from "node:test";
import { buildAskSuggestions } from "../ask-suggestions.js";

const person = (id: string, name: string, extras: Record<string, unknown> = {}) => ({
  id,
  name,
  preferred_name: name,
  hometown: [],
  languages: [],
  skills: [],
  interests: [],
  foods: [],
  online_personality: [],
  institutions: [],
  mutuals: [],
  tags: [],
  methods: [],
  memory_count: 0,
  interaction_count: 0,
  relationship_strength: 0,
  priority: 0,
  warmth: 0,
  intro_potential: 0,
  source_confidence: 0,
  sources: [],
  ...extras,
}) as import("../../types.js").Person;

test("buildAskSuggestions uses stored people and places, never demo names", () => {
  const suggestions = buildAskSuggestions({
    recent: [
      person("1", "Ada Fong", { location: "Paris, Île-de-France, France" }),
      person("2", "Wilson Cheung"),
    ],
    cold: [person("3", "Ted Sunshine")],
    places: ["Lisbon, Portugal"],
  });
  assert.equal(suggestions.length, 4);
  assert.match(suggestions[0]!.text, /Ada Fong/);
  assert.equal(suggestions.some((item) => /Serena|spicy food/i.test(item.text)), false);
  assert.equal(suggestions.some((item) => /Lisbon|Paris/.test(item.text)), true);
  assert.equal(suggestions[0]!.people[0]?.id, "1");
});

test("buildAskSuggestions falls back without inventing people", () => {
  const suggestions = buildAskSuggestions({ recent: [], cold: [], places: [] });
  assert.deepEqual(suggestions.map((item) => item.text), [
    "Who have I talked to recently?",
    "What group chats am I in?",
  ]);
});
