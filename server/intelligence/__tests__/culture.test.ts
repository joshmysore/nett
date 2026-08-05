import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeCultureValue, parseCultureLabels } from "../culture.js";

describe("normalizeCultureValue", () => {
  it("title-cases and maps common shorthand", () => {
    assert.equal(normalizeCultureValue("chinese"), "Chinese");
    assert.equal(normalizeCultureValue("korean"), "Korean");
    assert.equal(normalizeCultureValue("indian"), "South Asian");
    assert.equal(normalizeCultureValue("south indian"), "Tamil / South Indian");
    assert.equal(normalizeCultureValue("jewish"), "Jewish / Hebrew");
    assert.equal(normalizeCultureValue("wasp"), "Anglo");
  });

  it("splits newlines and commas into multi-labels", () => {
    assert.equal(normalizeCultureValue("syrian\ncanadian"), "Syrian / Canadian");
    assert.equal(normalizeCultureValue("spanish\nhatian"), "Hispanic / Latino / Haitian");
    assert.equal(normalizeCultureValue("peruvian\nokinawan"), "Peruvian / Okinawan / Japanese");
    assert.equal(normalizeCultureValue("half indian, half white"), "South Asian / Anglo");
    assert.equal(normalizeCultureValue("latina, white"), "Hispanic / Latino / Anglo");
    assert.equal(
      normalizeCultureValue("african-american\niranian-palestianian"),
      "African American / Iranian / Palestinian",
    );
    assert.equal(normalizeCultureValue("singapore (chinese)"), "Chinese / Singaporean");
    assert.equal(normalizeCultureValue("waisan (chinese)"), "Toishanese / Chinese");
  });

  it("keeps several mixed-heritage labels and does not split multi-word vocab", () => {
    assert.equal(
      normalizeCultureValue("Chinese / Korean / Anglo"),
      "Chinese / Korean / Anglo",
    );
    assert.equal(
      normalizeCultureValue("African American / Iranian / Palestinian"),
      "African American / Iranian / Palestinian",
    );
    assert.ok(parseCultureLabels("Chinese / Korean / Anglo / Jewish / Hebrew").length >= 3);
  });

  it("drops broader buckets when a specific is present", () => {
    assert.equal(normalizeCultureValue("South Asian / Tamil / South Indian"), "Tamil / South Indian");
    assert.equal(normalizeCultureValue("East Asian / Chinese"), "Chinese");
  });
});
