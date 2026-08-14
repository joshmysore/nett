import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nett-onboarding-"));
process.env.NETT_DB_PATH = path.join(temporaryDirectory, "nett.db");
process.env.NETT_MESSAGES_DB = path.join(temporaryDirectory, "chat.db");

const { db } = await import("../../db.js");
const { getOnboardingState, getOwnerContext, setupStatus, updateOnboarding } = await import("../../setup.js");

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("maps legacy messages and optional phases onto conversations", () => {
  updateOnboarding({ phase: "messages" });
  assert.equal(getOnboardingState().phase, "conversations");
  updateOnboarding({ phase: "optional" });
  assert.equal(getOnboardingState().phase, "conversations");
});

test("stores owner hometowns and interests as confirmed setup context", () => {
  updateOnboarding({
    phase: "you",
    ownerDisplayName: "Josh",
    ownerHometowns: ["Dallas, Texas", "Austin"],
    ownerInterests: ["climbing", "climate"],
    ownerCaptureTranscript: "I grew up in Dallas and Austin. I'm into climbing and climate.",
  });
  const owner = getOwnerContext();
  assert.deepEqual(owner.hometowns, ["Dallas, Texas", "Austin"]);
  assert.deepEqual(owner.interests, ["climbing", "climate"]);
  assert.match(owner.captureTranscript || "", /Dallas/);
  const status = setupStatus();
  assert.equal(status.phase, "you");
  assert.deepEqual(status.ownerHometowns, ["Dallas, Texas", "Austin"]);
  assert.ok(status.milestones.gmail);
  assert.ok(status.milestones.whatsapp);
});

test("rejects an oversized owner name", () => {
  assert.throws(() => updateOnboarding({ ownerDisplayName: "x".repeat(81) }), /80/);
});
