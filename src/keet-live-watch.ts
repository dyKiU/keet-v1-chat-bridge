import { newestSeq, summarizeKeetChatMessages } from "./keet-live-messages.js";
import { withKeetLiveCore, withTimeout } from "./keet-live-core.js";

export interface KeetLiveWatchOptions {
  roomId: string;
  timeoutMs?: number | undefined;
  pollMs?: number | undefined;
  once?: boolean | undefined;
}

export async function runKeetLiveWatch(options: KeetLiveWatchOptions): Promise<number> {
  const timeoutMs = options.timeoutMs ?? 20000;
  const pollMs = options.pollMs ?? 2000;
  const abort = signalFromProcess();

  try {
    await withKeetLiveCore(async (core) => {
      await withTimeout(core.api.swarm.ready(), timeoutMs, "swarm.ready");
      const info = await withTimeout(core.api.core.getRoomInfo(options.roomId), timeoutMs, "core.getRoomInfo");
      const initial = summarizeKeetChatMessages(await withTimeout(
        core.api.core.getChatMessages(options.roomId, { reverse: true }),
        timeoutMs,
        "core.getChatMessages(initial)",
      ));
      let highSeq = newestSeq(initial);

      console.log(JSON.stringify({
        status: "green",
        mode: "watch",
        room: summarizeRoom(info),
        highSeq,
        pollMs,
      }, null, 2));

      if (options.once) return;

      while (!abort.signal.aborted) {
        await sleep(pollMs, abort.signal);
        const recent = summarizeKeetChatMessages(await withTimeout(
          core.api.core.getChatMessages(options.roomId, { reverse: true }),
          timeoutMs,
          "core.getChatMessages(poll)",
        ));
        const fresh = recent.filter((message) => message.seq > highSeq).sort((a, b) => a.seq - b.seq);
        for (const message of fresh) {
          highSeq = Math.max(highSeq, message.seq);
          console.log(JSON.stringify({ event: "message", ...message }));
        }
      }
    });

    return 0;
  } catch (error) {
    if (abort.signal.aborted) return 0;
    console.log(JSON.stringify({
      status: "red",
      roomId: options.roomId,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    return 2;
  } finally {
    abort.cleanup();
  }
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

function signalFromProcess(): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);
  return {
    signal: controller.signal,
    cleanup: () => {
      process.off("SIGINT", abort);
      process.off("SIGTERM", abort);
    },
  };
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
