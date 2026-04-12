import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildKeetLiveStorePlan, formatKeetLiveStorePlan } from "../src/keet-live-store.js";

test("buildKeetLiveStorePlan blocks when a live Keet core owns the detected store", async () => {
  const fixture = await makeInstalledKeetFixture();
  const command = [
    "/Applications/Keet.app/Contents/Resources/app/node_modules/bare-sidecar/prebuilds/darwin-universal/bare",
    fixture.coreWorkerPath,
    fixture.storePath,
    "false false true undefined",
    path.join(fixture.storePath, "keet.log"),
    "info false production",
  ].join(" ");

  const plan = await buildKeetLiveStorePlan({
    appResourcesPath: fixture.appResourcesPath,
    storageRoot: fixture.storageRoot,
    processList: [{ pid: 123, command }],
  });

  assert.equal(plan.detectedStorePath, fixture.storePath);
  assert.equal(plan.profileId, 0);
  assert.equal(plan.canOpenLiveStore, false);
  assert.equal(plan.checks.find((check) => check.name === "concurrent live core")?.status, "red");
  assert.equal(plan.checks.find((check) => check.name === "concurrent Keet app")?.status, "red");

  const formatted = formatKeetLiveStorePlan(plan);
  assert.match(formatted, /can open live store: no/);
  assert.match(formatted, /Keet core process 123 is using/);
});

test("buildKeetLiveStorePlan allows opening only when installed files and store exist with no Keet process", async () => {
  const fixture = await makeInstalledKeetFixture();

  const plan = await buildKeetLiveStorePlan({
    appResourcesPath: fixture.appResourcesPath,
    storageRoot: fixture.storageRoot,
    processList: [],
  });

  assert.equal(plan.detectedStorePath, fixture.storePath);
  assert.equal(plan.profileId, 0);
  assert.equal(plan.canOpenLiveStore, true);
  assert.equal(plan.checks.find((check) => check.name === "concurrent live core")?.status, "green");
  assert.equal(plan.checks.find((check) => check.name === "concurrent Keet app")?.status, "green");
});

async function makeInstalledKeetFixture(): Promise<{
  appResourcesPath: string;
  coreWorkerPath: string;
  storageRoot: string;
  storePath: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "keet-live-store-"));
  const appResourcesPath = path.join(root, "Keet.app/Contents/Resources/app");
  const coreWorkerPath = path.join(appResourcesPath, ".webpack/main/workers/core/index.mjs");
  await mkdir(path.dirname(coreWorkerPath), { recursive: true });
  await mkdir(path.join(appResourcesPath, "node_modules/@holepunchto/keet-core-api"), { recursive: true });
  await writeFile(coreWorkerPath, "console.log('worker')\n");
  await writeFile(path.join(appResourcesPath, "node_modules/@holepunchto/keet-core-api/api.json"), "[]\n");

  const storageRoot = path.join(root, "app-storage/by-dkey");
  const storePath = path.join(storageRoot, "197ea022b663edbedcf0b2a0fe44ebc99c21448cb46d375ec77d95de6e0a4c1a");
  await mkdir(storePath, { recursive: true });
  await writeFile(
    path.join(storePath, "profiles.json"),
    JSON.stringify({ profiles: [{ id: 0, active: true }] }),
  );

  return { appResourcesPath, coreWorkerPath, storageRoot, storePath };
}
