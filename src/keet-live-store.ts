import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_KEET_APP_RESOURCES = "/Applications/Keet.app/Contents/Resources/app";

export interface ProcessInfo {
  pid: number;
  command: string;
}

export interface KeetLiveStoreOptions {
  appResourcesPath?: string | undefined;
  storageRoot?: string | undefined;
  processList?: ProcessInfo[] | undefined;
}

export interface KeetLiveStorePlan {
  appResourcesPath: string;
  coreWorkerPath: string;
  apiManifestPath: string;
  storageRoot: string;
  detectedStorePath?: string | undefined;
  profileId?: number | undefined;
  keetProcesses: ProcessInfo[];
  liveCoreProcesses: ProcessInfo[];
  checks: Array<{ name: string; status: "green" | "yellow" | "red"; detail: string }>;
  canOpenLiveStore: boolean;
  nextSteps: string[];
}

export async function buildKeetLiveStorePlan(options: KeetLiveStoreOptions = {}): Promise<KeetLiveStorePlan> {
  const appResourcesPath = options.appResourcesPath ?? DEFAULT_KEET_APP_RESOURCES;
  const coreWorkerPath = path.join(appResourcesPath, ".webpack/main/workers/core/index.mjs");
  const apiManifestPath = path.join(appResourcesPath, "node_modules/@holepunchto/keet-core-api/api.json");
  const storageRoot = options.storageRoot ?? path.join(os.homedir(), "Library/Application Support/pear/app-storage/by-dkey");
  const processList = options.processList ?? await listProcesses();

  const keetProcesses = processList.filter(isKeetProcess);
  const liveCoreProcesses = processList.filter((process) => isLiveKeetCoreProcess(process, coreWorkerPath));
  const detectedStorePath =
    liveCoreProcesses.map((process) => extractLiveCoreStorePath(process.command, coreWorkerPath)).find(Boolean) ??
    await findSingleStorageDirectory(storageRoot);
  const profileId = detectedStorePath ? await readActiveProfileId(detectedStorePath) : undefined;
  const matchingCoreProcess = liveCoreProcesses.find((process) => {
    const storePath = extractLiveCoreStorePath(process.command, coreWorkerPath);
    return Boolean(storePath && detectedStorePath && samePath(storePath, detectedStorePath));
  });

  const checks: KeetLiveStorePlan["checks"] = [];
  checks.push({
    name: "installed app resources",
    status: await exists(appResourcesPath) ? "green" : "red",
    detail: appResourcesPath,
  });
  checks.push({
    name: "installed core worker",
    status: await exists(coreWorkerPath) ? "green" : "red",
    detail: coreWorkerPath,
  });
  checks.push({
    name: "installed api manifest",
    status: await exists(apiManifestPath) ? "green" : "red",
    detail: apiManifestPath,
  });
  checks.push({
    name: "live storage path",
    status: detectedStorePath ? "green" : "red",
    detail: detectedStorePath ?? `No storage directory found under ${storageRoot}`,
  });
  checks.push({
    name: "profile",
    status: typeof profileId === "number" ? "green" : "yellow",
    detail: typeof profileId === "number" ? `active profile ${profileId}` : "No profiles.json active profile found",
  });
  checks.push({
    name: "concurrent live core",
    status: matchingCoreProcess ? "red" : "green",
    detail: matchingCoreProcess
      ? `Keet core process ${matchingCoreProcess.pid} is using ${detectedStorePath}`
      : "No live Keet core process is using the detected store",
  });
  checks.push({
    name: "concurrent Keet app",
    status: keetProcesses.length > 0 ? "red" : "green",
    detail: keetProcesses.length > 0
      ? `Keet appears to be running (${keetProcesses.map((process) => process.pid).join(", ")})`
      : "Keet app is not running",
  });

  const requiredFilesPresent = checks
    .filter((check) => ["installed app resources", "installed core worker", "installed api manifest", "live storage path"].includes(check.name))
    .every((check) => check.status === "green");
  const canOpenLiveStore = requiredFilesPresent && !matchingCoreProcess && keetProcesses.length === 0;

  return {
    appResourcesPath,
    coreWorkerPath,
    apiManifestPath,
    storageRoot,
    detectedStorePath,
    profileId,
    keetProcesses,
    liveCoreProcesses,
    checks,
    canOpenLiveStore,
    nextSteps: canOpenLiveStore
      ? [
        "Green: a future read-only worker may open the detected live store now that no Keet process is using it.",
        "Keep this guard in front of any command that opens the live Keet Corestore/RocksDB path.",
      ]
      : [
        "Blocked: do not open the detected live Keet store while Keet is running.",
        "Quit Keet and rerun this guard before any read-only room/message probe uses the live storage path.",
      ],
  };
}

