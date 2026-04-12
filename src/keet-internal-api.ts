import { access, readFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_KEET_DUMP_PATH = "/tmp/keet-pear-dump";
export const DEFAULT_WELCOME_MESSAGE =
  "Warm welcome from the local QVAC/Keet integration. The Mac-side bridge is online and ready to route private local LLM responses.";

export interface KeetInternalMethod {
  api: string;
  name: string;
  rpcId: number;
  subscription: boolean;
}

export interface KeetInternalPackage {
  name: string;
  version: string;
  license: string;
}

export interface KeetWelcomePlan {
  roomLink: string;
  message: string;
  dumpPath?: string | undefined;
  apiManifestPath?: string | undefined;
  packages: KeetInternalPackage[];
  methods: KeetInternalMethod[];
  missingMethods: string[];
  sendSteps: string[];
  blockers: string[];
  canSend: boolean;
}

interface ApiGroup {
  api?: unknown;
  methods?: unknown;
}

interface ApiMethod {
  name?: unknown;
  subscription?: unknown;
}

const requiredMethods = [
  "core.getLinkInfo",
  "core.pairRoom",
  "core.getRoomInfo",
  "core.addChatMessage",
  "core.subscribeChatMessages",
] as const;

const internalPackageNames = [
  "@holepunchto/keet-core-hyperdb",
  "@holepunchto/keet-rpc",
  "@holepunchto/keet-store",
  "@holepunchto/keet-core-api",
] as const;

export async function buildKeetWelcomePlan(options: {
  roomLink: string;
  message?: string | undefined;
  dumpPath?: string | undefined;
}): Promise<KeetWelcomePlan> {
  const message = options.message ?? DEFAULT_WELCOME_MESSAGE;
  const dumpPath = await resolveKeetDumpPath(options.dumpPath);

  if (!dumpPath) {
    return {
      roomLink: options.roomLink,
      message,
      packages: [],
      methods: [],
      missingMethods: [...requiredMethods],
      sendSteps: [],
      blockers: [
        `No Pear Keet dump found. Run: pear dump pear://keet ${DEFAULT_KEET_DUMP_PATH} --no-ask`,
      ],
      canSend: false,
    };
  }

  const apiManifestPath = path.join(
    dumpPath,
    "node_modules/@holepunchto/keet-core-hyperdb/api/v1/api.json",
  );
  const [methods, packages] = await Promise.all([
    readKeetRpcMethods(apiManifestPath),
    readInternalPackageMetadata(dumpPath),
  ]);
  const methodsByKey = new Map(methods.map((method) => [`${method.api}.${method.name}`, method]));
  const foundMethods = requiredMethods
    .map((key) => methodsByKey.get(key))
    .filter((method): method is KeetInternalMethod => Boolean(method));
  const missingMethods = requiredMethods.filter((key) => !methodsByKey.has(key));

  const blockers = [
    "Keet's room/message API was found only in UNLICENSED private bundle packages, not in a public bot SDK or spec.",
    "The desktop bundle connects to Keet core through an in-process Pear subprocess pipe; the bridge has no supported external transport into that worker yet.",
    "The manifest gives RPC method names and IDs, but not the stable addChatMessage payload schema.",
  ];
  if (missingMethods.length > 0) {
    blockers.push(`Missing required internal methods: ${missingMethods.join(", ")}`);
  }

  return {
    roomLink: options.roomLink,
    message,
    dumpPath,
    apiManifestPath,
    packages,
    methods: foundMethods,
    missingMethods,
    sendSteps: [
      "Decode the pear://keet room link with core.getLinkInfo.",
      "Join or pair the room with core.pairRoom if the local identity is not already a member.",
      "Resolve the local room identifier with core.getRoomInfo.",
      "Post the welcome text with core.addChatMessage.",
      "Subscribe with core.subscribeChatMessages to verify the echoed room event.",
    ],
    blockers,
    canSend: false,
  };
}

export function formatKeetWelcomePlan(plan: KeetWelcomePlan): string {
  const lines = [
    "Keet welcome send plan",
    `status: ${plan.canSend ? "sendable" : "blocked"}`,
    `room: ${plan.roomLink}`,
    `message: ${plan.message}`,
  ];

  if (plan.dumpPath) lines.push(`dump: ${plan.dumpPath}`);
  if (plan.apiManifestPath) lines.push(`api manifest: ${plan.apiManifestPath}`);

  if (plan.packages.length > 0) {
    lines.push("internal packages:");
    for (const pkg of plan.packages) {
      lines.push(`  ${pkg.name}@${pkg.version} license=${pkg.license}`);
    }
  }

  if (plan.methods.length > 0) {
    lines.push("required internal RPC methods:");
    for (const method of plan.methods) {
      lines.push(
        `  ${method.api}.${method.name} rpcId=${method.rpcId}${method.subscription ? " subscription=true" : ""}`,
      );
    }
  }

  if (plan.missingMethods.length > 0) {
    lines.push(`missing methods: ${plan.missingMethods.join(", ")}`);
  }

  if (plan.sendSteps.length > 0) {
    lines.push("send path:");
    for (const step of plan.sendSteps) lines.push(`  - ${step}`);
  }

  if (plan.blockers.length > 0) {
    lines.push("blockers:");
    for (const blocker of plan.blockers) lines.push(`  - ${blocker}`);
  }

  return lines.join("\n");
}

export async function resolveKeetDumpPath(explicitPath?: string | undefined): Promise<string | undefined> {
  const candidates = [explicitPath, process.env.KEET_DUMP, DEFAULT_KEET_DUMP_PATH].filter(
    (candidate): candidate is string => Boolean(candidate),
  );

  for (const candidate of candidates) {
    const apiManifestPath = path.join(
      candidate,
      "node_modules/@holepunchto/keet-core-hyperdb/api/v1/api.json",
    );
    if (await exists(apiManifestPath)) return candidate;
  }

  return undefined;
}

export async function readKeetRpcMethods(apiManifestPath: string): Promise<KeetInternalMethod[]> {
  const raw = await readFile(apiManifestPath, "utf8");
  const manifest = JSON.parse(raw) as ApiGroup[];
  if (!Array.isArray(manifest)) throw new Error(`Keet API manifest is not an array: ${apiManifestPath}`);

  const methods: KeetInternalMethod[] = [];
  let rpcId = 0;
  for (const group of manifest) {
    const api = typeof group.api === "string" ? group.api : undefined;
    if (!api || !Array.isArray(group.methods)) continue;

    for (const method of group.methods as ApiMethod[]) {
      if (typeof method.name === "string") {
        methods.push({
          api,
          name: method.name,
          rpcId,
          subscription: method.subscription === true,
        });
      }
      rpcId += 1;
    }
  }

  return methods;
}

async function readInternalPackageMetadata(dumpPath: string): Promise<KeetInternalPackage[]> {
  const packages: KeetInternalPackage[] = [];

  for (const packageName of internalPackageNames) {
    const packageJsonPath = path.join(dumpPath, "node_modules", packageName, "package.json");
    if (!(await exists(packageJsonPath))) continue;

    const json = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      name?: unknown;
      version?: unknown;
      license?: unknown;
    };
    packages.push({
      name: typeof json.name === "string" ? json.name : packageName,
      version: typeof json.version === "string" ? json.version : "unknown",
      license: typeof json.license === "string" ? json.license : "unknown",
    });
  }

  return packages;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
