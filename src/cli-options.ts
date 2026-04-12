import { DEFAULT_WELCOME_MESSAGE } from "./keet-internal-api.js";

export type CliCommand =
  | "host"
  | "client"
  | "probe"
  | "post"
  | "keet-welcome"
  | "keet-rpc-probe"
  | "keet-live-store-guard"
  | "keet-live-readonly-probe"
  | "keet-live-send"
  | "keet-live-subscribe-probe"
  | "keet-live-watch"
  | "keet-live-agent"
  | "keet-readonly-probe";

export interface CliOptions {
  command: CliCommand;
  name: string;
  topic?: string | undefined;
  keetInvite?: string | undefined;
  roomLink?: string | undefined;
  roomId?: string | undefined;
  message: string;
  say?: string | undefined;
  ask?: string | undefined;
  keetDump?: string | undefined;
  baseUrl: string;
  model: string;
  apiKey?: string | undefined;
  systemPrompt?: string | undefined;
  echo: boolean;
  textOnly: boolean;
  stripThink: boolean;
  once: boolean;
  subscribe: boolean;
  waitForResponse: boolean;
  timeoutMs?: number | undefined;
  pollMs?: number | undefined;
  lingerMs?: number | undefined;
}

const defaults = {
  baseUrl: "http://127.0.0.1:11435/v1",
  model: "qwen3-4b",
};

export function parseCliOptions(argv: string[]): CliOptions {
  const [rawCommand, ...rest] = argv;
  if (
    rawCommand !== "host" &&
    rawCommand !== "client" &&
    rawCommand !== "probe" &&
    rawCommand !== "post" &&
    rawCommand !== "keet-welcome" &&
    rawCommand !== "keet-rpc-probe" &&
    rawCommand !== "keet-live-store-guard" &&
    rawCommand !== "keet-live-readonly-probe" &&
    rawCommand !== "keet-live-send" &&
    rawCommand !== "keet-live-subscribe-probe" &&
    rawCommand !== "keet-live-watch" &&
    rawCommand !== "keet-live-agent" &&
    rawCommand !== "keet-readonly-probe"
  ) {
    throw new Error(`Usage: qvac-hyperswarm-bridge <host|client|probe|post|keet-welcome|keet-rpc-probe|keet-live-store-guard|keet-live-readonly-probe|keet-live-send|keet-live-subscribe-probe|keet-live-watch|keet-live-agent|keet-readonly-probe> [options]\n${usage()}`);
  }

  const options: CliOptions = {
    command: rawCommand,
    name: defaultName(rawCommand),
    message: DEFAULT_WELCOME_MESSAGE,
    baseUrl: defaults.baseUrl,
    model: defaults.model,
    echo: false,
    textOnly: false,
    stripThink: false,
    once: false,
    subscribe: false,
    waitForResponse: false,
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    switch (arg) {
      case "--topic":
        options.topic = readValue(rest, ++index, arg);
        break;
      case "--keet-invite":
        options.keetInvite = readValue(rest, ++index, arg);
        break;
      case "--room":
        options.roomLink = readValue(rest, ++index, arg);
        break;
      case "--room-id":
        options.roomId = readValue(rest, ++index, arg);
        break;
      case "--message":
        options.message = readValue(rest, ++index, arg);
        break;
      case "--say":
        options.say = readValue(rest, ++index, arg);
        break;
      case "--ask":
        options.ask = readValue(rest, ++index, arg);
        break;
      case "--keet-dump":
        options.keetDump = readValue(rest, ++index, arg);
        break;
      case "--timeout-ms":
        options.timeoutMs = Number(readValue(rest, ++index, arg));
        if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
          throw new Error("--timeout-ms requires a positive number");
        }
        break;
      case "--poll-ms":
        options.pollMs = Number(readValue(rest, ++index, arg));
        if (!Number.isFinite(options.pollMs) || options.pollMs <= 0) {
          throw new Error("--poll-ms requires a positive number");
        }
        break;
      case "--linger-ms":
        options.lingerMs = Number(readValue(rest, ++index, arg));
        if (!Number.isFinite(options.lingerMs) || options.lingerMs < 0) {
          throw new Error("--linger-ms requires a non-negative number");
        }
        break;
      case "--name":
        options.name = readValue(rest, ++index, arg);
        break;
      case "--base-url":
        options.baseUrl = readValue(rest, ++index, arg);
        break;
      case "--model":
        options.model = readValue(rest, ++index, arg);
        break;
      case "--api-key":
        options.apiKey = readValue(rest, ++index, arg);
        break;
      case "--system":
        options.systemPrompt = readValue(rest, ++index, arg);
        break;
      case "--echo":
        options.echo = true;
        break;
      case "--text":
        options.textOnly = true;
        break;
      case "--strip-think":
        options.stripThink = true;
        break;
      case "--once":
        options.once = true;
        break;
      case "--subscribe":
        options.subscribe = true;
        break;
      case "--wait-for-response":
        options.waitForResponse = true;
        break;
      case "--help":
      case "-h":
        throw new Error(usage());
      default:
        throw new Error(`Unknown option: ${arg}\n${usage()}`);
    }
  }

  if ((options.command === "client" || options.command === "probe" || options.command === "post") && !options.topic && !options.keetInvite) {
    throw new Error(`${options.command} mode requires --topic <64-char-hex-topic> or --keet-invite <pear://keet/...>`);
  }

  if (options.command === "post" && !options.say && !options.ask) {
    throw new Error("post mode requires --say <text> or --ask <prompt>");
  }

  if (options.command === "post" && options.say && options.ask) {
    throw new Error("post mode accepts either --say <text> or --ask <prompt>, not both");
  }

  if (options.command === "keet-welcome" && !options.roomLink) {
    throw new Error("keet-welcome mode requires --room <pear://keet/...>");
  }

  if (
    (options.command === "keet-live-send" || options.command === "keet-live-subscribe-probe" || options.command === "keet-live-watch" || options.command === "keet-live-agent") &&
    !options.roomId
  ) {
    throw new Error(`${options.command} mode requires --room-id <local-keet-room-id>`);
  }

  return options;
}

