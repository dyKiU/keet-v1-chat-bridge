# Keet Bridge Operations

Operational notes for the Keet/QVAC/Hermes bridge. The repository root README is intentionally short; keep detailed runbooks, probes, background demos, and historical experiments here.

See [Keet Example](example.md) for the source-code map, failed experiments, working live-store path, auth model, and daemon runbook.

## Local Echo Demo

Terminal A:

```sh
npm run dev -- host --echo
```

Copy the printed `topic`.

Terminal B:

```sh
npm run dev -- client --topic <topic>
```

Type a prompt and press return. In echo mode the response should be `echo: <prompt>`.

## QVAC Demo

With the QVAC server already running:

```sh
npm run dev -- host --base-url http://127.0.0.1:11435/v1 --model qwen3-4b --strip-think
```

Then connect from another terminal:

```sh
npm run dev -- client --topic <topic>
```

Replace `<topic>` with the 64-character hex topic printed by the host. Do not type the angle brackets in zsh.

## Hermes OpenAI-Compatible API

Hermes already exposes an OpenAI-compatible API server, so the bridge can point at Hermes directly instead of Ollama/QVAC:

```sh
npm run dev -- host --base-url http://127.0.0.1:8642/v1 --model hermes-agent --strip-think
```

If you want Hermes session continuity across turns, pass a stable session id. Hermes uses the `X-Hermes-Session-Id` header for that:

```sh
npm run dev -- host \
  --base-url http://127.0.0.1:8642/v1 \
  --model hermes-agent \
  --session-id keet-room-demo \
  --api-key "$API_SERVER_KEY" \
  --strip-think
```

You can also set defaults through the environment before starting the bridge:

```sh
V1_CHAT_BASE_URL=http://127.0.0.1:8642/v1 \
V1_CHAT_MODEL=hermes-agent \
V1_CHAT_SESSION_ID=keet-room-demo \
npm run dev -- host --strip-think
```

## Pear Terminal Companion

The Pear terminal guide maps cleanly to a companion app for our own bridge protocol:

```sh
cd pear-terminal
npm install
"$HOME/Library/Application Support/pear/bin/pear" run --dev --tmp-store --no-ask .
```

Copy the 64-character topic printed after `topic:` into a second Pear terminal. Use the actual topic value, without angle brackets:

```sh
cd pear-terminal
"$HOME/Library/Application Support/pear/bin/pear" run --dev --tmp-store --no-ask . PASTE_TOPIC_HERE --name pear-b
```

Or connect the Pear terminal client to the TypeScript QVAC host:

```sh
npm run dev -- host --base-url http://127.0.0.1:11435/v1 --model qwen3-4b --strip-think
```

Copy the printed `topic:` value, then in another terminal:

```sh
cd pear-terminal
"$HOME/Library/Application Support/pear/bin/pear" run --dev --tmp-store --no-ask . PASTE_TOPIC_HERE --name pear-qvac
```

Example shape:

```sh
"$HOME/Library/Application Support/pear/bin/pear" run --dev --tmp-store --no-ask . dc5821a19d42fae5732c8905437d84a6104e83a3ed5ede056cb5d5d1dd1fd38b --name pear-qvac
```

If you see `zsh: no such file or directory: topic`, it means the placeholder was copied literally as `<topic>`. In zsh, `<topic>` is parsed as input redirection from a file named `topic`.

Inside the Pear terminal app:

- `/say <text>` broadcasts a text frame.
- `/ask <prompt>` sends a `chat.request`; the TypeScript host can answer it from the local OpenAI-compatible QVAC server.
- `/peers` prints the current peer count.

Observed working path:

1. Start the TypeScript host.
2. Start the Pear terminal app with the copied topic.
3. Wait for `[hello] client-a` or `peers=1`.
4. Type `/ask hello from pear`.
5. The Pear terminal prints the model response as `[assistant] ...`.

This is Pear/Hyperswarm-native, but it is still not the stock Keet room protocol.

## One-Shot Topic Posting

You can post to a running bridge topic without typing into the Pear terminal TTY by joining the same Hyperswarm topic as a short-lived peer:

```sh
npm run dev -- post --topic PASTE_TOPIC_HERE --say 'very nice indeed'
npm run dev -- post --topic PASTE_TOPIC_HERE --ask 'what time is it?'
```

This is useful for local scripts, test harnesses, or a future UI process that can call a command. It does not inject text into the existing terminal session; it posts bridge protocol frames as another peer on the same topic.

If a UI process can run local commands, the integration point is:

```sh
cd $HOME/project/keet-v1-chat-bridge
npm run dev -- post --topic PASTE_TOPIC_HERE --ask 'hello from the UI process'
```

The stock iPhone Keet app still cannot use this unless it speaks this bridge protocol or Keet exposes a public bot/room API.

## Background Pear QVAC Demo

The full local demo can be started as background processes with PID and log state:

This historical Pear/QVAC demo is not exposed as a top-level npm script anymore; run the helper directly when needed.

```sh
node scripts/demo/historical/pear-qvac-demo.mjs start
```

This starts:

- the TypeScript QVAC host with `--base-url http://127.0.0.1:11435/v1 --model qwen3-4b --strip-think`
- the Pear terminal companion using the host's printed topic

Runtime state is written under `.run/pear-qvac-demo/`:

- `.run/pear-qvac-demo/state.json`
- `.run/pear-qvac-demo/host.log`
- `.run/pear-qvac-demo/pear.log`

Useful commands:

```sh
node scripts/demo/historical/pear-qvac-demo.mjs status
node scripts/demo/historical/pear-qvac-demo.mjs logs
node scripts/demo/historical/pear-qvac-demo.mjs logs -- pear
node scripts/demo/historical/pear-qvac-demo.mjs stop
```

Environment overrides:

```sh
QVAC_BASE_URL=http://127.0.0.1:11435/v1 QVAC_MODEL=qwen3-4b PEAR_NAME=pear-qvac node scripts/demo/historical/pear-qvac-demo.mjs start
```

The Pear terminal app normally wants a TTY. The background script runs it through macOS `script` so it gets a pseudo-terminal while logs still go to `.run/pear-qvac-demo/pear.log`.

## Current Keet Gap

This bridge speaks a small newline-delimited JSON protocol over raw Hyperswarm streams. It proves the local P2P-to-`/v1/chat/completions` path, but the stock Keet iPhone app is not confirmed to expose a public bot or room protocol that can send these frames.

There is a probe mode for testing whether a Keet invite's first encoded key maps to a discovery topic:

```sh
npm run dev -- probe --keet-invite 'pear://keet/<invite>'
```

If the phone joins that same discovery key, the probe prints a peer connection. This is a connectivity probe only; it does not decode Keet room messages.

Observed with a real Keet chat room link:

- `pear://keet/<room-link>` was decoded into three aligned z-base32 key candidates.
- Probe joined each candidate as raw key and Hypercore discovery key.
- The stock Keet iPhone app did not connect to any candidate during the smoke test.

That means the raw Hyperswarm bridge still needs Keet's room/message protocol or an official bot API before it can talk directly to the stock Keet iPhone app. The later live-store experiment below can read and post by spawning the installed Keet core against the local macOS profile, but only while the Keet app is closed.

## Keet Internal API Inspection

The Pear desktop bundle includes private Keet packages with a generated internal RPC API. If you have a local Pear dump:

```sh
pear dump pear://keet /tmp/keet-pear-dump --no-ask
```

You can inspect the send path for a room welcome message:

```sh
npm run dev -- keet-welcome --room 'pear://keet/<room-link>'
```

This command does not send yet. It validates the dumped internal API and prints the required calls:

- `core.getLinkInfo`
- `core.pairRoom`
- `core.getRoomInfo`
- `core.addChatMessage`
- `core.subscribeChatMessages`

For a stricter red/green read-only probe of the internal Keet RPC path:

```sh
npm run dev -- keet-rpc-probe --keet-dump /tmp/keet-pear-dump
```

Observed against the local `pear://keet` dump:

