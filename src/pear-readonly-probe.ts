import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { DEFAULT_KEET_DUMP_PATH } from "./keet-internal-api.js";

export interface PearReadonlyProbeOptions {
  pearBin?: string | undefined;
  appDir?: string | undefined;
  dumpPath?: string | undefined;
  roomLink?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface PearReadonlyProbeCommand {
  command: string;
  args: string[];
}

export function buildPearReadonlyProbeCommand(options: PearReadonlyProbeOptions = {}): PearReadonlyProbeCommand {
  const command = options.pearBin ?? process.env.PEAR_BIN ?? defaultPearBin();
  const appDir = options.appDir ?? path.resolve("pear-keet-readonly-probe");
  const args = [
    "run",
    "--dev",
    "--tmp-store",
    "--no-ask",
    appDir,
    "--keet-dump",
    options.dumpPath ?? DEFAULT_KEET_DUMP_PATH,
    "--timeout-ms",
    String(options.timeoutMs ?? 15000),
  ];

  if (options.roomLink) args.push("--room", options.roomLink);

  return { command, args };
}

export async function runPearReadonlyProbe(options: PearReadonlyProbeOptions = {}): Promise<number> {
  const { command, args } = buildPearReadonlyProbeCommand(options);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: path.resolve("."),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Pear read-only probe exited by signal ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

function defaultPearBin(): string {
  return path.join(os.homedir(), "Library/Application Support/pear/bin/pear");
}