export function formatKeetLiveStorePlan(plan: KeetLiveStorePlan): string {
  const lines = [
    "Keet live store guard",
    `can open live store: ${plan.canOpenLiveStore ? "yes" : "no"}`,
    `app resources: ${plan.appResourcesPath}`,
    `core worker: ${plan.coreWorkerPath}`,
    `api manifest: ${plan.apiManifestPath}`,
    `storage root: ${plan.storageRoot}`,
  ];

  if (plan.detectedStorePath) lines.push(`detected store: ${plan.detectedStorePath}`);
  if (typeof plan.profileId === "number") lines.push(`active profile: ${plan.profileId}`);

  lines.push("checks:");
  for (const check of plan.checks) lines.push(`  [${check.status}] ${check.name}: ${check.detail}`);

  if (plan.liveCoreProcesses.length > 0) {
    lines.push("live core processes:");
    for (const process of plan.liveCoreProcesses) lines.push(`  ${process.pid}: ${process.command}`);
  }

  lines.push("next steps:");
  for (const step of plan.nextSteps) lines.push(`  - ${step}`);

  return lines.join("\n");
}

async function listProcesses(): Promise<ProcessInfo[]> {
  const { stdout } = await execFileAsync("ps", ["axo", "pid=,command="], {
    maxBuffer: 1024 * 1024 * 10,
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .flatMap((line) => {
      if (!line) return [];
      const match = /^(\d+)\s+(.+)$/.exec(line);
      if (!match) return [];
      return [{ pid: Number(match[1]), command: match[2] }];
    });
}

function isKeetProcess(process: ProcessInfo): boolean {
  return process.command.includes("/Applications/Keet.app/");
}

function isLiveKeetCoreProcess(process: ProcessInfo, coreWorkerPath: string): boolean {
  return process.command.includes(coreWorkerPath) && process.command.includes("bare-sidecar");
}

function extractLiveCoreStorePath(command: string, coreWorkerPath: string): string | undefined {
  const index = command.indexOf(coreWorkerPath);
  if (index < 0) return undefined;

  const afterWorker = command.slice(index + coreWorkerPath.length).trim();
  const argBoundary = " false false true ";
  const boundaryIndex = afterWorker.indexOf(argBoundary);
  if (boundaryIndex < 0) return undefined;

  const storePath = afterWorker.slice(0, boundaryIndex).trim();
  return storePath || undefined;
}

async function findSingleStorageDirectory(storageRoot: string): Promise<string | undefined> {
  try {
    const entries = await readdir(storageRoot, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(storageRoot, entry.name));
    return directories.length === 1 ? directories[0] : undefined;
  } catch {
    return undefined;
  }
}

async function readActiveProfileId(storePath: string): Promise<number | undefined> {
  try {
    const raw = await readFile(path.join(storePath, "profiles.json"), "utf8");
    const parsed = JSON.parse(raw) as { profiles?: Array<{ id?: unknown; active?: unknown }> };
    const active = parsed.profiles?.find((profile) => profile.active === true);
    return typeof active?.id === "number" ? active.id : undefined;
  } catch {
    return undefined;
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}
