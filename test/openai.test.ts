import assert from "node:assert/strict";
import test from "node:test";
import {
  createThinkFilter,
  extractChatCompletionText,
  parseOpenAiSseDeltas,
  streamChatCompletion,
  stripThinkBlocks,
} from "../src/openai.js";

test("parseOpenAiSseDeltas extracts streaming chat content", () => {
  const input = [
    'data: {"choices":[{"delta":{"content":"hel"}}]}',
    "",
    'data: {"choices":[{"delta":{"content":"lo"}}]}',
    "",
    "data: [DONE]",
    "",
  ].join("\n");

  assert.deepEqual(parseOpenAiSseDeltas(input), ["hel", "lo"]);
});

test("parseOpenAiSseDeltas ignores non-content chunks", () => {
  const input = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}',
    "",
    'data: {"choices":[{"finish_reason":"stop"}]}',
    "",
  ].join("\n");

  assert.deepEqual(parseOpenAiSseDeltas(input), []);
});

test("extractChatCompletionText handles non-streaming response", () => {
  const response = {
    choices: [{ message: { role: "assistant", content: "qvac server works" } }],
  };

  assert.equal(extractChatCompletionText(response), "qvac server works");
});

test("stripThinkBlocks removes empty or populated think sections", () => {
  assert.equal(stripThinkBlocks("<think>\n\n</think>\n\nhello"), "hello");
  assert.equal(stripThinkBlocks("a <think>internal</think> b"), "a  b");
});

test("createThinkFilter removes think blocks across streaming boundaries", () => {
  const filter = createThinkFilter();

  const output = [
    filter.push("<thi"),
    filter.push("nk>hidden"),
    filter.push("</th"),
    filter.push("ink>\n\nbridge"),
    filter.push(" works"),
    filter.flush(),
  ].join("");

  assert.equal(output.trim(), "bridge works");
});

test("streamChatCompletion sends Hermes session header when configured", async () => {
  const originalFetch = globalThis.fetch;
  let seenHeaders: Headers | undefined;

  globalThis.fetch = async (_input, init) => {
    seenHeaders = new Headers(init?.headers as HeadersInit | undefined);
    return {
      ok: true,
      status: 200,
      body: null,
      json: async () => ({
        choices: [{ message: { role: "assistant", content: "ok" } }],
      }),
      text: async () => "",
    } as Response;
  };

  try {
    const chunks: string[] = [];
    for await (const chunk of streamChatCompletion({
      type: "chat.request",
      id: "req-1",
      prompt: "hello",
      ts: Date.now(),
    }, {
      baseUrl: "http://127.0.0.1:8642/v1",
      model: "hermes-agent",
      sessionId: "keet-room-123",
    })) {
      chunks.push(chunk);
    }

    assert.equal(chunks.join(""), "ok");
    assert.equal(seenHeaders?.get("X-Hermes-Session-Id"), "keet-room-123");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
