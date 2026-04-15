# Keet v1 Chat Bridge

Bridge a local Keet room to an OpenAI-compatible `/v1/chat/completions` backend such as Hermes or QVAC.

The main path is the Keet live agent. It watches a local Keet room, sends new user messages to the configured model backend, and posts replies back into the room.

## Run The Agent

Keet must be closed on this Mac before starting the bridge. The live-store guard refuses to run while the Keet GUI or its core sidecar owns the local store.

Start the background agent:

```sh
npm run keet:agent:start -- \
  --room-id <local-keet-room-id> \
  --base-url http://127.0.0.1:8642/v1 \
  --model hermes-agent \
  --thinking-model hermes-agent/qwen3-4b \
  --subscribe
```

Check status:

```sh
npm run keet:agent:status
```

Read logs:

```sh
npm run keet:agent:logs
```

Stop the agent:

```sh
npm run keet:agent:stop
```

## Backend Examples

Hermes:

```sh
--base-url http://127.0.0.1:8642/v1 --model hermes-agent
```

QVAC:

```sh
--base-url http://127.0.0.1:11435/v1 --model qwen3-4b
```

## Docs

- [Keet Bridge Operations](docs/keet-ops.md): detailed commands, probes, local demos, and historical notes.
- [Keet/QVAC Live Bridge Notes](docs/keet-qvac-live-bridge.md): source-code map, safety model, private Keet API caveats, daemon runbook, and backend busy/error notes.

## Useful Scripts

```sh
npm test
npm run typecheck
npm run dev -- keet-live-store-guard
```
