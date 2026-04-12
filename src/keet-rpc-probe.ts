import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_KEET_DUMP_PATH, readKeetRpcMethods, resolveKeetDumpPath } from "./keet-internal-api.js";

export type KeetProbeStatus = "green" | "yellow" | "red";

export interface KeetProbeCheck {
  name: string;
  status: KeetProbeStatus;
  detail: string;
}

export interface KeetRpcProbePlan {
  dumpPath?: string | undefined;
  coreWorkerPath?: string | undefined;
  storePath?: string | undefined;
  apiManifestPath?: string | undefined;
  hyperschemaPath?: string | undefined;
  chatSagaPath?: string | undefined;
  checks: KeetProbeCheck[];
  workerArgs: string[];
  rpcMethods: Array<{ name: string; rpcId: number; subscription: boolean }>;
  addChatMessageSchemaFields: Array<{ name: string; type: string; required: boolean }>;
  inferredStoreCall?: string | undefined;
  nextSteps: string[];
  canAttemptReadOnlyCore: boolean;
  canSafelySend: boolean;
}

const requiredRpcMethods = [
  "core.getLinkInfo",
  "core.pairRoom",
  "core.getRoomInfo",
  "core.addChatMessage",
  "core.subscribeChatMessages",
] as const;

const expectedStoreTokens = [
  "pear-run",
  "framed-stream",
  "tiny-buffer-rpc",
  "@holepunchto/keet-rpc/client",
] as const;

const expectedWorkerTokens = [
  "Pear",
  "worker",
  "pipe",
  "framed-stream",
  "tiny-buffer-rpc",
  "@holepunchto/keet-rpc/server",
  "@holepunchto/keet-core-hyperdb",
] as const;

const expectedWorkerArgs = [
  "storage",
  "experimental",
  "devMirrors",
  "devUserRegistry",
  "swarming",
  "otaConfigKey",
] as const;

