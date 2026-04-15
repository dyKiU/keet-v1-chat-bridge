import assert from "node:assert/strict";
import test from "node:test";
import { parseCliOptions } from "../src/cli-options.js";

test("parseCliOptions configures host defaults", () => {
  const options = parseCliOptions(["host", "--echo", "--strip-think"]);

  assert.equal(options.command, "host");
  assert.equal(options.name, "client-a");
  assert.equal(options.echo, true);
  assert.equal(options.stripThink, true);
  assert.equal(options.baseUrl, "http://127.0.0.1:11435/v1");
  assert.equal(options.model, "qwen3-4b");
  assert.equal(options.sessionId, undefined);
});

test("parseCliOptions reads v1 chat defaults from env", () => {
  const previousBaseUrl = process.env.V1_CHAT_BASE_URL;
  const previousModel = process.env.V1_CHAT_MODEL;
  const previousSessionId = process.env.V1_CHAT_SESSION_ID;
  process.env.V1_CHAT_BASE_URL = "http://127.0.0.1:8642/v1";
  process.env.V1_CHAT_MODEL = "hermes-agent";
  process.env.V1_CHAT_SESSION_ID = "room-42";

  try {
    const options = parseCliOptions(["host"]);
    assert.equal(options.baseUrl, "http://127.0.0.1:8642/v1");
    assert.equal(options.model, "hermes-agent");
    assert.equal(options.sessionId, "room-42");
  } finally {
    if (previousBaseUrl === undefined) delete process.env.V1_CHAT_BASE_URL;
    else process.env.V1_CHAT_BASE_URL = previousBaseUrl;
    if (previousModel === undefined) delete process.env.V1_CHAT_MODEL;
    else process.env.V1_CHAT_MODEL = previousModel;
    if (previousSessionId === undefined) delete process.env.V1_CHAT_SESSION_ID;
    else process.env.V1_CHAT_SESSION_ID = previousSessionId;
  }
});

test("parseCliOptions requires a client topic", () => {
  assert.throws(() => parseCliOptions(["client"]), /requires --topic/);
});

test("parseCliOptions accepts client topic and text mode", () => {
  const topic = "a".repeat(64);
  const options = parseCliOptions(["client", "--topic", topic, "--text", "--name", "iphone-ish"]);

  assert.equal(options.command, "client");
  assert.equal(options.topic, topic);
  assert.equal(options.textOnly, true);
  assert.equal(options.name, "iphone-ish");
});

test("parseCliOptions accepts one-shot post ask", () => {
  const topic = "b".repeat(64);
  const options = parseCliOptions(["post", "--topic", topic, "--ask", "what time is it?", "--name", "poster"]);

  assert.equal(options.command, "post");
  assert.equal(options.topic, topic);
  assert.equal(options.ask, "what time is it?");
  assert.equal(options.name, "poster");
});

test("parseCliOptions requires one post payload", () => {
  const topic = "c".repeat(64);

  assert.throws(() => parseCliOptions(["post", "--topic", topic]), /requires --say/);
  assert.throws(() => parseCliOptions(["post", "--topic", topic, "--say", "hello", "--ask", "hello"]), /either --say/);
});

test("parseCliOptions configures Keet welcome command", () => {
  const room = "pear://keet/example-room";
  const options = parseCliOptions([
    "keet-welcome",
    "--room",
    room,
    "--message",
    "hello from qvac",
    "--keet-dump",
    "/tmp/keet-pear-dump",
  ]);

  assert.equal(options.command, "keet-welcome");
  assert.equal(options.name, "keet-welcome");
  assert.equal(options.roomLink, room);
  assert.equal(options.message, "hello from qvac");
  assert.equal(options.keetDump, "/tmp/keet-pear-dump");
});

test("parseCliOptions configures Keet RPC probe command", () => {
  const options = parseCliOptions([
    "keet-rpc-probe",
    "--keet-dump",
    "/tmp/keet-pear-dump",
  ]);

  assert.equal(options.command, "keet-rpc-probe");
  assert.equal(options.name, "keet-rpc-probe");
  assert.equal(options.keetDump, "/tmp/keet-pear-dump");
});

test("parseCliOptions configures Keet read-only probe command", () => {
  const room = "pear://keet/example-room";
  const options = parseCliOptions([
    "keet-readonly-probe",
    "--keet-dump",
    "/tmp/keet-pear-dump",
    "--room",
    room,
    "--timeout-ms",
    "5000",
    "--linger-ms",
    "10000",
    "--wait-for-response",
  ]);

  assert.equal(options.command, "keet-readonly-probe");
  assert.equal(options.name, "keet-readonly-probe");
  assert.equal(options.keetDump, "/tmp/keet-pear-dump");
  assert.equal(options.roomLink, room);
  assert.equal(options.timeoutMs, 5000);
});

