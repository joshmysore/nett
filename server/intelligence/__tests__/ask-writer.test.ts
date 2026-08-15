import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { InMemoryCredentialVault } from "../../platform/security/credential-vault.js";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nett-ask-writer-"));
process.env.NETT_DB_PATH = path.join(temporaryDirectory, "nett.db");
process.env.NETT_MESSAGES_DB = path.join(temporaryDirectory, "chat.db");
delete process.env.NETT_ASK_WRITER;
delete process.env.NETT_ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { db } = await import("../../db.js");
const { getAskWriterSettings, resetAskWriterVault, setAskWriterSettings } = await import("../ask-writer.js");

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("Ask writer defaults to local and does not claim a key", async () => {
  const settings = await getAskWriterSettings();
  assert.equal(settings.writer, "local");
  assert.equal(settings.hasKey, false);
  assert.match(settings.disclosure, /stay on this Mac/i);
});

test("saving an Anthropic key stays off-record until the writer is chosen", async () => {
  const vault = new InMemoryCredentialVault();
  resetAskWriterVault(vault);
  const saved = await setAskWriterSettings({
    writer: "anthropic",
    model: "claude-haiku-4-5",
    apiKey: "sk-ant-test",
  });
  assert.equal(saved.writer, "anthropic");
  assert.equal(saved.hasKey, true);
  assert.equal(saved.model, "claude-haiku-4-5");
  assert.match(saved.disclosure, /leave this Mac/);
  assert.equal(await vault.getString("ask-writer:anthropic"), "sk-ant-test");
  resetAskWriterVault();
});