export async function buildKeetRpcProbePlan(options: {
  dumpPath?: string | undefined;
} = {}): Promise<KeetRpcProbePlan> {
  const dumpPath = await resolveKeetDumpPath(options.dumpPath);
  if (!dumpPath) {
    return {
      checks: [
        {
          name: "bundle",
          status: "red",
          detail: `No Pear Keet dump found. Run: pear dump pear://keet ${DEFAULT_KEET_DUMP_PATH} --no-ask`,
        },
      ],
      workerArgs: [],
      rpcMethods: [],
      addChatMessageSchemaFields: [],
      nextSteps: ["Create or pass a Keet dump with --keet-dump, then rerun this read-only probe."],
      canAttemptReadOnlyCore: false,
      canSafelySend: false,
    };
  }

  const storePath = path.join(dumpPath, "build/src/store.js");
  const coreWorkerPath = path.join(dumpPath, "workers/core/index.js");
  const apiManifestPath = path.join(dumpPath, "node_modules/@holepunchto/keet-core-hyperdb/api/v1/api.json");
  const hyperschemaPath = path.join(
    dumpPath,
    "node_modules/@holepunchto/keet-core-hyperdb/packages/schema/spec/api/hyperschema/schema.json",
  );
  const chatSagaPath = path.join(dumpPath, "node_modules/@holepunchto/keet-store/store/chat/chat.saga.js");

  const checks: KeetProbeCheck[] = [
    { name: "bundle", status: "green", detail: `Keet dump found at ${dumpPath}` },
  ];

  const [storeText, workerText, rpcMethods, schemaFields, chatSagaText] = await Promise.all([
    readOptional(storePath),
    readOptional(coreWorkerPath),
    readKeetRpcMethods(apiManifestPath).catch(() => []),
    readAddChatMessageSchemaFields(hyperschemaPath).catch(() => []),
    readOptional(chatSagaPath),
  ]);

  const storeTokens = storeText ? missingTokens(storeText, expectedStoreTokens) : [...expectedStoreTokens];
  const workerTokens = workerText ? missingTokens(workerText, expectedWorkerTokens) : [...expectedWorkerTokens];
  const workerArgs = workerText ? expectedWorkerArgs.filter((name) => workerText.includes(name)) : [];
  const foundMethodNames = new Map(rpcMethods.map((method) => [`${method.api}.${method.name}`, method]));
  const requiredMethods = requiredRpcMethods.map((name) => {
    const method = foundMethodNames.get(name);
    return {
      name,
      rpcId: method?.rpcId ?? -1,
      subscription: method?.subscription ?? false,
    };
  });
  const missingMethods = requiredMethods.filter((method) => method.rpcId < 0);
  const inferredStoreCall = inferStoreAddChatMessageCall(chatSagaText);

  checks.push({
    name: "core worker entrypoint",
    status: workerText ? "green" : "red",
    detail: workerText ? coreWorkerPath : "Missing workers/core/index.js",
  });
  checks.push({
    name: "renderer spawn path",
    status: storeText && storeTokens.length === 0 ? "green" : "red",
    detail: storeText
      ? storeTokens.length === 0
        ? "store.js imports pear-run + framed-stream + tiny-buffer-rpc + keet-rpc client"
        : `store.js missing expected tokens: ${storeTokens.join(", ")}`
      : "Missing build/src/store.js",
  });
  checks.push({
    name: "core worker transport",
    status: workerText && workerTokens.length === 0 ? "green" : "red",
    detail: workerText
      ? workerTokens.length === 0
        ? "core worker uses Pear worker pipe + framed tiny-buffer-rpc server around keet-core-hyperdb"
        : `core worker missing expected tokens: ${workerTokens.join(", ")}`
      : "Missing workers/core/index.js",
  });
  checks.push({
    name: "worker args",
    status: workerArgs.length === expectedWorkerArgs.length ? "green" : "yellow",
    detail: workerArgs.length === expectedWorkerArgs.length
      ? `args: ${workerArgs.join(", ")}`
      : `found args: ${workerArgs.join(", ") || "(none)"}`,
  });
  checks.push({
    name: "required RPC methods",
    status: missingMethods.length === 0 ? "green" : "red",
    detail: missingMethods.length === 0
      ? requiredMethods.map((method) => `${method.name}=${method.rpcId}`).join(", ")
      : `missing: ${missingMethods.map((method) => method.name).join(", ")}`,
  });
  checks.push({
    name: "addChatMessage schema",
    status: schemaFields.length > 0 ? "yellow" : "red",
    detail: schemaFields.length > 0
      ? `lower-level schema fields: ${schemaFields.map((field) => `${field.name}:${field.type}`).join(", ")}`
      : "No add-chat-message-request schema found",
  });
  checks.push({
    name: "store-level send call",
    status: inferredStoreCall ? "yellow" : "red",
    detail: inferredStoreCall ?? "No chat saga addChatMessage call shape found",
  });
  checks.push({
    name: "mutating send",
    status: "red",
    detail: "Not attempted: private UNLICENSED internals, no supported bot SDK, and live profile/room mutation would be risky.",
  });

  const canAttemptReadOnlyCore =
    Boolean(storeText) &&
    Boolean(workerText) &&
    storeTokens.length === 0 &&
    workerTokens.length === 0 &&
    missingMethods.length === 0;

  return {
    dumpPath,
    coreWorkerPath,
    storePath,
    apiManifestPath,
    hyperschemaPath,
    chatSagaPath,
    checks,
    workerArgs,
    rpcMethods: requiredMethods,
    addChatMessageSchemaFields: schemaFields,
    inferredStoreCall,
    nextSteps: [
      canAttemptReadOnlyCore
        ? "Green: a follow-up read-only Pear sidecar experiment can spawn the core worker against a temp store and call swarm.ready/getLinkInfo."
        : "Blocked: fix the red static probe checks before spawning a Pear sidecar.",
      "Yellow: map the store-level addChatMessage(roomId, text, opts) convenience call to the lower-level schema before any live send.",
      "Red: do not call addChatMessage against a real Keet profile until we can target an explicit test room and confirm the local identity is paired.",
    ],
    canAttemptReadOnlyCore,
    canSafelySend: false,
  };
}

