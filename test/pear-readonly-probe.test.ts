import assert from "node:assert/strict";
import test from "node:test";
import { buildPearReadonlyProbeCommand } from "../src/pear-readonly-probe.js";

test("buildPearReadonlyProbeCommand builds Pear read-only probe args", () => {
  const command = buildPearReadonlyProbeCommand({
    pearBin: "/pear",
    appDir: "/repo/pear-keet-readonly-probe",
    dumpPath: "/tmp/keet-pear-dump",
    roomLink: "pear://keet/example-room",
    timeoutMs: 5000,
  });

  assert.equal(command.command, "/pear");
  assert.deepEqual(command.args, [
    "run",
    "--dev",
    "--tmp-store",
    "--no-ask",
    "/repo/pear-keet-readonly-probe",
    "--keet-dump",
    "/tmp/keet-pear-dump",
    "--timeout-ms",
    "5000",
    "--room",
    "pear://keet/example-room",
  ]);
});
