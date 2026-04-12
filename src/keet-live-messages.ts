export interface KeetLiveChatMessage {
  seq: number;
  timestamp?: number | undefined;
  author?: string | undefined;
  text: string;
}

export function summarizeKeetChatMessage(value: unknown): KeetLiveChatMessage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  const seq = item.seq;
  if (typeof seq !== "number") return undefined;

  const member = item.member && typeof item.member === "object" ? item.member as Record<string, unknown> : {};
  const chat = item.chat && typeof item.chat === "object" ? item.chat as Record<string, unknown> : {};
  const message = item.message && typeof item.message === "object" ? item.message as Record<string, unknown> : {};
  const nestedChat = message.chat && typeof message.chat === "object" ? message.chat as Record<string, unknown> : {};
  const text = chat.text ?? nestedChat.text ?? message.text;
  if (typeof text !== "string" || text.length === 0) return undefined;

  return {
    seq,
    timestamp: typeof item.timestamp === "number" ? item.timestamp : undefined,
    author: typeof member.displayName === "string"
      ? member.displayName
      : typeof member.name === "string"
        ? member.name
        : undefined,
    text,
  };
}

export function summarizeKeetChatMessages(value: unknown): KeetLiveChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const message = summarizeKeetChatMessage(item);
    return message ? [message] : [];
  });
}

export function newestSeq(messages: KeetLiveChatMessage[]): number {
  return messages.reduce((max, message) => Math.max(max, message.seq), -1);
}
