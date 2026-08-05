import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectDictationCapability } from "../dictation.js";

describe("detectDictationCapability", () => {
  it("reports unavailable when SpeechRecognition is missing", () => {
    const capability = detectDictationCapability();
    assert.equal(capability.backend, "unavailable");
    assert.equal(capability.available, false);
    assert.equal(capability.mayUseRemoteService, false);
    assert.match(capability.disclosure, /type or paste/i);
  });
});
