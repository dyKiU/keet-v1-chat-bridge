import assert from "node:assert/strict";
import test from "node:test";
import { deriveTopicCandidatesFromKeetInvite, deriveTopicFromKeetInvite } from "../src/keet-link.js";

test("deriveTopicFromKeetInvite decodes first z32 key from pear keet invite", () => {
  const invite = "pear://keet/yyyoryarywdyqnyjbefoadeqbhebnrounoktcfaadrpbs8y7daxo";

  assert.equal(
    deriveTopicFromKeetInvite(invite),
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  );

  assert.equal(deriveTopicCandidatesFromKeetInvite(invite).length, 2);
});

test("deriveTopicCandidatesFromKeetInvite handles binary base64 keet invite", () => {
  const invite = "pear://keet/qrvM3QABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fc3ludGhldGljIGludml0ZSBmaXh0dXJl";

  const candidates = deriveTopicCandidatesFromKeetInvite(invite);

  assert.equal(candidates[0]?.label, "base64[0:32]:raw");
  assert.equal(candidates[2]?.label, "base64[4:36]:raw");
  assert.equal(candidates[2]?.topicHex, "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
  assert.ok(candidates.some((candidate) => candidate.label.endsWith(":discovery")));
});
