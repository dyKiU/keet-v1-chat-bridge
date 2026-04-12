import type { ChatRequestMessage } from "./protocol.js";

export interface OpenAiClientOptions {
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  systemPrompt?: string | undefined;
  stripThink?: boolean | undefined;
  onResponseAccepted?: (() => void) | undefined;
}

interface ChatMessage {
  role: string;
  content: string;
}

export function parseOpenAiSseDeltas(input: string): string[] {
  const deltas: string[] = [];

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;

    const data = line.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;

    try {
      const parsed = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      const content = parsed.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        deltas.push(content);
      }
    } catch {
      // Ignore malformed SSE payloads. Streaming parsers may receive partial
      // chunks; callers can pass complete buffered records when needed.
    }
  }

  return deltas;
}

export function extractChatCompletionText(response: unknown): string {
  const content = (response as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

export function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export interface ThinkFilter {
  push(delta: string): string;
  flush(): string;
}

export function createThinkFilter(): ThinkFilter {
  let buffer = "";
  let insideThink = false;

  return {
    push(delta: string): string {
      buffer += delta;
      let output = "";

      while (buffer.length > 0) {
        const tag = insideThink ? "</think>" : "<think>";
        const tagIndex = buffer.indexOf(tag);

        if (tagIndex >= 0) {
          if (!insideThink) output += buffer.slice(0, tagIndex);
          buffer = buffer.slice(tagIndex + tag.length);
          insideThink = !insideThink;
          continue;
        }

        const keep = longestSuffixThatStartsTag(buffer, tag);
        if (!insideThink) output += buffer.slice(0, buffer.length - keep);
        buffer = buffer.slice(buffer.length - keep);
        break;
      }

      return output;
    },
    flush(): string {
      const output = insideThink ? "" : buffer;
      buffer = "";
      return output;
    },
  };
}

function toMessages(request: ChatRequestMessage, systemPrompt?: string): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  if (request.messages?.length) {
    messages.push(...request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })));
  } else if (request.prompt) {
    messages.push({ role: "user", content: request.prompt });
  } else {
    throw new Error("chat.request requires either prompt or messages");
  }

  return messages;
}

export async function* streamChatCompletion(
  request: ChatRequestMessage,
  options: OpenAiClientOptions,
): AsyncGenerator<string> {
  const url = new URL("chat/completions", ensureTrailingSlash(options.baseUrl));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: request.model ?? options.model,
      messages: toMessages(request, options.systemPrompt),
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI-compatible server returned HTTP ${response.status}: ${await response.text()}`);
  }

  options.onResponseAccepted?.();

  if (!response.body) {
    const text = extractChatCompletionText(await response.json());
    if (text) yield options.stripThink ? stripThinkBlocks(text) : text;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const thinkFilter = options.stripThink ? createThinkFilter() : undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const records = buffer.split(/\r?\n\r?\n/);
    buffer = records.pop() ?? "";

    for (const record of records) {
      for (const delta of parseOpenAiSseDeltas(record)) {
        const output = thinkFilter ? thinkFilter.push(delta) : delta;
        if (output) yield output;
      }
    }
  }

  if (buffer) {
    for (const delta of parseOpenAiSseDeltas(buffer)) {
      const output = thinkFilter ? thinkFilter.push(delta) : delta;
      if (output) yield output;
    }
  }

  const output = thinkFilter?.flush();
  if (output) yield output.trimStart();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function longestSuffixThatStartsTag(value: string, tag: string): number {
  const max = Math.min(value.length, tag.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (tag.startsWith(value.slice(value.length - length))) return length;
  }
  return 0;
}