- green: the core worker entrypoint exists at `workers/core/index.js`.
- green: the desktop store launches that worker with `pear-run`, then wraps the stream with `framed-stream`, `tiny-buffer-rpc`, and `@holepunchto/keet-rpc/client`.
- green: the worker side uses `Pear.worker.pipe()`, `framed-stream`, `tiny-buffer-rpc`, `@holepunchto/keet-rpc/server`, and `@holepunchto/keet-core-hyperdb`.
- green: required RPC methods exist: `core.getLinkInfo=19`, `core.pairRoom=23`, `core.getRoomInfo=36`, `core.addChatMessage=95`, `core.subscribeChatMessages=123`.
- yellow: the lower-level `add-chat-message-request` schema is visible as `header`, `roomKey`, and `message`, while the store-level plain text call is inferred as `addChatMessage(roomId, text, opts)`.
- yellow: mutating send is possible through the installed local profile when the live-store guard is green, but it still uses private `UNLICENSED` app-internal API with no supported bot SDK or public external endpoint.

Current blocker: these APIs are present only in `UNLICENSED` private bundle packages. The desktop bundle connects to Keet core through an in-process Pear subprocess pipe. The supported-product answer is still to wait for a public Keet bot/room API, but the local experiment can now read and write a known room id from this Mac's paired Keet store.

## Installed Keet Live Store Guard

The installed macOS Keet app does not launch the user Pear CLI at `~/Library/Application Support/pear/bin/pear` for its live core. It launches its bundled Bare sidecar directly:

```text
/Applications/Keet.app/Contents/Resources/app/node_modules/bare-sidecar/prebuilds/darwin-universal/bare
```

with this worker:

```text
/Applications/Keet.app/Contents/Resources/app/.webpack/main/workers/core/index.mjs
```

On this machine the live Keet store was detected under the local account:

```text
$HOME/Library/Application Support/pear/app-storage/by-dkey/<detected-dkey>
```

Before any future command opens that live store, run:

```sh
npm run dev -- keet-live-store-guard
```

This command is a safety gate only. It does not open Keet's Corestore/RocksDB data. It checks the installed worker/API paths, detects the active profile, and scans running processes for Keet or the Keet core sidecar. If Keet is running, it exits with code `2` and prints `can open live store: no`.

Observed while Keet was open:

- green: installed app resources, core worker, API manifest, live storage path, and active profile `0`.
- red: concurrent live core, because the Keet sidecar process was using the detected `app-storage/by-dkey/...` path.
- red: concurrent Keet app, because Electron helper processes were still running.

Do not open the detected live store while this guard is red. Quit Keet, rerun the guard, and only proceed with a read-only room/message probe if it prints `can open live store: yes`.

With the guard green, the installed Keet core can be spawned through its bundled `bare-sidecar` and read through the bundled `@holepunchto/keet-core/rpc/client` mapping:

```sh
npm run dev -- keet-live-readonly-probe --timeout-ms 20000
npm run dev -- keet-live-readonly-probe --timeout-ms 20000 --room 'pear://keet/<room-link>'
```

This command still starts by running the live-store guard. It calls read-oriented RPCs only, currently `swarm.ready`, `core.getVersion`, `core.getIdentity`, `core.getRoomKeys`, `core.getRecentRooms`, `core.getRoomInfo`, `core.getChatMessages`, and optionally `core.getLinkInfo`. It writes the Keet worker log to `/dev/null` and shuts down the sidecar it starts.

Observed after quitting Keet:

- green: live store opened through the installed worker.
- green: identity and version reads worked.
- green: recent rooms returned two room ids.
- green: room info and chat messages were readable for those rooms.
- green: `core.getLinkInfo` returned `null` for the supplied invite, which means that link was not resolved by the current local store/core context.

With the guard green and an explicit local room id, the installed Keet core can also post a plain text message:

```sh
npm run dev -- keet-live-send --room-id <local-keet-room-id> --message 'Warm welcome from the local QVAC/Keet integration.' --timeout-ms 20000
```

This command starts by running the live-store guard, opens the same bundled Keet core worker, verifies `core.getRoomInfo(roomId)`, calls `core.addChatMessage(roomId, text, {})`, then reads recent messages back with `core.getChatMessages(roomId, { reverse: true })`. It should only be used against an explicit test room id, with Keet closed.

For propagation-sensitive sends, keep the core online after the local append:

```sh
npm run dev -- keet-live-send --room-id <local-keet-room-id> --message 'Gated send test from the local Keet/QVAC bridge. Please reply when this appears on the other device.' --linger-ms 60000 --wait-for-response --timeout-ms 20000
```

