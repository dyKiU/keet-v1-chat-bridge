import assert from "node:assert/strict";
import test from "node:test";
import { collectAnswer, formatAssistantReply, modelThinkingText, shouldReply, thinkingText } from "../src/keet-live-agent.js";
import { newestSeq, summarizeKeetChatMessages } from "../src/keet-live-messages.js";

test("summarizeKeetChatMessages extracts text from Keet chat shapes", () => {
  const messages = summarizeKeetChatMessages([
    {
      seq: 2,
      timestamp: 1776008636099,
      member: { displayName: "test-user" },
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
    { seq: 2, timestamp: 1776008636099, author: "test-user", text: "hello" },
    { seq: 3, timestamp: undefined, author: "qvac", text: "[qvac] hi" },
  ]);
  assert.equal(newestSeq(messages), 3);
});

test("shouldReply ignores qvac-prefixed assistant replies", () => {
  assert.equal(shouldReply({ seq: 1, text: "what model are you?" }), true);
  assert.equal(shouldReply({ seq: 2, text: "[qvac] qwen3-4b" }), false);
  assert.equal(shouldReply({ seq: 4, text: thinkingText() }), false);
  assert.equal(shouldReply({ seq: 5, text: modelThinkingText("gemma4:26b") }), false);
  assert.equal(shouldReply({ seq: 3, text: "   " }), false);
});

test("modelThinkingText includes the configured model name", () => {
  assert.equal(modelThinkingText("gemma4:26b"), "[gemma4:26b] is thinking...");
  assert.equal(modelThinkingText("qwen3-4b"), "[qwen3-4b] is thinking...");
  assert.equal(modelThinkingText("hermes-agent/qwen3-4b"), "[hermes-agent/qwen3-4b] is thinking...");
});

test("formatAssistantReply prefixes non-empty replies and skips empty replies", () => {
  assert.equal(formatAssistantReply("hello"), "[qvac] hello");
  assert.equal(formatAssistantReply("  hello  "), "[qvac] hello");
  assert.equal(formatAssistantReply(""), undefined);
  assert.equal(formatAssistantReply("   "), undefined);
});

test("collectAnswer does not show thinking when QVAC fails before streaming", async () => {
  let thinkingCount = 0;

  await assert.rejects(
    collectAnswer("hello", testOpenAiOptions(), async () => {
      thinkingCount += 1;
    }, async function* (_request, _options) {
      throw new Error("connect ECONNREFUSED");
      yield "";
    }),
    /ECONNREFUSED/,
  );

  assert.equal(thinkingCount, 0);
});

test("collectAnswer shows thinking after QVAC accepts quick responses", async () => {
  let thinkingCount = 0;

  const answer = await collectAnswer("hello", testOpenAiOptions(), async () => {
    thinkingCount += 1;
  }, async function* (_request, options) {
    options.onResponseAccepted?.();
    yield "quick";
  });

  assert.equal(answer, "quick");
  assert.equal(thinkingCount, 1);
});

test("collectAnswer shows thinking while waiting on a live QVAC response", async () => {
  let thinkingCount = 0;

  const answer = await collectAnswer("hello", testOpenAiOptions(), async () => {
    thinkingCount += 1;
  }, async function* (_request, options) {
    options.onResponseAccepted?.();
    await new Promise((resolve) => setTimeout(resolve, 850));
    yield "slow answer";
  });

  assert.equal(answer, "slow answer");
  assert.equal(thinkingCount, 1);
});

function testOpenAiOptions() {
  return {
    baseUrl: "http://127.0.0.1:11435/v1",
    model: "qwen3-4b",
  };
}
