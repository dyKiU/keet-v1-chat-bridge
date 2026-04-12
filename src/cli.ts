#!/usr/bin/env node
import process from "node:process";
import readline from "node:readline/promises";
import { BridgePeer } from "./bridge.js";
import { parseCliOptions, usage } from "./cli-options.js";
import { buildKeetWelcomePlan, formatKeetWelcomePlan } from "./keet-internal-api.js";
import { runKeetLiveAgent } from "./keet-live-agent.js";
import { runKeetLiveReadonlyProbe } from "./keet-live-readonly-probe.js";
import { runKeetLiveSend } from "./keet-live-send.js";
import { buildKeetLiveStorePlan, formatKeetLiveStorePlan } from "./keet-live-store.js";
import { runKeetLiveWatch } from "./keet-live-watch.js";
import { buildKeetRpcProbePlan, formatKeetRpcProbePlan } from "./keet-rpc-probe.js";
import { deriveTopicCandidatesFromKeetInvite } from "./keet-link.js";
import { streamChatCompletion } from "./openai.js";
import { runPearReadonlyProbe } from "./pear-readonly-probe.js";

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  if (options.command === "keet-welcome") {
    const plan = await buildKeetWelcomePlan({
      roomLink: options.roomLink ?? "",
      message: options.message,
      dumpPath: options.keetDump,
    });

    console.log(formatKeetWelcomePlan(plan));
    if (!plan.canSend) process.exitCode = 2;
    return;
  }

  if (options.command === "keet-rpc-probe") {
    const plan = await buildKeetRpcProbePlan({
      dumpPath: options.keetDump,
    });

    console.log(formatKeetRpcProbePlan(plan));
    if (!plan.canAttemptReadOnlyCore) process.exitCode = 2;
    return;
  }

  if (options.command === "keet-live-store-guard") {
    const plan = await buildKeetLiveStorePlan();

    console.log(formatKeetLiveStorePlan(plan));
    if (!plan.canOpenLiveStore) process.exitCode = 2;
    return;
  }

  if (options.command === "keet-live-readonly-probe") {
    process.exitCode = await runKeetLiveReadonlyProbe({
      roomLink: options.roomLink,
      timeoutMs: options.timeoutMs,
    });
    return;
  }

  if (options.command === "keet-live-send") {
    process.exitCode = await runKeetLiveSend({
      roomId: options.roomId ?? "",
      message: options.message,
      timeoutMs: options.timeoutMs,
      lingerMs: options.lingerMs,
      waitForResponse: options.waitForResponse,
    });
    return;
  }

  if (options.command === "keet-live-watch") {
    process.exitCode = await runKeetLiveWatch({
      roomId: options.roomId ?? "",
      timeoutMs: options.timeoutMs,
      pollMs: options.pollMs,
      once: options.once,
    });
    return;
  }

  if (options.command === "keet-live-agent") {
    process.exitCode = await runKeetLiveAgent({
      roomId: options.roomId ?? "",
      timeoutMs: options.timeoutMs,
      pollMs: options.pollMs,
      baseUrl: options.baseUrl,
      model: options.model,
      apiKey: options.apiKey,
      systemPrompt: options.systemPrompt,
      stripThink: options.stripThink,
    });
    return;
  }

  if (options.command === "keet-readonly-probe") {
    process.exitCode = await runPearReadonlyProbe({
      dumpPath: options.keetDump,
      roomLink: options.roomLink,
      timeoutMs: options.timeoutMs,
    });
    return;
  }

  const topicCandidates = options.keetInvite
    ? deriveTopicCandidatesFromKeetInvite(options.keetInvite)
    : [{ label: "topic", topicHex: options.topic }];
  const topicHex = topicCandidates[0]?.topicHex;

  if (options.command === "host") {
    const peer = new BridgePeer({
      name: options.name,
      topicHex,
      role: "server",
      responder: options.echo
        ? async function* (message) {
          yield `echo: ${message.prompt ?? ""}`;
        }
        : (message) => streamChatCompletion(message, {
          baseUrl: options.baseUrl,
          model: options.model,
          apiKey: options.apiKey,
          systemPrompt: options.systemPrompt,
          stripThink: options.stripThink,
        }),
    });

    await peer.start();
    console.log(`host ready`);
    console.log(`topic: ${peer.topicHex}`);
    console.log(`peer: ${peer.publicKey}`);
    console.log(options.echo
      ? "mode: echo"
      : `mode: qvac ${options.baseUrl} model=${options.model}${options.stripThink ? " strip-think=true" : ""}`);

    peer.on("connection", () => {
      console.log(`connected peers: ${peer.connectionCount}`);
    });
    peer.on("text", (message) => {
      console.log(`[text] ${message.from ?? "peer"}: ${message.text}`);
    });
    peer.on("request", (message) => {
      console.log(`[request] ${message.id}: ${message.prompt ?? "(messages)"}`);
    });

    await waitForShutdown(peer);
    return;
  }

  if (options.command === "probe") {
    const peers = topicCandidates.map((candidate, index) => {
      const peer = new BridgePeer({
        name: `${options.name}-${index}`,
        topicHex: candidate.topicHex,
        role: "both",
      });

      peer.on("connection", (connection) => {
        const remoteKey = connection.remotePublicKey?.toString("hex") ?? "unknown";
        console.log(`[${candidate.label}] connected peers: ${peer.connectionCount}`);
        console.log(`[${candidate.label}] topic: ${peer.topicHex}`);
        console.log(`[${candidate.label}] remote public key: ${remoteKey}`);
      });
      peer.on("message", (message) => {
        console.log(`[${candidate.label}] frame: ${JSON.stringify(message)}`);
      });

      return { candidate, peer };
    });

    await Promise.all(peers.map(({ peer }) => peer.start()));
    console.log("probe ready");
    for (const { candidate } of peers) {
      console.log(`${candidate.label}: ${candidate.topicHex}`);
    }
    console.log("Open/join the Keet invite on the phone now. If Keet uses one of these discovery topics, this process should log a peer connection.");
    await waitForShutdown(peers.map(({ peer }) => peer));
    return;
  }

  if (options.command === "post") {
    const peer = new BridgePeer({
      name: options.name,
      topicHex,
      role: "client",
    });

    try {
      await peer.start();
      console.log(`post ready`);
      console.log(`topic: ${peer.topicHex}`);
      console.log("waiting for host...");
      await peer.waitForConnection();

      if (options.say) {
        peer.sendText(options.say);
        console.log(`sent text: ${options.say}`);
        await sleep(250);
        return;
      }

      const prompt = options.ask ?? "";
      const response = await peer.request(prompt, options.model);
      console.log(response);
    } finally {
      await peer.close();
    }
    return;
  }

  const peer = new BridgePeer({
    name: options.name,
    topicHex,
    role: "client",
  });

  await peer.start();
  console.log(`client ready`);
  console.log(`topic: ${peer.topicHex}`);
  console.log("waiting for host...");
  await peer.waitForConnection();
  console.log("connected. Type a prompt and press return. Ctrl-C exits.");

  peer.on("text", (message) => {
    console.log(`[text] ${message.from ?? "peer"}: ${message.text}`);
  });

  const input = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    for await (const line of input) {
      const text = line.trim();
      if (!text) continue;

      if (options.textOnly) {
        peer.sendText(text);
        continue;
      }

      process.stdout.write("assistant> ");
      try {
        const response = await peer.request(text, options.model);
        process.stdout.write(`${response}\n`);
      } catch (error) {
        process.stdout.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  } finally {
    input.close();
    await peer.close();
  }
}

async function waitForShutdown(peerOrPeers: BridgePeer | BridgePeer[]): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
  const peers = Array.isArray(peerOrPeers) ? peerOrPeers : [peerOrPeers];
  await Promise.allSettled(peers.map((peer) => peer.close()));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message || usage());
  process.exitCode = 1;
});