There is no confirmed delivery-receipt RPC in the current private API surface, so `--wait-for-response` gates on the next later room message rather than a true read receipt. That is still useful for demos: it proves the sent message propagated far enough for another device/user to answer, and the local core synced the response back.

Observed against the local `qvac` test room:

- green: `core.addChatMessage(roomId, text, {})` returned an oplog key and length.
- green: the newest recent message was the welcome text from the local profile.
- green: the sidecar process exited after the command; no Keet or Keet core process was left running.
- green: with `--linger-ms 60000 --wait-for-response`, the command sent a test message, stayed online, then exited after seeing the next later response message in the room.

For incoming messages from paired devices, keep the Keet app closed and run the read-only watcher:

```sh
npm run dev -- keet-live-watch --room-id <local-keet-room-id>
```

The watcher opens the installed Keet core, records the current highest chat sequence as a high-water mark, then subscribes with `core.subscribeChatMessages(roomId)` by default. The subscription emits full room message arrays, including an initial replay, so the watcher filters on later `seq` values and prints new messages as newline-delimited JSON events. If subscription behavior changes, fall back to polling with `--poll-ms 2000` or `--no-subscribe`. Use `--once` for a non-mutating startup smoke test:

```sh
npm run dev -- keet-live-watch --room-id <local-keet-room-id> --once --timeout-ms 20000
```

To let the local QVAC server reply to new messages, run the agent:

```sh
npm run dev -- keet-live-agent --room-id <local-keet-room-id> --base-url http://127.0.0.1:11435/v1 --model qwen3-4b --strip-think
```

The agent uses the same high-water mark, sends each new non-empty message to the OpenAI-compatible `/v1/chat/completions` endpoint, and posts replies back with a `[qvac]` prefix. It ignores messages that already start with `[qvac]` to avoid replying to itself. Subscription mode is the default; polling remains available with `--poll-ms 2000` or `--no-subscribe`.

To run the agent in the background:

```sh
npm run keet:agent:start -- --room-id <local-keet-room-id> --base-url http://127.0.0.1:11435/v1 --model qwen3-4b
npm run keet:agent:status
npm run keet:agent:logs
npm run keet:agent:stop
```

If Keet is open, these commands exit red with the guard message instead of opening the store. That is expected; do not run them concurrently with the Keet GUI.

That read-only experiment is now available:

```sh
npm run dev -- keet-readonly-probe --keet-dump /tmp/keet-pear-dump --timeout-ms 15000
npm run dev -- keet-readonly-probe --keet-dump /tmp/keet-pear-dump --room 'pear://keet/<room-link>' --timeout-ms 15000
```

This launches `pear-keet-readonly-probe` through Pear with `--tmp-store`, then starts `/tmp/keet-pear-dump/workers/core/index.js` against a temporary storage directory. It registers only the read-only RPC methods needed for the probe:

- `swarm.ready` RPC method `0`
- `core.getLinkInfo` RPC method `19`

Observed result:

- `swarm.ready` returned green against a temporary store.
- `core.getLinkInfo` returned green at the RPC level for the test room link, but the returned `linkInfo` was `null` under the fresh temp identity/store.
- No `pairRoom`, `addChatMessage`, or other mutating RPC was called.

Implementation caveat: the first attempt to import `pear-run`/RPC dependencies directly from `/tmp/keet-pear-dump/node_modules` failed because Pear resolved a dumped addon through an unsupported `pear://dev/tmp/...` path. The working probe now uses app-local public `pear-run`, `framed-stream`, and `tiny-buffer-rpc` dependencies. That fixes the parent-side deprecated `Pear.worker.run()` usage. The remaining deprecation warning comes from the dumped Keet core worker itself calling `Pear.worker.pipe()`. The successor for that child side is `pear-pipe`, but using it cleanly would require the worker source to call `require('pear-pipe')()` directly; we are not editing or copying the private dumped worker for this probe.

To connect the iPhone app directly, the next required piece is either:

- a documented Keet/Pear room or bot API that this bridge can implement, or
- a small Pear/Holepunch mobile-compatible client that speaks this bridge protocol.
