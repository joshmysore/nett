import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nett-freshness-"));
process.env.NETT_DB_PATH = path.join(temporaryDirectory, "nett.db");
delete process.env.NETT_FRESHNESS;

await import("../../db.js");
const {
  INTERVAL_MS,
  freshnessStatus,
  setFreshnessEnabled,
  startFreshnessAgent,
  stopFreshnessAgent,
} = await import("../freshness.js");

test.after(() => {
  stopFreshnessAgent();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("WhatsApp and Messages default to a six-hour local cadence", () => {
  assert.equal(INTERVAL_MS.whatsapp, 6 * 60 * 60 * 1000);
  assert.equal(INTERVAL_MS.messages, 6 * 60 * 60 * 1000);
});

test("freshness toggle persists and exposes the laptop-awake constraint", () => {
  startFreshnessAgent({
    isBusy: () => false,
    sync: async () => ({ message: "ok" }),
  });
  assert.equal(freshnessStatus().enabled, false);
  const enabled = setFreshnessEnabled(true);
  assert.equal(enabled.enabled, true);
  assert.match(enabled.constraint, /awake/i);
  assert.equal(enabled.intervalsMs.whatsapp, 6 * 60 * 60 * 1000);
  const disabled = setFreshnessEnabled(false);
  assert.equal(disabled.enabled, false);
  stopFreshnessAgent();
});
