import crypto from "node:crypto";
import { z } from "zod";

const helloSchema = z.object({
  type: z.literal("hello"),
  peerId: z.string(),
  name: z.string().optional(),
  ts: z.number().optional(),
});

const chatTextSchema = z.object({
  type: z.literal("chat.text"),
  text: z.string(),
  from: z.string().optional(),
  ts: z.number().optional(),
});

const chatRequestSchema = z.object({
  type: z.literal("chat.request"),
  id: z.string(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]).or(z.string()),
        content: z.string(),
      }),
    )
    .optional(),
  ts: z.number().optional(),
});

const chatDeltaSchema = z.object({
  type: z.literal("chat.delta"),
  id: z.string(),
  content: z.string(),
});

const chatDoneSchema = z.object({
  type: z.literal("chat.done"),
  id: z.string(),
});

const chatErrorSchema = z.object({
  type: z.literal("chat.error"),
  id: z.string(),
  message: z.string(),
});

export const bridgeMessageSchema = z.discriminatedUnion("type", [
  helloSchema,
  chatTextSchema,
  chatRequestSchema,
  chatDeltaSchema,
  chatDoneSchema,
  chatErrorSchema,
]);

export type BridgeMessage = z.infer<typeof bridgeMessageSchema>;
export type ChatRequestMessage = z.infer<typeof chatRequestSchema>;

export interface DecodeResult {
  messages: BridgeMessage[];
  errors: Array<{ line: string; error: Error }>;
  remainder: string;
}

export function encodeFrame(message: BridgeMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function isBridgeMessage(value: unknown): value is BridgeMessage {
  return bridgeMessageSchema.safeParse(value).success;
}

export function decodeFrames(chunk: string, previousRemainder = ""): DecodeResult {
  const text = previousRemainder + chunk;
  const lines = text.split("\n");
  const remainder = lines.pop() ?? "";
  const messages: BridgeMessage[] = [];
  const errors: Array<{ line: string; error: Error }> = [];

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line) as unknown;
      const message = bridgeMessageSchema.parse(parsed);
      messages.push(message);
    } catch (error) {
      errors.push({
        line,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  return { messages, errors, remainder };
}

export function normalizeTopicHex(topicHex: string | undefined): string {
  if (!topicHex) return crypto.randomBytes(32).toString("hex");
  if (!/^[0-9a-f]{64}$/i.test(topicHex)) {
    throw new Error("Topic must be a 64-character hex string");
  }
  return topicHex.toLowerCase();
}

export function makeRequestId(): string {
  return `req_${crypto.randomBytes(8).toString("hex")}`;
}
