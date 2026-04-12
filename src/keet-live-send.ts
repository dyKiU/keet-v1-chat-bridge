import { DEFAULT_WELCOME_MESSAGE } from "./keet-internal-api.js";
import { newestSeq, summarizeKeetChatMessages, type KeetLiveChatMessage } from "./keet-live-messages.js";
import { withKeetLiveCore, withTimeout } from "./keet-live-core.js";
import { buildKeetLiveStorePlan } from "./keet-live-store.js";

export interface KeetLiveSendOptions {
  roomId: string;
  message?: string | undefined;
  timeoutMs?: number | undefined;
  lingerMs?: number | undefined;
  waitForResponse?: boolean | undefined;
}

export async function runKeetLiveSend(options: KeetLiveSendOptions): Promise<number> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const lingerMs = options.lingerMs ?? 15000;
  const message = options.message ?? DEFAULT_WELCOME_MESSAGE;
  const guard = await buildKeetLiveStorePlan();
  if (!guard.canOpenLiveStore || !guard.detectedStorePath) {
    console.log(JSON.stringify({
      status: "red",
      step: "guard",
      canOpenLiveStore: guard.canOpenLiveStore,
      detectedStore: guard.detectedStorePath,
      checks: guard.checks,
    }, null, 2));
    return 2;
  }

  try {
    const output = await withKeetLiveCore(async (core) => {
      await withTimeout(core.api.swarm.ready(), timeoutMs, "swarm.ready");
      const before = await withTimeout(core.api.core.getRoomInfo(options.roomId), timeoutMs, "core.getRoomInfo(before)");
      const sendResult = await withTimeout(
        core.api.core.addChatMessage(options.roomId, message, {}),
        timeoutMs,
        "core.addChatMessage",
      );
      const recentMessages = await withTimeout(
        core.api.core.getChatMessages(options.roomId, { reverse: true }),
        timeoutMs,
        "core.getChatMessages(after)",
      );
      const sentSeq = newestSeq(summarizeKeetChatMessages(recentMessages));
      const linger: { polls: number; finalRoom: unknown; response?: KeetLiveChatMessage | undefined } = options.waitForResponse
        ? await waitForResponse(core.api, options.roomId, sentSeq, message, lingerMs, timeoutMs)
        : lingerMs > 0
          ? await waitForReplicationWindow(core.api, options.roomId, lingerMs, timeoutMs)
        : { polls: 0, finalRoom: before, response: undefined };

      return {
        status: options.waitForResponse && !linger.response ? "yellow" : "green",
        store: core.storePath,
        profile: core.profileId,
        worker: core.workerPath,
        room: summarizeRoomInfo(before),
        sent: {
          text: message,
          result: summarize(sendResult),
          seq: sentSeq,
        },
        recentMessages: summarizeChatMessages(recentMessages),
        replicationWindow: {
          lingerMs,
          polls: linger.polls,
          finalRoom: summarizeRoomInfo(linger.finalRoom),
          response: linger.response,
        },
        stdout: summarizeText(core.stdout()),
        stderr: summarizeText(core.stderr()),
      };
    });

    console.log(JSON.stringify(output, null, 2));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({
      status: "red",
      store: guard.detectedStorePath,
      roomId: options.roomId,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    return 2;
  }
}

async function waitForReplicationWindow(
  api: any,
  roomId: string,
  lingerMs: number,
  timeoutMs: number,
): Promise<{ polls: number; finalRoom: unknown; response?: KeetLiveChatMessage | undefined }> {
  const started = Date.now();
  let polls = 0;
  let finalRoom: unknown;
  while (Date.now() - started < lingerMs) {
    await sleep(Math.min(2000, Math.max(250, lingerMs - (Date.now() - started))));
    finalRoom = await withTimeout(api.core.getRoomInfo(roomId), timeoutMs, "core.getRoomInfo(linger)");
    polls += 1;
  }
  return { polls, finalRoom };
}

async function waitForResponse(
  api: any,
  roomId: string,
  sentSeq: number,
  sentText: string,
  lingerMs: number,
  timeoutMs: number,
): Promise<{ polls: number; finalRoom: unknown; response?: KeetLiveChatMessage | undefined }> {
  const started = Date.now();
  let polls = 0;
  let finalRoom: unknown;
  while (Date.now() - started < lingerMs) {
    await sleep(Math.min(2000, Math.max(250, lingerMs - (Date.now() - started))));
    const recent = await withTimeout(api.core.getChatMessages(roomId, { reverse: true }), timeoutMs, "core.getChatMessages(wait-for-response)");
    const response = summarizeKeetChatMessages(recent)
      .filter((message) => message.seq > sentSeq && message.text !== sentText)
      .sort((a, b) => a.seq - b.seq)[0];
    finalRoom = await withTimeout(api.core.getRoomInfo(roomId), timeoutMs, "core.getRoomInfo(wait-for-response)");
    polls += 1;
    if (response) return { polls, finalRoom, response };
  }
  return { polls, finalRoom };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function summarize(value: unknown): unknown {
  if (value === undefined) return "<undefined>";
  if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`;
  if (Array.isArray(value)) return value.slice(0, 10).map(summarize);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (["avatar", "pointer", "profileDiscoveryId", "profileId", "memberId", "deviceId", "swarmId"].includes(key)) continue;
    out[key] = summarize(item);
  }
  return out;
}

function summarizeRoomInfo(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return { roomId: "<unknown>" };
  const item = value as Record<string, unknown>;
  const config = item.config && typeof item.config === "object" ? item.config as Record<string, unknown> : {};
  const stats = item.stats && typeof item.stats === "object" ? item.stats as Record<string, unknown> : {};
  return {
    roomId: item.roomId,
    title: config.title,
    description: config.description,
    roomType: config.roomType,
    stats: summarize(stats),
  };
}

function summarizeChatMessages(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return { count: 0, messages: [] };
  return {
    count: value.length,
    messages: value.slice(0, 5).map(summarizeChatMessage),
  };
}

function summarizeChatMessage(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const member = item.member && typeof item.member === "object" ? item.member as Record<string, unknown> : {};
  const chat = item.chat && typeof item.chat === "object" ? item.chat as Record<string, unknown> : {};
  const message = item.message && typeof item.message === "object" ? item.message as Record<string, unknown> : {};
  const nestedChat = message.chat && typeof message.chat === "object" ? message.chat as Record<string, unknown> : {};
  return {
    seq: item.seq,
    timestamp: item.timestamp,
    author: member.displayName ?? member.name,
    text: chat.text ?? nestedChat.text ?? message.text ?? null,
  };
}

function summarizeText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 1000 ? `${trimmed.slice(0, 1000)}...` : trimmed;
}