export function usage(): string {
  return [
    "Commands:",
    "  host [--topic <hex>] [--echo] [--strip-think] [--base-url <url>] [--model <name>]",
    "  client --topic <hex> [--text] [--model <name>]",
    "  probe (--topic <hex> | --keet-invite <pear://keet/...>)",
    "  post --topic <hex> (--say <text> | --ask <prompt>) [--model <name>]",
    "  keet-welcome --room <pear://keet/...> [--message <text>] [--keet-dump <path>]",
    "  keet-rpc-probe [--keet-dump <path>]",
    "  keet-live-store-guard",
    "  keet-live-readonly-probe [--room <pear://keet/...>] [--timeout-ms <ms>]",
    "  keet-live-send --room-id <local-keet-room-id> [--message <text>] [--linger-ms <ms>] [--wait-for-response] [--timeout-ms <ms>]",
    "  keet-live-subscribe-probe --room-id <local-keet-room-id> [--timeout-ms <ms>]",
    "  keet-live-watch --room-id <local-keet-room-id> [--subscribe | --poll-ms <ms>] [--once] [--timeout-ms <ms>]",
    "  keet-live-agent --room-id <local-keet-room-id> [--subscribe | --poll-ms <ms>] [--base-url <url>] [--model <name>] [--strip-think]",
    "  keet-readonly-probe [--keet-dump <path>] [--room <pear://keet/...>] [--timeout-ms <ms>]",
    "",
    "Defaults:",
    `  --base-url ${defaults.baseUrl}`,
    `  --model ${defaults.model}`,
  ].join("\n");
}

function defaultName(command: CliCommand): string {
  switch (command) {
    case "host":
      return "client-a";
    case "client":
      return "client-b";
    case "probe":
      return "keet-probe";
    case "post":
      return "bridge-post";
    case "keet-welcome":
      return "keet-welcome";
    case "keet-rpc-probe":
      return "keet-rpc-probe";
    case "keet-live-store-guard":
      return "keet-live-store-guard";
    case "keet-live-readonly-probe":
      return "keet-live-readonly-probe";
    case "keet-live-send":
      return "keet-live-send";
    case "keet-live-subscribe-probe":
      return "keet-live-subscribe-probe";
    case "keet-live-watch":
      return "keet-live-watch";
    case "keet-live-agent":
      return "keet-live-agent";
    case "keet-readonly-probe":
      return "keet-readonly-probe";
  }
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}
