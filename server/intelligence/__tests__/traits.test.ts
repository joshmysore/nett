import assert from "node:assert/strict";
import test from "node:test";
import {
  collectTraitSuggestions,
  suggestCultureFromName,
  suggestGenderFromName,
  suggestOnlinePersonality,
  suggestFoodsFromMessages,
} from "../traits.js";

test("gender is suggested from a known given name and stays reviewable", () => {
  const suggestion = suggestGenderFromName({ preferred_name: "Priya Sharma" });
  assert.ok(suggestion);
  assert.equal(suggestion.field, "gender");
  assert.equal(suggestion.value, "female");
  assert.ok(suggestion.confidence < 1, "never presented as certain");
  assert.match(suggestion.reason, /Accept only if correct/i);
});

test("gender prefers pronouns in messages over the name table", () => {
  const messages = [
    "She said she would call tomorrow.",
    "I told her about the plan.",
    "Her reply was quick.",
    "She confirmed hers.",
  ];
  const suggestion = suggestGenderFromName({ preferred_name: "Alex Rivera" }, messages);
  assert.ok(suggestion);
  assert.equal(suggestion.value, "female");
  assert.match(suggestion.reason, /Pronouns/);
});

test("culture is suggested from family name with an explicit non-ethnicity note", () => {
  const suggestion = suggestCultureFromName({ preferred_name: "Harish Mysore", last_name: "Mysore" });
  assert.ok(suggestion);
  assert.equal(suggestion.field, "culture");
  assert.equal(suggestion.value, "South Asian");
  assert.match(suggestion.reason, /not ethnicity/i);
});

test("online_personality returns adjective lists from message style", () => {
  const messages = [
    "haha that is funny lol",
    "thanks so much, I appreciate it",
    "lol yeah let's do it",
    "please let me know what you think",
    "thanks again!!",
    "curious what you think about this",
    "wondering if we should circle back",
  ];
  const suggestion = suggestOnlinePersonality({}, messages);
  assert.ok(suggestion);
  assert.equal(suggestion.field, "online_personality");
  assert.ok(Array.isArray(suggestion.value));
  const adjectives = suggestion.value as string[];
  assert.ok(adjectives.includes("playful"));
  assert.ok(adjectives.includes("courteous"));
  assert.ok(adjectives.length >= 2);
});

test("foods are proposed from explicit mentions in messages", () => {
  const suggestion = suggestFoodsFromMessages({}, [
    "Want to get sushi later?",
    "Or biryani if you prefer",
    "Coffee first though",
  ]);
  assert.ok(suggestion);
  assert.deepEqual(suggestion?.value, ["sushi", "biryani", "coffee"]);
});

test("collectTraitSuggestions skips fields that are already filled", () => {
  const suggestions = collectTraitSuggestions(
    {
      preferred_name: "Priya Sharma",
      last_name: "Sharma",
      gender: "female",
      culture: "South Asian",
      foods: ["dosa"],
      online_personality: ["warm"],
    },
    ["haha thanks lol please"],
  );
  assert.equal(suggestions.length, 0);
});
