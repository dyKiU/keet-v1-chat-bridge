import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import b4a from "b4a";
import {
  type BridgeMessage,
  type ChatRequestMessage,
  decodeFrames,
  encodeFrame,
  makeRequestId,
  normalizeTopicHex,
} from "./protocol.js";

const require = createRequire(import.meta.url);
const Hyperswarm = require("hyperswarm");

type Connection = NodeJS.ReadWriteStream & {
  remotePublicKey?: Buffer;
  destroy: () => void;
};

export type PeerRole = "server" | "client" | "both";

export interface BridgePeerOptions {
  name: string;
  topicHex?: string;
  role?: PeerRole;
  swarmOptions?: Record<string, unknown>;
  responder?: (message: ChatRequestMessage) => AsyncIterable<string> | Iterable<string> | Promise<string> | string;
}

export interface BridgePeerEvents {
  message: [BridgeMessage, Connection];
  text: [BridgeMessage & { type: "chat.text" }, Connection];
  request: [ChatRequestMessage, Connection];
  delta: [BridgeMessage & { type: "chat.delta" }, Connection];
  done: [BridgeMessage & { type: "chat.done" }, Connection];
  error: [BridgeMessage & { type: "chat.error" }, Connection];
  connection: [Connection];
}

export class BridgePeer extends EventEmitter<BridgePeerEvents> {
  readonly name: string;
  readonly topicHex: string;
  readonly role: PeerRole;

  private readonly responder?: BridgePeerOptions["responder"];
  private readonly swarm: any;
  private readonly connections = new Set<Connection>();
  private readonly frameState = new WeakMap<Connection, string>();
  private readonly pendingRequests = new Map<string, {
    chunks: string[];
    resolve: (value: string) => void;
    reject: (reason: Error) => void;
  }>();

  constructor(options: BridgePeerOptions) {
    super();
    this.name = options.name;
    this.topicHex = normalizeTopicHex(options.topicHex);
    this.role = options.role ?? "both";
    this.responder = options.responder;
    this.swarm = new Hyperswarm(options.swarmOptions ?? {});
  }

  get publicKey(): string {
    return b4a.toString(this.swarm.keyPair.publicKey, "hex");
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  async start(): Promise<void> {
    this.swarm.on("connection", (connection: Connection) => this.addConnection(connection));

    const topic = Buffer.from(this.topicHex, "hex");
    const discovery = this.swarm.join(topic, {
      server: this.role === "server" || this.role === "both",
      client: this.role === "client" || this.role === "both",
    });

    await discovery.flushed();
    await this.swarm.flush();
  }

  async waitForConnection(timeoutMs = 10_000): Promise<Connection> {
    const first = this.connections.values().next().value as Connection | undefined;
    if (first) return first;

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${this.name} to connect`));
      }, timeoutMs);

      const onConnection = (connection: Connection) => {
        cleanup();
        resolve(connection);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off("connection", onConnection);
      };

      this.on("connection", onConnection);
    });
  }

  sendText(text: string): void {
    this.writeAll({ type: "chat.text", text, from: this.name, ts: Date.now() });
  }

  async request(prompt: string, model?: string): Promise<string> {
    const connection = await this.waitForConnection();
    const id = makeRequestId();
    const result = new Promise<string>((resolve, reject) => {
      this.pendingRequests.set(id, { chunks: [], resolve, reject });
    });

    const message: ChatRequestMessage = { type: "chat.request", id, prompt, ts: Date.now() };
    if (model) message.model = model;
    connection.write(encodeFrame(message));
    return await result;
  }

  async close(): Promise<void> {
    for (const connection of this.connections) connection.destroy();
    this.connections.clear();
    await this.swarm.destroy();
  }

  private addConnection(connection: Connection): void {
    this.connections.add(connection);
    this.frameState.set(connection, "");
    this.emit("connection", connection);

    connection.write(encodeFrame({
      type: "hello",
      peerId: this.publicKey,
      name: this.name,
      ts: Date.now(),
    }));

    connection.on("data", (chunk: Buffer) => {
      const previous = this.frameState.get(connection) ?? "";
      const decoded = decodeFrames(chunk.toString("utf8"), previous);
      this.frameState.set(connection, decoded.remainder);

      for (const message of decoded.messages) {
        void this.handleMessage(message, connection);
      }
    });

    connection.on("close", () => {
      this.connections.delete(connection);
      this.frameState.delete(connection);
    });

    connection.on("error", () => {
      this.connections.delete(connection);
      this.frameState.delete(connection);
    });
  }

  private async handleMessage(message: BridgeMessage, connection: Connection): Promise<void> {
    this.emit("message", message, connection);

    switch (message.type) {
      case "chat.text":
        this.emit("text", message, connection);
        break;
      case "chat.request":
        this.emit("request", message, connection);
        await this.handleRequest(message, connection);
        break;
      case "chat.delta":
        this.emit("delta", message, connection);
        this.pendingRequests.get(message.id)?.chunks.push(message.content);
        break;
      case "chat.done": {
        this.emit("done", message, connection);
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);
          pending.resolve(pending.chunks.join(""));
        }
        break;
      }
      case "chat.error": {
        this.emit("error", message, connection);
        const pending = this.pendingRequests.get(message.id);
        if (pending) {
          this.pendingRequests.delete(message.id);
          pending.reject(new Error(message.message));
        }
        break;
      }
      case "hello":
        break;
    }
  }

  private async handleRequest(message: ChatRequestMessage, connection: Connection): Promise<void> {
    if (!this.responder) return;

    try {
      const response = await this.responder(message);

      if (typeof response === "string") {
        connection.write(encodeFrame({ type: "chat.delta", id: message.id, content: response }));
      } else {
        for await (const chunk of response) {
          connection.write(encodeFrame({ type: "chat.delta", id: message.id, content: chunk }));
        }
      }

      connection.write(encodeFrame({ type: "chat.done", id: message.id }));
    } catch (error) {
      connection.write(encodeFrame({
        type: "chat.error",
        id: message.id,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  private writeAll(message: BridgeMessage): void {
    const frame = encodeFrame(message);
    for (const connection of this.connections) connection.write(frame);
  }
}
