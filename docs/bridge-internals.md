# Keet/v1 Chat Live Bridge Notes

This project can bridge a paired macOS Keet profile to a local OpenAI-compatible chat server by launching the same Keet core worker that the Keet desktop GUI normally launches.

## Official Sources vs Local Hacks

Official/public pieces:

- Keet product docs/site: <https://keet.io/>
- Holepunch GitHub org: <https://github.com/holepunchto>
- Pear docs: <https://docs.pears.com/>
- Keet desktop app shell repos:
  - <https://github.com/holepunchto/keet-appling>
  - <https://github.com/holepunchto/keet-appling-next>
- Keet mobile release/changelog repo: <https://github.com/holepunchto/keet-mobile-releases>
- Public Pear modules relevant to the IPC direction:
  - `pear-run`
  - `pear-pipe`
  - `framed-stream`
  - `tiny-buffer-rpc`
- Public Holepunch building blocks:
  - Hyperswarm
  - HyperDHT
  - Hypercore
  - Corestore
  - Hyperbee
  - Autobase

Hacky/private pieces:

- The working room bridge does not use a public Keet bot API.
- It imports the installed app's bundled private package path `@holepunchto/keet-core/rpc/client`.
- It launches the installed app's private compiled worker at `.webpack/main/workers/core/index.mjs`.
- It uses the paired user's live local store under `~/Library/Application Support/pear/app-storage/by-dkey/...`.
- The RPC calls we rely on, including `core.getChatMessages` and `core.addChatMessage`, are app-internal behavior. They can change when Keet updates.
- `--wait-for-response` is not a delivery receipt; it is an application-level gate that waits for any later room message.

## Auth and Login

There is no web `keet.io` login in this flow. Keet's own site says no phone number/email signup is required, and linked devices are synced by QR code or secure sync link. In this bridge, "auth" is inherited from the already-paired local Keet profile on this Mac.

Practical meaning:

- First install Keet normally.
- Link this Mac through Keet's supported device-link flow.
- Join or create the target test room in Keet.
- Quit Keet on this Mac so the live store is not open.
- The bridge opens the paired local store and acts as that local Keet identity.

That is why this should only be used on your own profile and explicit test rooms.

## Safety Model

Do not open the live Keet store concurrently with the Keet GUI. The live commands all run `keet-live-store-guard` first and refuse to continue while Keet or its core sidecar is using the detected store.

Check the guard:

```sh
npm run dev -- keet-live-store-guard
```

Expected safe output:

```text
can open live store: yes
```

If it prints `can open live store: no`, quit Keet on this Mac before retrying.

## What Failed

- Raw Hyperswarm topic inference from a `pear://keet/...` room link did not make the stock Keet iPhone app connect to our simple newline-delimited bridge protocol.
- Treating the first decoded Keet link key as a plain discovery topic was insufficient. Keet rooms include their own identity, encryption, state, and room protocol above the Holepunch transport.
- A fresh temporary Keet worker/store could call read-only RPCs such as `swarm.ready` and `core.getLinkInfo`, but it did not resolve the real paired room link because it was not the paired user profile/store.
- A one-shot `core.addChatMessage` can commit locally but may exit too quickly for useful propagation to other devices.
- We have not found a confirmed public Keet bot SDK, public room API, or delivery-receipt RPC for this integration.

## What Worked

- The installed macOS Keet app uses a bundled Bare sidecar, not the user Pear CLI:

```text
/Applications/Keet.app/Contents/Resources/app/node_modules/bare-sidecar/prebuilds/darwin-universal/bare
```

- Its core worker is:

```text
/Applications/Keet.app/Contents/Resources/app/.webpack/main/workers/core/index.mjs
```

- The CLI can spawn that worker against the paired local store while Keet is closed, connect over fd 3 with `framed-stream` and `tiny-buffer-rpc`, then use the bundled `@holepunchto/keet-core/rpc/client`.
- Read-only probing works:

```sh
npm run dev -- keet-live-readonly-probe --timeout-ms 20000
```

- Incoming message watch works:

```sh
npm run dev -- keet-live-watch --room-id <local-keet-room-id>
```

