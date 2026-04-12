import { newestSeq, summarizeKeetChatMessages, type KeetLiveChatMessage } from "./keet-live-messages.js";
import { withKeetLiveCore, withTimeout } from "./keet-live-core.js";
import { type OpenAiClientOptions, streamChatCompletion } from "./openai.js";

export interface KeetLiveAgentOptions extends OpenAiClientOptions {
  roomId: string;
  timeoutMs?: number | undefined;
  pollMs?: number | undefined;
  subscribe?: boolean | undefined;
}

const ASSISTANT_PREFIX = "[qvac]";

export async function runKeetLiveAgent(options: KeetLiveAgentOptions): Promise<number> {
  const timeoutMs = options.timeoutMs ?? 30000;
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
        mode: "agent",
        room: summarizeRoom(info),
        highSeq,
        transport: options.subscribe ? "subscribe" : "poll",
        pollMs: options.subscribe ? undefined : pollMs,
        model: options.model,
      }, null, 2));

      if (options.subscribe) {
        await agentSubscription(core.api, options, () => highSeq, (next) => { highSeq = next; }, abort.signal, timeoutMs);
        return;
      }

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
          if (!shouldReply(message)) continue;

          const answer = await collectAnswer(message.text, options);
          const text = `${ASSISTANT_PREFIX} ${answer}`;
          const result = await withTimeout(
            core.api.core.addChatMessage(options.roomId, text, {}),
            timeoutMs,
            "core.addChatMessage(reply)",
          );
          console.log(JSON.stringify({
            event: "reply",
            inReplyToSeq: message.seq,
            text,
            result: summarizeResult(result),
          }));
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

async function agentSubscription(
  api: any,
  options: KeetLiveAgentOptions,
  getHighSeq: () => number,
  setHighSeq: (seq: number) => void,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  const stream = api.core.subscribeChatMessages(options.roomId);
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      stream.destroy();
      resolve();
    };
    signal.addEventListener("abort", finish, { once: true });
    stream.on("data", (value: unknown) => {
      void (async () => {
        const fresh = summarizeKeetChatMessages(value)
          .filter((message) => message.seq > getHighSeq())
          .sort((a, b) => a.seq - b.seq);
        for (const message of fresh) {
          setHighSeq(Math.max(getHighSeq(), message.seq));
          console.log(JSON.stringify({ event: "message", ...message }));
          if (!shouldReply(message)) continue;

          const answer = await collectAnswer(message.text, options);
          const text = `${ASSISTANT_PREFIX} ${answer}`;
          const result = await withTimeout(
            api.core.addChatMessage(options.roomId, text, {}),
            timeoutMs,
            "core.addChatMessage(reply)",
          );
          console.log(JSON.stringify({
            event: "reply",
            inReplyToSeq: message.seq,
            text,
            result: summarizeResult(result),
          }));
        }
      })().catch(reject);
    });
    stream.once("error", reject);
    stream.once("close", resolve);
  });
}

export function shouldReply(message: KeetLiveChatMessage): boolean {
  const text = message.text.trim();
  return text.length > 0 && !text.startsWith(ASSISTANT_PREFIX);
}

async function collectAnswer(prompt: string, options: OpenAiClientOptions): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of streamChatCompletion({ type: "chat.request", id: `keet-${Date.now()}`, prompt, ts: Date.now() }, options)) {
    chunks.push(chunk);
  }
  return chunks.join("").trim();
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

function summarizeResult(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`;
  if (Array.isArray(value)) return value.map(summarizeResult);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = summarizeResult(item);
  }
  return out;
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
