import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hometownFromInstitution,
  hometownSuggestionsFromInstitutions,
} from "../hometown.js";

test("hometownFromInstitution reads place after a high school comma", () => {
  assert.equal(
    hometownFromInstitution("Lincoln High School, Springfield, IL"),
    "Springfield, IL",
  );
});

test("hometownFromInstitution reads a leading city in the school name", () => {
  assert.equal(hometownFromInstitution("Austin High School"), "Austin");
});

test("hometownFromInstitution ignores universities without early-education cues", () => {
  assert.equal(hometownFromInstitution("Stanford University"), null);
});

test("hometownSuggestionsFromInstitutions skips existing hometowns", () => {
  const suggestions = hometownSuggestionsFromInstitutions(
    ["Riverside High School, Portland"],
    ["Portland"],
  );
  assert.equal(suggestions.length, 0);
});
