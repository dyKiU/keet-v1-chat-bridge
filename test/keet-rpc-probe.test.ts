import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildKeetRpcProbePlan, formatKeetRpcProbePlan } from "../src/keet-rpc-probe.js";

test("buildKeetRpcProbePlan marks the known static Keet RPC path green and send red", async () => {
  const dumpPath = await mkdtemp(path.join(os.tmpdir(), "keet-rpc-probe-"));
  await writeMinimalKeetDump(dumpPath);

  const plan = await buildKeetRpcProbePlan({ dumpPath });

  assert.equal(plan.canAttemptReadOnlyCore, true);
  assert.equal(plan.canSafelySend, false);
  assert.deepEqual(
    plan.checks.map((check) => [check.name, check.status]),
    [
      ["bundle", "green"],
      ["core worker entrypoint", "green"],
      ["renderer spawn path", "green"],
      ["core worker transport", "green"],
      ["worker args", "green"],
      ["required RPC methods", "green"],
      ["addChatMessage schema", "yellow"],
      ["store-level send call", "yellow"],
      ["mutating send", "red"],
    ],
  );
  assert.deepEqual(plan.workerArgs, [
    "storage",
    "experimental",
    "devMirrors",
    "devUserRegistry",
    "swarming",
    "otaConfigKey",
  ]);
  assert.deepEqual(
    plan.rpcMethods.map((method) => [method.name, method.rpcId, method.subscription]),
    [
      ["core.getLinkInfo", 0, false],
      ["core.pairRoom", 1, false],
      ["core.getRoomInfo", 2, false],
      ["core.addChatMessage", 3, false],
      ["core.subscribeChatMessages", 4, true],
    ],
  );
  assert.deepEqual(
    plan.addChatMessageSchemaFields.map((field) => [field.name, field.type, field.required]),
    [
      ["header", "@api/request-header", true],
      ["roomKey", "@keet/room-key", true],
      ["message", "@keet/oplog-message", true],
    ],
  );

  const formatted = formatKeetRpcProbePlan(plan);
  assert.match(formatted, /read-only core attempt: possible/);
  assert.match(formatted, /safe send: blocked/);
  assert.match(formatted, /addChatMessage lower-level schema/);
});

test("buildKeetRpcProbePlan reports red when the bundle dump is incomplete", async () => {
  const dumpPath = await mkdtemp(path.join(os.tmpdir(), "keet-rpc-probe-missing-"));
  const apiDir = path.join(dumpPath, "node_modules/@holepunchto/keet-core-hyperdb/api/v1");
  await mkdir(apiDir, { recursive: true });
  await writeFile(path.join(apiDir, "api.json"), JSON.stringify([{ api: "core", methods: [] }]));

  const plan = await buildKeetRpcProbePlan({ dumpPath });

  assert.equal(plan.canAttemptReadOnlyCore, false);
  assert.equal(plan.canSafelySend, false);
  assert.equal(plan.checks.find((check) => check.name === "core worker entrypoint")?.status, "red");
  assert.equal(plan.checks.find((check) => check.name === "required RPC methods")?.status, "red");
});

async function writeMinimalKeetDump(dumpPath: string): Promise<void> {
  await mkdir(path.join(dumpPath, "build/src"), { recursive: true });
  await writeFile(
    path.join(dumpPath, "build/src/store.js"),
    `
      import TinyBufferRPC from 'tiny-buffer-rpc';
      import framedStream from 'framed-stream';
      import keetRpcClient from '@holepunchto/keet-rpc/client';
      import pearRun from 'pear-run';
      const coreEntrypoint = Pear.config.core
        ? Pear.config.applink + '/workers/core/index.js'
        : path.join(Pear.config.dir, 'workers', 'core', 'index.js');
      const pipe = new framedStream(pearRun(coreEntrypoint, [
        storage,
        isExperimental,
        args.devMirrors,
        args.devUserRegistry || !IS_PRODUCTION,
        args.swarming,
        args.otaConfigKey
      ]));
      const rpc = new TinyBufferRPC((buf) => pipe.write(buf));
      pipe.on('data', (buf) => rpc.recv(buf));
      const client = keetRpcClient(rpc);
      await client.swarm.ready();
    `,
  );

  await mkdir(path.join(dumpPath, "workers/core"), { recursive: true });
  await writeFile(
    path.join(dumpPath, "workers/core/index.js"),
    `
      import keetCoreHyperdb from '@holepunchto/keet-core-hyperdb';
      import TinyBufferRPC from 'tiny-buffer-rpc';
      import registerServerAPI from '@holepunchto/keet-rpc/server';
      import framedStream from 'framed-stream';
      const pipe = new framedStream(Pear.worker.pipe());
      const storage = Pear.config.args[0] || Pear.config.storage;
      const experimental = Pear.config.args[1] === 'true';
      const devMirrors = Pear.config.args[2] === 'true';
      const devUserRegistry = Pear.config.args[3] === 'true';
      const swarming = Pear.config.args[4] === 'true';
      const otaConfigKey = Pear.config.args[5] === 'undefined' ? undefined : Pear.config.args[5];
      const { keet: core } = keetCoreHyperdb.init(storage, { experimental, devMirrors, devUserRegistry, swarming, hyperconfKey: otaConfigKey });
      const backend = core.backendAPI;
      await backend.ready();
      const rpc = new TinyBufferRPC((buf) => pipe.write(buf));
      pipe.on('data', (buf) => rpc.recv(buf));
      registerServerAPI(backend, rpc);
    `,
  );

  const apiDir = path.join(dumpPath, "node_modules/@holepunchto/keet-core-hyperdb/api/v1");
  await mkdir(apiDir, { recursive: true });
  await writeFile(
    path.join(apiDir, "api.json"),
    JSON.stringify([
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

  const schemaDir = path.join(dumpPath, "node_modules/@holepunchto/keet-core-hyperdb/packages/schema/spec/api/hyperschema");
  await mkdir(schemaDir, { recursive: true });
  await writeFile(
    path.join(schemaDir, "schema.json"),
    JSON.stringify({
      messages: [
        {
          name: "add-chat-message-request",
          namespace: "api/core",
          fields: [
            { name: "header", required: true, type: "@api/request-header" },
            { name: "roomKey", required: true, type: "@keet/room-key" },
            { name: "message", required: true, type: "@keet/oplog-message" },
          ],
        },
      ],
    }),
  );

  const chatDir = path.join(dumpPath, "node_modules/@holepunchto/keet-store/store/chat");
  await mkdir(chatDir, { recursive: true });
  await writeFile(
    path.join(chatDir, "chat.saga.js"),
    `
      export function* chatAddMessageHandler({ roomId, text }) {
        const backend = getCoreBackend();
        yield apiCall(backend.addChatMessage, roomId, text, opts);
      }
    `,
  );
}
