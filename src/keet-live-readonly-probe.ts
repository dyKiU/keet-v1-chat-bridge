import { buildKeetLiveStorePlan } from "./keet-live-store.js";
import { withKeetLiveCore, withTimeout } from "./keet-live-core.js";

export interface KeetLiveReadonlyProbeOptions {
  roomLink?: string | undefined;
  timeoutMs?: number | undefined;
}

interface ProbeCallResult {
  name: string;
  status: "green" | "red";
  detail: unknown;
}

export async function runKeetLiveReadonlyProbe(options: KeetLiveReadonlyProbeOptions = {}): Promise<number> {
  const timeoutMs = options.timeoutMs ?? 15000;
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

  const calls: ProbeCallResult[] = [];

  try {
    const output = await withKeetLiveCore(async (core) => {
      await withTimeout(core.api.swarm.ready(), timeoutMs, "swarm.ready");
      calls.push({ name: "swarm.ready", status: "green", detail: "ok" });

      await callOptional(calls, "core.getVersion", () => core.api.core.getVersion(), timeoutMs);
      await callOptional(calls, "core.getIdentity", () => core.api.core.getIdentity(), timeoutMs);
      await callOptional(calls, "core.getRoomKeys", () => core.api.core.getRoomKeys(), timeoutMs);
      const recentRooms = await callOptional(calls, "core.getRecentRooms", () => core.api.core.getRecentRooms(), timeoutMs);
      for (const room of getRecentRoomIds(recentRooms).slice(0, 5)) {
        await callOptional(calls, `core.getRoomInfo(${room})`, () => core.api.core.getRoomInfo(room), timeoutMs);
        await callOptional(
          calls,
          `core.getChatMessages(${room})`,
          () => core.api.core.getChatMessages(room, { reverse: true }),
          timeoutMs,
        );
      }
      if (options.roomLink) {
        await callOptional(calls, "core.getLinkInfo", () => core.api.core.getLinkInfo(options.roomLink), timeoutMs);
      }

      return {
        status: "green",
        store: core.storePath,
        profile: core.profileId,
        worker: core.workerPath,
        calls,
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
      error: error instanceof Error ? error.message : String(error),
      calls,
    }, null, 2));
    return 2;
  }
}

async function callOptional(
  calls: ProbeCallResult[],
  name: string,
  call: () => Promise<unknown>,
  timeoutMs: number,
): Promise<unknown> {
  try {
    const value = await withTimeout(call(), timeoutMs, name);
    calls.push({ name, status: "green", detail: summarize(value) });
    return value;
  } catch (error) {
    calls.push({ name, status: "red", detail: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
}

function summarize(value: unknown): unknown {
  if (value === undefined) return "<undefined>";
  if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`;
  if (Array.isArray(value)) {
    if (value.some(isChatMessageLike)) {
      return {
        count: value.length,
        messages: value.slice(0, 10).map(summarizeChatMessage),
      };
    }
    return value.map(summarize);
  }
  if (!value || typeof value !== "object") return value;
  if (isIdentityLike(value)) return summarizeIdentity(value);
  if (isRecentRoomsLike(value)) return summarizeRecentRooms(value);
  if (isRoomInfoLike(value)) return summarizeRoomInfo(value);
  if (isChatMessageLike(value)) return summarizeChatMessage(value);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (["avatar", "pointer", "profileDiscoveryId", "profileId", "memberId", "deviceId", "swarmId"].includes(key)) continue;
    out[key] = summarize(item);
  }
  return out;
}

function getRecentRoomIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const rooms = (value as { rooms?: unknown }).rooms;
  if (!Array.isArray(rooms)) return [];
  return rooms.flatMap((room) => {
    if (!room || typeof room !== "object") return [];
    const roomId = (room as { roomId?: unknown }).roomId;
    return typeof roomId === "string" ? [roomId] : [];
  });
}

function isIdentityLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && "displayName" in value && "devices" in value && "confirmed" in value);
}

function summarizeIdentity(value: Record<string, unknown>): Record<string, unknown> {
  const devices = Array.isArray(value.devices) ? value.devices : [];
  return {
    displayName: value.displayName,
    anonymous: value.anonymous,
    confirmed: value.confirmed,
    deviceCount: devices.length,
    mobileDeviceCount: devices.filter((device) => Boolean(device && typeof device === "object" && (device as { isMobile?: unknown }).isMobile)).length,
    canDM: value.canDM,
  };
}

function isRecentRoomsLike(value: unknown): value is { type?: unknown; total?: unknown; rooms?: unknown } {
  return Boolean(value && typeof value === "object" && Array.isArray((value as { rooms?: unknown }).rooms));
}

function summarizeRecentRooms(value: { type?: unknown; total?: unknown; rooms?: unknown }): Record<string, unknown> {
  const rooms = Array.isArray(value.rooms) ? value.rooms : [];
  return {
    type: value.type,
    total: value.total,
    rooms: rooms.map((room) => {
      if (!room || typeof room !== "object") return summarize(room);
      return {
        roomId: (room as { roomId?: unknown }).roomId,
        timestamp: (room as { timestamp?: unknown }).timestamp,
      };
    }),
  };
}

function isRoomInfoLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && "roomId" in value && "config" in value && "stats" in value);
}

function summarizeRoomInfo(value: Record<string, unknown>): Record<string, unknown> {
  const config = value.config && typeof value.config === "object" ? value.config as Record<string, unknown> : {};
  const stats = value.stats && typeof value.stats === "object" ? value.stats as Record<string, unknown> : {};
  return {
    roomId: value.roomId,
    title: config.title,
    description: config.description,
    roomType: config.roomType,
    status: summarize(value.status),
    stats: summarize(stats),
    lastMessage: summarizeChatMessage((value.lastMessage as { chat?: unknown } | undefined)?.chat),
  };
}

function isChatMessageLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && ("chat" in value || "message" in value) && ("timestamp" in value || "seq" in value));
}

function summarizeChatMessage(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const member = item.member && typeof item.member === "object" ? item.member as Record<string, unknown> : {};
  const chat = item.chat && typeof item.chat === "object" ? item.chat as Record<string, unknown> : {};
  const message = item.message && typeof item.message === "object" ? item.message as Record<string, unknown> : {};
  const nestedChat = message.chat && typeof message.chat === "object" ? message.chat as Record<string, unknown> : {};
  const text = chat.text ?? nestedChat.text ?? (message.text as unknown);
  const event = item.event && typeof item.event === "object" ? item.event as Record<string, unknown> : {};

  return {
    seq: item.seq,
    timestamp: item.timestamp,
    author: member.displayName ?? member.name,
    text: text ?? null,
    event: event.type ? summarize(event) : null,
  };
}

function summarizeText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 1000 ? `${trimmed.slice(0, 1000)}...` : trimmed;
}
