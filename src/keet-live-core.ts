import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { buildKeetLiveStorePlan } from "./keet-live-store.js";

export interface KeetLiveCore {
  api: any;
  storePath: string;
  profileId?: number | undefined;
  workerPath: string;
  stdout: () => string;
  stderr: () => string;
}

export async function withKeetLiveCore<T>(fn: (core: KeetLiveCore) => Promise<T>): Promise<T> {
  const guard = await buildKeetLiveStorePlan();
  if (!guard.canOpenLiveStore || !guard.detectedStorePath) {
    throw new Error(`Keet live store guard is red; refusing to open store ${guard.detectedStorePath ?? "(unknown)"}`);
  }

  const requireFromKeet = createRequire(path.join(guard.appResourcesPath, "package.json"));
  const FramedStream = requireFromKeet("framed-stream");
  const TinyBufferRPC = requireFromKeet("tiny-buffer-rpc");
  const createClientAPI = requireFromKeet("@holepunchto/keet-core/rpc/client");
  const bareBin = path.join(guard.appResourcesPath, "node_modules/bare-sidecar/prebuilds/darwin-universal/bare");
  const child = spawn(bareBin, [
    guard.coreWorkerPath,
    guard.detectedStorePath,
    "false",
    "false",
    "true",
    "undefined",
    "/dev/null",
    "info",
    "false",
    "production",
  ], {
    stdio: ["ignore", "pipe", "pipe", "pipe"],
  });

  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout?.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));

  const ipc = child.stdio[3] as (NodeJS.ReadWriteStream & { destroy: () => void }) | null;
  if (!ipc) throw new Error("Keet live core could not open fd 3 IPC pipe");

  const pipe = new FramedStream(ipc);
  const rpc = new TinyBufferRPC((buf: Buffer) => pipe.write(buf));
  pipe.on("data", (buf: Buffer) => rpc.recv(buf));
  const api = createClientAPI(rpc);

  try {
    return await fn({
      api,
      storePath: guard.detectedStorePath,
      profileId: guard.profileId,
      workerPath: guard.coreWorkerPath,
      stdout: () => stdout.join(""),
      stderr: () => stderr.join(""),
    });
  } finally {
    rpc.destroy();
    pipe.destroy();
    ipc.destroy();
    await stopChild(child);
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
