import assert from "node:assert/strict";
import test from "node:test";
import {
  composeAskQuestion,
  composerPlaceholder,
  detectComposerTrigger,
  filterAbilities,
  primaryAskAbility,
  replaceTriggerRange,
} from "../ask-composer.js";

test("detects @ mentions at the start of a token", () => {
  assert.deepEqual(detectComposerTrigger("@Ana", 4), {
    kind: "mention",
    query: "Ana",
    start: 0,
    end: 4,
  });
  assert.deepEqual(detectComposerTrigger("What about @ser", 15), {
    kind: "mention",
    query: "ser",
    start: 11,
    end: 15,
  });
  assert.equal(detectComposerTrigger("hello@ana", 9), null);
});

test("detects / abilities only at a word start", () => {
  assert.deepEqual(detectComposerTrigger("/who", 4), {
    kind: "ability",
    query: "who",
    start: 0,
    end: 4,
  });
  assert.deepEqual(detectComposerTrigger("and /talk", 9), {
    kind: "ability",
    query: "talk",
    start: 4,
    end: 9,
  });
  assert.equal(detectComposerTrigger("http://x", 8), null);
});

test("filters abilities by slash, label, or hint", () => {
  const talked = filterAbilities("talk");
  assert.equal(talked.length, 1);
  assert.equal(talked[0]?.id, "talked");
  assert.ok(filterAbilities("gmail").some((ability) => ability.id === "email"));
  assert.equal(filterAbilities("zzzz").length, 0);
});

test("composeAskQuestion names attached people when the text does not", () => {
  assert.equal(
    composeAskQuestion("what did we discuss in Lisbon?", [{ id: "1", name: "Ana Ruiz" }]),
    "what did we discuss in Lisbon? (Ana Ruiz)",
  );
  assert.equal(
    composeAskQuestion("", [{ id: "1", name: "Ana Ruiz" }]),
    "What do I know about Ana Ruiz?",
  );
});

test("replaceTriggerRange removes the trigger token", () => {
  const trigger = detectComposerTrigger("ask @An", 7);
  assert.ok(trigger);
  assert.equal(replaceTriggerRange("ask @An", trigger), "ask");
});

test("composerPlaceholder follows the attached ability and people", () => {
  assert.equal(
    composerPlaceholder([], ["about"]),
    "What do I know about…",
  );
  assert.equal(
    composerPlaceholder([{ id: "1", name: "Ana Ruiz" }], []),
    "Ask about Ana Ruiz…",
  );
});

test("primaryAskAbility prefers a retrieval mode over a source filter", () => {
  assert.equal(primaryAskAbility(["messages", "about"]), "about");
  assert.equal(primaryAskAbility(["email"]), "email");
  assert.equal(primaryAskAbility([]), null);
});
