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
delete process.env.NETT_OPENROUTER_API_KEY;
delete process.env.OPENROUTER_API_KEY;

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

test("saving an OpenRouter key stores it off-record", async () => {
  const vault = new InMemoryCredentialVault();
  resetAskWriterVault(vault);
  const saved = await setAskWriterSettings({
    writer: "openrouter",
    model: "stealth/ox-alpha",
    apiKey: "sk-or-test",
  });
  assert.equal(saved.writer, "openrouter");
  assert.equal(saved.hasKey, true);
  assert.equal(saved.model, "stealth/ox-alpha");
  assert.match(saved.disclosure, /Ox Alpha/);
  assert.match(saved.disclosure, /not Anthropic or OpenAI/);
  assert.equal(await vault.getString("ask-writer:openrouter"), "sk-or-test");
  resetAskWriterVault();
});

test("OpenRouter always uses Ox Alpha", async () => {
  const vault = new InMemoryCredentialVault();
  resetAskWriterVault(vault);
  const claude = await setAskWriterSettings({
    writer: "openrouter",
    model: "anthropic/claude-sonnet-4.6",
    apiKey: "sk-or-test",
  });
  assert.equal(claude.model, "stealth/ox-alpha");
  const gemini = await setAskWriterSettings({
    writer: "openrouter",
    model: "google/gemini-2.5-flash",
  });
  assert.equal(gemini.model, "stealth/ox-alpha");
  assert.match(gemini.disclosure, /Ox Alpha/);
  resetAskWriterVault();
});

test("legacy hosted writers become OpenRouter Ox Alpha", async () => {
  const vault = new InMemoryCredentialVault();
  resetAskWriterVault(vault);
  const saved = await setAskWriterSettings({
    writer: "anthropic",
    model: "claude-haiku-4-5",
    apiKey: "sk-or-test",
  });
  assert.equal(saved.writer, "openrouter");
  assert.equal(saved.model, "stealth/ox-alpha");
  assert.equal(await vault.getString("ask-writer:openrouter"), "sk-or-test");
  resetAskWriterVault();
});