export function formatKeetRpcProbePlan(plan: KeetRpcProbePlan): string {
  const lines = [
    "Keet RPC probe",
    `read-only core attempt: ${plan.canAttemptReadOnlyCore ? "possible" : "blocked"}`,
    `safe send: ${plan.canSafelySend ? "possible" : "blocked"}`,
  ];

  if (plan.dumpPath) lines.push(`dump: ${plan.dumpPath}`);
  if (plan.coreWorkerPath) lines.push(`core worker: ${plan.coreWorkerPath}`);
  if (plan.storePath) lines.push(`store: ${plan.storePath}`);
  if (plan.apiManifestPath) lines.push(`api manifest: ${plan.apiManifestPath}`);
  if (plan.hyperschemaPath) lines.push(`hyperschema: ${plan.hyperschemaPath}`);
  if (plan.chatSagaPath) lines.push(`chat saga: ${plan.chatSagaPath}`);

  lines.push("checks:");
  for (const check of plan.checks) lines.push(`  [${check.status}] ${check.name}: ${check.detail}`);

  if (plan.rpcMethods.length > 0) {
    lines.push("required RPC surface:");
    for (const method of plan.rpcMethods) {
      const id = method.rpcId >= 0 ? method.rpcId : "missing";
      lines.push(`  ${method.name} rpcId=${id}${method.subscription ? " subscription=true" : ""}`);
    }
  }

  if (plan.addChatMessageSchemaFields.length > 0) {
    lines.push("addChatMessage lower-level schema:");
    for (const field of plan.addChatMessageSchemaFields) {
      lines.push(`  ${field.name}: ${field.type}${field.required ? " required" : ""}`);
    }
  }

  if (plan.inferredStoreCall) lines.push(`inferred store call: ${plan.inferredStoreCall}`);

  lines.push("next steps:");
  for (const step of plan.nextSteps) lines.push(`  - ${step}`);

  return lines.join("\n");
}

async function readAddChatMessageSchemaFields(schemaPath: string): Promise<KeetRpcProbePlan["addChatMessageSchemaFields"]> {
  const raw = await readFile(schemaPath, "utf8");
  const schema = JSON.parse(raw) as { messages?: unknown; schema?: unknown };
  const messages = Array.isArray(schema.messages)
    ? schema.messages
    : Array.isArray(schema.schema)
      ? schema.schema
      : [];
  if (messages.length === 0) return [];

  const message = messages.find((entry): entry is {
    name?: unknown;
    namespace?: unknown;
    fields?: unknown;
  } => {
    if (typeof entry !== "object" || !entry) return false;
    const candidate = entry as { name?: unknown; namespace?: unknown };
    return candidate.name === "add-chat-message-request" && candidate.namespace === "api/core";
  });
  if (!message || !Array.isArray(message.fields)) return [];

  return message.fields.flatMap((field) => {
    if (typeof field !== "object" || !field) return [];
    const candidate = field as { name?: unknown; type?: unknown; required?: unknown };
    if (typeof candidate.name !== "string" || typeof candidate.type !== "string") return [];
    return [{
      name: candidate.name,
      type: candidate.type,
      required: candidate.required === true,
    }];
  });
}

function inferStoreAddChatMessageCall(chatSagaText: string | undefined): string | undefined {
  if (!chatSagaText) return undefined;
  if (!chatSagaText.includes("chatAddMessageHandler")) return undefined;
  if (!chatSagaText.includes("apiCall")) return undefined;
  if (!chatSagaText.includes("addChatMes") && !chatSagaText.includes("addChatMessage")) return undefined;
  if (!chatSagaText.includes("roomId") && !chatSagaText.includes("text")) return undefined;
  return "Keet store dispatches through apiCall(getCoreBackend().addChatMessage, roomId, text, opts) for plain text.";
}

function missingTokens(text: string, tokens: readonly string[]): string[] {
  return tokens.filter((token) => !text.includes(token));
}

async function readOptional(filePath: string): Promise<string | undefined> {
  if (!(await exists(filePath))) return undefined;
  return readFile(filePath, "utf8");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
