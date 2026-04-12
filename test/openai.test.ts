import assert from "node:assert/strict";
import test from "node:test";
import {
  createThinkFilter,
  extractChatCompletionText,
  parseOpenAiSseDeltas,
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
    choices: [{ message: { role: "assistant", content: "v1 chat server works" } }],
  };

  assert.equal(extractChatCompletionText(response), "v1 chat server works");
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
