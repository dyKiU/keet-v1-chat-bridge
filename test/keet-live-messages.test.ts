import assert from "node:assert/strict";
import test from "node:test";
import { shouldReply } from "../src/keet-live-agent.js";
import { newestSeq, summarizeKeetChatMessages } from "../src/keet-live-messages.js";

test("summarizeKeetChatMessages extracts text from Keet chat shapes", () => {
  const messages = summarizeKeetChatMessages([
    {
      seq: 2,
      timestamp: 1776008636099,
      member: { displayName: "powpowpeter" },
      chat: { text: "hello" },
    },
    {
      seq: 3,
      member: { name: "qvac" },
      message: { chat: { text: "[qvac] hi" } },
    },
    {
      seq: 4,
      chat: { text: "" },
    },
  ]);

  assert.deepEqual(messages, [
    { seq: 2, timestamp: 1776008636099, author: "powpowpeter", text: "hello" },
    { seq: 3, timestamp: undefined, author: "qvac", text: "[qvac] hi" },
  ]);
  assert.equal(newestSeq(messages), 3);
});

test("shouldReply ignores qvac-prefixed assistant replies", () => {
  assert.equal(shouldReply({ seq: 1, text: "what model are you?" }), true);
  assert.equal(shouldReply({ seq: 2, text: "[qvac] qwen3-4b" }), false);
  assert.equal(shouldReply({ seq: 3, text: "   " }), false);
});
