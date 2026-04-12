import assert from "node:assert/strict";
import test from "node:test";
import { deriveTopicCandidatesFromKeetInvite, deriveTopicFromKeetInvite } from "../src/keet-link.js";

test("deriveTopicFromKeetInvite decodes first z32 key from pear keet invite", () => {
  const invite = "pear://keet/yfo65n76jzi9girwkdqffaa6istu4n9zrc8pje6qds1qqco448fk6cnoa5uuynb7tnje58r7mtpzs1bodbk8routkfmk3fhd4czh6y8x5jsj7t69pq3iatqd8jj38bjxy318atyxy7mnwg1zk4djry47cchdaye";

  assert.equal(
    deriveTopicFromKeetInvite(invite),
    "0161ed8bbe4debf3549450dc52e31eada33d0bf7230ed4a3ce1da4e7321ad1ca",
  );

  assert.equal(deriveTopicCandidatesFromKeetInvite(invite).length, 6);
});

test("deriveTopicCandidatesFromKeetInvite handles binary base64 keet invite", () => {
  const invite = "pear://keet/LgADF67fBZ4+RvXe0Znk479PH42k9Y6s6YjRE2fA2qy9Lh0LcG93cG93cGV0ZXJCOUYmk53wryJHREtLaWlrV4qPIfHDG+bSQJC92U4qu8sBxH/baQAAAABCOUYmk53wryJHREtLaWlrV4qPIfHDG+bSQJC92U4quwFPZzREuqIGFZDENTQj7izNA6fpnCDHrADP/8AGVYh2Ad8rO1jK8EIDlQzA2d3gqG4nt6br3ecCFbYW7vACsidsf+1YTD4D3EYeYfu6ubqWuJzzRdqURb/syXZZCbU7QwgBUE5OYXCYq0NYO0J8ru3F9t6+CYJixgWLBtDBm0QvqQZjvW5L+tdVUXvsDd8krAo76p45+Q73ScylFeQlH5YlCw==";

  const candidates = deriveTopicCandidatesFromKeetInvite(invite);

  assert.equal(candidates[0]?.label, "base64[0:32]:raw");
  assert.equal(candidates[2]?.label, "base64[4:36]:raw");
  assert.equal(candidates[2]?.topicHex, "aedf059e3e46f5ded199e4e3bf4f1f8da4f58eace988d11367c0daacbd2e1d0b");
  assert.ok(candidates.some((candidate) => candidate.label.endsWith(":discovery")));
});