- `core.subscribeChatMessages(roomId)` is present and callable. It immediately replays a full chat message array, then later updates arrive as full arrays too, not single-message deltas. The watcher and agent use subscription mode by default, keep a startup high-water mark, and filter on later `seq` values. Polling with `--poll-ms 2000` or `--no-subscribe` remains a fallback. The probe command is:

```sh
npm run dev -- keet-live-subscribe-probe --room-id <local-keet-room-id> --timeout-ms 60000
```

Observed result: after the initial replay, a later message `hey subbed 2?` arrived as a new subscription event with a higher `seq`, confirming that subscription mode can replace polling for the live demo.

- Sending works when the worker is kept online long enough:

```sh
npm run dev -- keet-live-send \
  --room-id <local-keet-room-id> \
  --message 'hello from the local Keet/v1 chat bridge' \
  --linger-ms 60000 \
  --wait-for-response \
  --timeout-ms 20000
```

`--wait-for-response` is not a true read receipt. It waits for the next later room message, which confirms that another device/user saw enough state to respond and that the local core synced the response back.

## v1 Chat Agent

With the local OpenAI-compatible server running, start the foreground agent:

```sh
npm run dev -- keet-live-agent \
  --room-id <local-keet-room-id> \
  --base-url http://127.0.0.1:11435/v1 \
  --model qwen3-4b \
  --strip-think
```

The agent:

- sets a high-water mark from current room messages at startup
- subscribes for later room snapshots and filters messages by `seq`
- ignores empty messages and messages starting with `[qvac]`
- sends new user messages to `/v1/chat/completions`
- posts replies back into the Keet room with a `[qvac]` prefix

### Backend Busy and Error Reporting

Hermes and QVAC are both consumed here through OpenAI-compatible HTTP endpoints. In the current bridge, there is no separate backend capacity API or explicit "busy" signal wired into the Keet agent.

Known endpoint behavior:

- Hermes exposes `GET /health`, which can report that the Hermes platform process is up.
- Hermes and QVAC expose `GET /v1/models`, which can report that the OpenAI-compatible server is reachable.
- Neither check proves that the next LLM inference request can be accepted immediately.

Current bridge behavior:

- `streamChatCompletion()` throws when `/v1/chat/completions` returns a non-2xx HTTP status.
- It also surfaces connection failures, timeouts, and stream failures as thrown errors.
- `replyToMessage()` catches those failures and logs a `reply_error` JSON event.
- The agent does not currently post a visible Keet room message when inference cannot be handled.

Recommended bridge-level behavior:

- Treat HTTP `429` as busy or rate limited.
- Treat HTTP `503` as backend unavailable or overloaded.
- Treat HTTP `504` and request timeouts as inference timed out.
- Treat connection errors such as `ECONNREFUSED` as backend offline.
- Treat a stream that fails after response acceptance as an interrupted inference.

A practical user-facing fallback would be for the agent to post a short Keet message such as:

```text
[qvac] Backend is busy or unavailable right now. Please try again in a moment.
```

This can be implemented entirely in the bridge by classifying errors from `streamChatCompletion()` and posting a fallback message from `replyToMessage()`. It does not require a new Hermes or QVAC API, although a future backend-specific queue or capacity endpoint would allow more precise status.

## Daemon Wrapper

The daemon wrapper starts the same agent in the background and stores PID/log state under `.run/keet-live-agent/`.

Start:

```sh
npm run keet:agent:start -- \
  --room-id <local-keet-room-id> \
  --base-url http://127.0.0.1:11435/v1 \
  --model qwen3-4b
```

Or use environment variables:

```sh
KEET_ROOM_ID=<local-keet-room-id> \
V1_CHAT_BASE_URL=http://127.0.0.1:11435/v1 \
V1_CHAT_MODEL=qwen3-4b \
KEET_SUBSCRIBE=true \
npm run keet:agent:start
```

Status/logs/stop:

```sh
npm run keet:agent:status
npm run keet:agent:logs
npm run keet:agent:stop
```

The wrapper does not bypass the guard. If Keet is open on this Mac, startup should fail red and the log will show the guard refusal.

## Current Limits

- This uses private Keet app-internal APIs from the installed desktop bundle.
- Only run it against explicit test room ids.
- Keep Keet closed on this Mac while the bridge or daemon is running.
- A robust product version should use a separate bot identity/store or an official Keet bot API once one is available.