test("parseCliOptions configures Keet live store guard command", () => {
  const options = parseCliOptions(["keet-live-store-guard"]);

  assert.equal(options.command, "keet-live-store-guard");
  assert.equal(options.name, "keet-live-store-guard");
});

test("parseCliOptions configures Keet live read-only probe command", () => {
  const room = "pear://keet/example-room";
  const options = parseCliOptions([
    "keet-live-readonly-probe",
    "--room",
    room,
    "--timeout-ms",
    "5000",
  ]);

  assert.equal(options.command, "keet-live-readonly-probe");
  assert.equal(options.name, "keet-live-readonly-probe");
  assert.equal(options.roomLink, room);
  assert.equal(options.timeoutMs, 5000);
});

test("parseCliOptions configures Keet live send command", () => {
  const options = parseCliOptions([
    "keet-live-send",
    "--room-id",
    "test-room-id-qvac",
    "--message",
    "hello from qvac",
    "--timeout-ms",
    "5000",
    "--linger-ms",
    "10000",
    "--wait-for-response",
  ]);

  assert.equal(options.command, "keet-live-send");
  assert.equal(options.name, "keet-live-send");
  assert.equal(options.roomId, "test-room-id-qvac");
  assert.equal(options.message, "hello from qvac");
  assert.equal(options.timeoutMs, 5000);
  assert.equal(options.lingerMs, 10000);
  assert.equal(options.waitForResponse, true);
});

test("parseCliOptions configures Keet live watch command", () => {
  const options = parseCliOptions([
    "keet-live-watch",
    "--room-id",
    "test-room-id-qvac",
    "--poll-ms",
    "1000",
    "--once",
    "--subscribe",
  ]);

  assert.equal(options.command, "keet-live-watch");
  assert.equal(options.name, "keet-live-watch");
  assert.equal(options.roomId, "test-room-id-qvac");
  assert.equal(options.pollMs, 1000);
  assert.equal(options.once, true);
  assert.equal(options.subscribe, true);
});

test("parseCliOptions configures Keet live subscribe probe command", () => {
  const options = parseCliOptions([
    "keet-live-subscribe-probe",
    "--room-id",
    "test-room-id-qvac",
    "--timeout-ms",
    "5000",
  ]);

  assert.equal(options.command, "keet-live-subscribe-probe");
  assert.equal(options.name, "keet-live-subscribe-probe");
  assert.equal(options.roomId, "test-room-id-qvac");
  assert.equal(options.timeoutMs, 5000);
});

test("parseCliOptions configures Keet live agent command", () => {
  const options = parseCliOptions([
    "keet-live-agent",
    "--room-id",
    "test-room-id-qvac",
    "--poll-ms",
    "1000",
    "--base-url",
    "http://127.0.0.1:11435/v1",
    "--model",
    "qwen3-4b",
    "--thinking-model",
    "hermes-agent/qwen3-4b",
    "--session-id",
    "room-test-123",
    "--strip-think",
    "--subscribe",
  ]);

  assert.equal(options.command, "keet-live-agent");
  assert.equal(options.name, "keet-live-agent");
  assert.equal(options.roomId, "test-room-id-qvac");
  assert.equal(options.pollMs, 1000);
  assert.equal(options.baseUrl, "http://127.0.0.1:11435/v1");
  assert.equal(options.model, "qwen3-4b");
  assert.equal(options.thinkingModel, "hermes-agent/qwen3-4b");
  assert.equal(options.sessionId, "room-test-123");
  assert.equal(options.stripThink, true);
  assert.equal(options.subscribe, true);
});

test("parseCliOptions requires a Keet room for welcome command", () => {
  assert.throws(() => parseCliOptions(["keet-welcome"]), /requires --room/);
});

test("parseCliOptions requires a Keet room id for live commands", () => {
  assert.throws(() => parseCliOptions(["keet-live-send"]), /requires --room-id/);
  assert.throws(() => parseCliOptions(["keet-live-subscribe-probe"]), /requires --room-id/);
  assert.throws(() => parseCliOptions(["keet-live-watch"]), /requires --room-id/);
  assert.throws(() => parseCliOptions(["keet-live-agent"]), /requires --room-id/);
});
