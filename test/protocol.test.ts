import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeFrames,
  encodeFrame,
  isBridgeMessage,
  normalizeTopicHex,
} from "../src/protocol.js";

test("encodeFrame appends newline-delimited JSON", () => {
  const encoded = encodeFrame({ type: "chat.text", text: "hello", ts: 1 });
  assert.equal(encoded, '{"type":"chat.text","text":"hello","ts":1}\n');
});

test("decodeFrames handles chunk boundaries and multiple frames", () => {
  let state = "";
  let decoded = decodeFrames('{"type":"chat.', state);
  assert.deepEqual(decoded.messages, []);
  state = decoded.remainder;

  decoded = decodeFrames('text","text":"hi","ts":2}\n{"type":"chat.done","id":"a"}\n', state);
  assert.deepEqual(decoded.messages, [
    { type: "chat.text", text: "hi", ts: 2 },
    { type: "chat.done", id: "a" },
  ]);
  assert.equal(decoded.remainder, "");
});

test("decodeFrames keeps invalid JSON as remainder until newline then drops it", () => {
  const decoded = decodeFrames('not-json\n{"type":"chat.done","id":"a"}\n', "");
  assert.deepEqual(decoded.messages, [{ type: "chat.done", id: "a" }]);
  assert.deepEqual(decoded.errors.map((error) => error.line), ["not-json"]);
});

test("isBridgeMessage validates known message shapes", () => {
  assert.equal(isBridgeMessage({ type: "hello", peerId: "abc", name: "mac", ts: 1 }), true);
  assert.equal(isBridgeMessage({ type: "chat.request", id: "r1", prompt: "hi" }), true);
  assert.equal(isBridgeMessage({ type: "chat.delta", id: "r1", content: "hello" }), true);
  assert.equal(isBridgeMessage({ type: "chat.done", id: "r1" }), true);
  assert.equal(isBridgeMessage({ type: "chat.error", id: "r1", message: "bad" }), true);
  assert.equal(isBridgeMessage({ type: "unknown" }), false);
});

test("normalizeTopicHex accepts 64-char hex or creates random topic", () => {
  const explicit = "a".repeat(64);
  assert.equal(normalizeTopicHex(explicit), explicit);

  const generated = normalizeTopicHex(undefined);
  assert.match(generated, /^[0-9a-f]{64}$/);

  assert.throws(() => normalizeTopicHex("abc"), /64-character hex/);
});
