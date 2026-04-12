import { summarizeKeetChatMessages, summarizeKeetChatMessage } from "./keet-live-messages.js";
import { withKeetLiveCore, withTimeout } from "./keet-live-core.js";

export interface KeetLiveSubscribeProbeOptions {
  roomId: string;
  timeoutMs?: number | undefined;
}

export async function runKeetLiveSubscribeProbe(options: KeetLiveSubscribeProbeOptions): Promise<number> {
  const timeoutMs = options.timeoutMs ?? 60000;
  let timer: NodeJS.Timeout | undefined;

  try {
    const output = await withKeetLiveCore(async (core) => {
      await withTimeout(core.api.swarm.ready(), timeoutMs, "swarm.ready");
      const info = await withTimeout(core.api.core.getRoomInfo(options.roomId), timeoutMs, "core.getRoomInfo");
      const initial = summarizeKeetChatMessages(await withTimeout(
        core.api.core.getChatMessages(options.roomId, { reverse: true }),
        timeoutMs,
        "core.getChatMessages(initial)",
      ));
      const initialHighSeq = initial.reduce((max, message) => Math.max(max, message.seq), -1);

      const stream = core.api.core.subscribeChatMessages(options.roomId);
      const event = await new Promise<unknown>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`subscribeChatMessages timed out after ${timeoutMs}ms`)), timeoutMs);
        stream.on("data", (value: unknown) => {
          const fresh = summarizeKeetChatMessages(value).filter((message) => message.seq > initialHighSeq);
          console.log(JSON.stringify({
            event: "subscribe-data",
            summary: summarizeSubscribeEvent(value),
            fresh,
          }));
          if (fresh.length > 0) resolve(value);
        });
        stream.once("error", reject);
        stream.once("close", () => reject(new Error("subscribeChatMessages closed before an event")));
      });
      stream.destroy();

      return {
        status: "green",
        mode: "subscribe-probe",
        room: summarizeRoom(info),
        initialHighSeq,
        freshEvent: summarizeSubscribeEvent(event),
      };
    });

    console.log(JSON.stringify(output, null, 2));
    return 0;
  } catch (error) {
    console.log(JSON.stringify({
      status: "red",
      roomId: options.roomId,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    return 2;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function summarizeSubscribeEvent(value: unknown): unknown {
  const single = summarizeKeetChatMessage(value);
  if (single) return { shape: "chat-message", message: single };

  const messages = summarizeKeetChatMessages(value);
  if (messages.length > 0) return { shape: "chat-message-array", count: messages.length, messages: messages.slice(-10) };

  if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`;
  if (Array.isArray(value)) return {
    shape: "array",
    count: value.length,
    items: value.slice(0, 5).map(summarizeSubscribeEvent),
  };
  if (!value || typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (["avatar", "pointer", "profileDiscoveryId", "profileId", "memberId", "deviceId", "swarmId"].includes(key)) continue;
    out[key] = summarizeSubscribeEvent(item);
  }
  return { shape: "object", ...out };
}

function summarizeRoom(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return { roomId: "<unknown>" };
  const item = value as Record<string, unknown>;
  const config = item.config && typeof item.config === "object" ? item.config as Record<string, unknown> : {};
  return {
    roomId: item.roomId,
    title: config.title,
    description: config.description,
    roomType: config.roomType,
  };
}
