import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildKeetWelcomePlan,
  formatKeetWelcomePlan,
  readKeetRpcMethods,
  resolveKeetDumpPath,
} from "../src/keet-internal-api.js";

test("readKeetRpcMethods flattens manifest into RPC ids", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "keet-api-"));
  const manifestPath = path.join(tempDir, "api.json");
  await writeFile(
    manifestPath,
    JSON.stringify([
      { api: "swarm", methods: [{ name: "ready" }] },
      {
        api: "core",
        methods: [
          { name: "getLinkInfo" },
          { name: "pairRoom" },
          { name: "addChatMessage" },
          { name: "subscribeChatMessages", subscription: true },
        ],
      },
    ]),
  );

  const methods = await readKeetRpcMethods(manifestPath);

  assert.deepEqual(
    methods.map((method) => [method.api, method.name, method.rpcId, method.subscription]),
    [
      ["swarm", "ready", 0, false],
      ["core", "getLinkInfo", 1, false],
      ["core", "pairRoom", 2, false],
      ["core", "addChatMessage", 3, false],
      ["core", "subscribeChatMessages", 4, true],
    ],
  );
});

test("buildKeetWelcomePlan reports internal methods and private-api blockers", async () => {
  const dumpPath = await mkdtemp(path.join(os.tmpdir(), "keet-dump-"));
  const apiDir = path.join(dumpPath, "node_modules/@holepunchto/keet-core-hyperdb/api/v1");
  await mkdir(apiDir, { recursive: true });
  await writeFile(
    path.join(apiDir, "api.json"),
    JSON.stringify([
      { api: "swarm", methods: [{ name: "ready" }] },
      {
        api: "core",
        methods: [
          { name: "getLinkInfo" },
          { name: "pairRoom" },
          { name: "getRoomInfo" },
          { name: "addChatMessage" },
          { name: "subscribeChatMessages", subscription: true },
        ],
      },
    ]),
  );

  const packageDir = path.join(dumpPath, "node_modules/@holepunchto/keet-core-hyperdb");
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({
      name: "@holepunchto/keet-core-hyperdb",
      version: "1.24.14",
      license: "UNLICENSED",
    }),
  );

  const plan = await buildKeetWelcomePlan({
    roomLink: "pear://keet/example-room",
    message: "hello from llm",
    dumpPath,
  });

  assert.equal(await resolveKeetDumpPath(dumpPath), dumpPath);
  assert.equal(plan.canSend, false);
  assert.equal(plan.missingMethods.length, 0);
  assert.equal(plan.methods.find((method) => method.name === "addChatMessage")?.rpcId, 4);
  assert.match(formatKeetWelcomePlan(plan), /status: blocked/);
  assert.match(formatKeetWelcomePlan(plan), /addChatMessage/);
  assert.match(formatKeetWelcomePlan(plan), /UNLICENSED/);
});
