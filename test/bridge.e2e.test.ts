import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { BridgePeer } from "../src/bridge.js";
import { normalizeTopicHex } from "../src/protocol.js";

const require = createRequire(import.meta.url);
const createTestnet = require("hyperdht/testnet");

test("local client A and B pair, exchange text, and complete echo request", { timeout: 20_000 }, async () => {
  const testnet = await createTestnet(3);
  const topicHex = normalizeTopicHex(undefined);

  const clientA = new BridgePeer({
    name: "client-a",
    topicHex,
    role: "server",
    swarmOptions: { dht: testnet.createNode() },
    responder: async function* (message) {
      yield "echo: ";
      yield message.prompt ?? "";
    },
  });

  const clientB = new BridgePeer({
    name: "client-b",
    topicHex,
    role: "client",
    swarmOptions: { dht: testnet.createNode() },
  });

  const textSeenByA = new Promise<string>((resolve) => {
    clientA.on("text", (message) => resolve(message.text));
  });

  try {
    await clientA.start();
    await clientB.start();
    await Promise.all([clientA.waitForConnection(), clientB.waitForConnection()]);

    clientB.sendText("hello from B");
    assert.equal(await textSeenByA, "hello from B");

    const response = await clientB.request("ping");
    assert.equal(response, "echo: ping");
  } finally {
    await Promise.allSettled([clientB.close(), clientA.close()]);
    await testnet.destroy();
  }
});
