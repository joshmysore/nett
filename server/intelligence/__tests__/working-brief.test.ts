import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nett-working-brief-"));
process.env.NETT_DB_PATH = path.join(temporaryDirectory, "nett.db");
process.env.NETT_MESSAGES_DB = path.join(temporaryDirectory, "chat.db");

const { createPerson, db } = await import("../../db.js");
const {
  fingerprintEvidence,
  getWorkingBrief,
  packEvidenceWithBrief,
  upsertWorkingBrief,
} = await import("../working-brief.js");

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test("working briefs round-trip and are not evidence tables", () => {
  const personId = createPerson("Ada Brief");
  const blocks = [
    { id: personId, title: "Ada Brief · profile", text: "relationship: collaborator\ncompany: Harbour" },
    { id: "comm:1", title: "Ada Brief · messages", text: "See you Thursday." },
  ];
  const fingerprint = fingerprintEvidence(blocks);
  upsertWorkingBrief({
    personId,
    body: "## Who\nAda is a collaborator at Harbour.",
    evidenceFingerprint: fingerprint,
    evidenceIds: blocks.map((block) => block.id),
    model: "stealth/ox-alpha",
    provider: "openrouter:stealth/ox-alpha",
    sourceQuestion: "Who is Ada Brief?",
  });

  const stored = getWorkingBrief(personId);
  assert.ok(stored);
  assert.match(stored.body, /Harbour/);
  assert.equal(stored.evidenceFingerprint, fingerprint);
  assert.deepEqual(stored.evidenceIds, [personId, "comm:1"]);

  const evidenceCount = (db.prepare("SELECT COUNT(*) AS count FROM evidence_documents").get() as { count: number }).count;
  assert.equal(evidenceCount, 0, "working briefs must not create evidence documents");
});

test("fresh brief packs synthesis plus message deltas only", () => {
  const personId = createPerson("Ben Brief");
  const blocks = [
    { id: personId, title: "Ben Brief · profile", text: "company: North" },
    { id: "memory:1", title: "Ben Brief · nett · memory", text: "Met at a climate summit." },
    { id: "comm:2", title: "Ben Brief · messages · conversation", text: "Coffee next week?" },
  ];
  const fingerprint = fingerprintEvidence(blocks);
  upsertWorkingBrief({
    personId,
    body: "Ben works at North.",
    evidenceFingerprint: fingerprint,
    evidenceIds: [personId, "memory:1"],
    model: "test",
    provider: "openrouter:test",
  });

  const packed = packEvidenceWithBrief(personId, "Ben Brief", blocks);
  assert.equal(packed.reused, true);
  assert.equal(packed.blocks[0]?.id, `working-brief:${personId}`);
  assert.ok(packed.blocks.some((block) => block.id === "comm:2"));
  assert.ok(!packed.blocks.some((block) => block.id === personId));
});

test("stale fingerprint forces a full evidence pack", () => {
  const personId = createPerson("Cam Brief");
  const blocks = [
    { id: personId, title: "Cam Brief · profile", text: "company: Old Co" },
  ];
  upsertWorkingBrief({
    personId,
    body: "Cam at Old Co.",
    evidenceFingerprint: "stale",
    evidenceIds: [personId],
  });
  const packed = packEvidenceWithBrief(personId, "Cam Brief", [
    { id: personId, title: "Cam Brief · profile", text: "company: New Co" },
  ]);
  assert.equal(packed.reused, false);
  assert.ok(packed.blocks.every((block) => !block.id.startsWith("working-brief:")));
});
