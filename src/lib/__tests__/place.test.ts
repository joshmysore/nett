import assert from "node:assert/strict";
import test from "node:test";
import {
  composeSubareaLabel,
  flattenHometownGroups,
  formatHometownEntry,
  formatPlace,
  groupHometownEntries,
  hometownEntries,
  orderHometownEntries,
  parseHometownEntry,
  splitPlaceLabel,
  subareaDisplayName,
} from "../place.js";

test("splitPlaceLabel treats TX, United States as region not city", () => {
  assert.deepEqual(splitPlaceLabel("TX, United States"), {
    region: "TX",
    country: "United States",
  });
  assert.deepEqual(splitPlaceLabel("Dallas, TX, United States"), {
    city: "Dallas",
    region: "TX",
    country: "United States",
  });
});

test("formatPlace builds City, Region, Country", () => {
  assert.equal(
    formatPlace({ city: "Dallas", region: "TX", country: "United States" }),
    "Dallas, TX, United States",
  );
  assert.equal(formatPlace({ country: "Singapore" }), "Singapore");
  assert.equal(formatPlace({ region: "TX", country: "United States" }), "TX, United States");
});

test("hometown hierarchy encodes and parses with ⊏", () => {
  const encoded = formatHometownEntry({
    label: "Plano, TX, United States",
    of: "Dallas, TX, United States",
  });
  assert.equal(encoded, "Plano, TX, United States ⊏ Dallas, TX, United States");
  assert.deepEqual(parseHometownEntry(encoded), {
    label: "Plano, TX, United States",
    of: "Dallas, TX, United States",
  });
});

test("groupHometownEntries nests sub-areas under the main place", () => {
  const groups = groupHometownEntries([
    { label: "Plano, TX, United States", of: "Dallas, TX, United States" },
    { label: "Dallas, TX, United States" },
    { label: "Boston, MA, United States" },
  ]);
  assert.deepEqual(groups, [
    { main: "Dallas, TX, United States", subareas: ["Plano"] },
    { main: "Boston, MA, United States", subareas: [] },
  ]);
});

test("flattenHometownGroups writes sub-areas under the main without peer rows", () => {
  assert.deepEqual(
    flattenHometownGroups([
      { main: "Dallas, TX, United States", subareas: ["Plano", "Frisco"] },
    ]),
    [
      "Dallas, TX, United States",
      "Plano, TX, United States ⊏ Dallas, TX, United States",
      "Frisco, TX, United States ⊏ Dallas, TX, United States",
    ],
  );
});

test("composeSubareaLabel inherits region and country from the parent", () => {
  assert.equal(
    composeSubareaLabel("Plano", "Dallas, TX, United States"),
    "Plano, TX, United States",
  );
  assert.equal(subareaDisplayName("Plano, TX, United States", "Dallas, TX, United States"), "Plano");
});

test("orderHometownEntries keeps mains before their sub-areas", () => {
  const ordered = orderHometownEntries([
    { label: "Plano, TX, United States", of: "Dallas, TX, United States" },
    { label: "Dallas, TX, United States" },
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.label),
    ["Dallas, TX, United States", "Plano, TX, United States"],
  );
});

test("hometownEntries accepts arrays of full labels", () => {
  assert.deepEqual(
    hometownEntries(["Mysore, India ⊏ Bangalore metro", "Bangalore metro"]),
    [
      { label: "Mysore, India", of: "Bangalore metro" },
      { label: "Bangalore metro" },
    ],
  );
});
