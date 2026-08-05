import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHometownValue, normalizeLocationValue } from "../normalize.js";

test("normalizeLocationValue canonicalises US city shorthand", async () => {
  assert.equal(await normalizeLocationValue("Dallas, TX"), "Dallas, TX, United States");
  assert.equal(await normalizeLocationValue("New York, NY"), "New York, NY, United States");
  assert.equal(await normalizeLocationValue("Dublin, Ireland"), "Dublin, Ireland");
});

test("normalizeLocationValue accepts country-only and aliases", async () => {
  assert.equal(await normalizeLocationValue("United States"), "United States");
  assert.equal(await normalizeLocationValue("USA"), "United States");
  assert.equal(await normalizeLocationValue("Hong Kong"), "Hong Kong");
  assert.equal(await normalizeLocationValue("London, UK"), "London, United Kingdom");
  assert.equal(await normalizeLocationValue("Boston, MA"), "Boston, MA, United States");
});

test("normalizeHometownValue repairs flattened City/ST tokens", async () => {
  const result = await normalizeHometownValue(["Boston", "MA", "Dallas", "TX"]);
  assert.ok(result.includes("Boston, MA, United States"));
  assert.ok(result.includes("Dallas, TX, United States"));
});

test("normalizeHometownValue marks metro hierarchy", async () => {
  const result = await normalizeHometownValue(["Mysore", "Bangalore metro"]);
  assert.ok(result.some((entry) => entry.includes("⊏") && entry.includes("Mysore")));
  assert.ok(result.some((entry) => entry === "Bangalore metro" || entry.endsWith("Bangalore metro")));
});
