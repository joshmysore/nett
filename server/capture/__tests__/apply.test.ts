import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nett-capture-apply-"));
process.env.NETT_DB_PATH = path.join(temporaryDirectory, "nett.db");

const { addMemory, createPerson, db, getPerson } = await import("../../db.js");
const { extractCapture } = await import("../extract.js");

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("approved food likes are merged onto the person, not only stored as memory", () => {
  const id = createPerson("Sam Weil", "manual");
  const text = "Sam Weil likes red wine from Spain";
  const extraction = extractCapture(text);
  const foods = extraction.proposals.find((proposal) => proposal.field === "foods");
  assert.ok(foods);

  const updated = addMemory(id, text, {
    memory: text,
    foods: foods.values,
    transcript: text,
  }, "manual");

  assert.deepEqual(updated?.foods, ["Spanish red wine"]);
  const again = addMemory(id, text, { foods: ["Spanish red wine"] }, "manual");
  assert.deepEqual(again?.foods, ["Spanish red wine"]);

  const person = getPerson(id);
  assert.deepEqual(person?.foods, ["Spanish red wine"]);
  assert.equal((person as { follow_up_date?: string } | null)?.follow_up_date || "", "");
});
