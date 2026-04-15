#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const rootDir = path.resolve(import.meta.dirname, '..')
const stateDir = path.join(rootDir, '.run', 'keet-live-agent')
const stateFile = path.join(stateDir, 'state.json')
const agentLog = path.join(stateDir, 'agent.log')

const command = process.argv[2] ?? 'help'

switch (command) {
  case 'start':
    await start(parseArgs(process.argv.slice(3)))
    break
  case 'stop':
    await stop()
    break
  case 'status':
    await status()
    break
  case 'logs':
    await logs()
    break
  case 'help':
  case '--help':
  case '-h':
    console.log(usage())
    break
  default:
    console.error(`Unknown command: ${command}\n${usage()}`)
    process.exitCode = 1
}

async function start (args) {
  const roomId = args.roomId ?? process.env.KEET_ROOM_ID ?? process.env.QVAC_KEET_ROOM_ID
  if (!roomId) throw new Error('start requires --room-id <local-keet-room-id> or KEET_ROOM_ID')

  const existing = await readState().catch(() => null)
  if (existing && isRunning(existing.agentPid)) {
    console.log(`Already running: agent pid ${existing.agentPid}`)
    console.log(`room id: ${existing.roomId}`)
    return
  }

  await mkdir(stateDir, { recursive: true })
  await rm(agentLog, { force: true })

  const logFd = openSync(agentLog, 'a')
  const agentArgs = [
    'run',
    'dev',
    '--',
    'keet-live-agent',
    '--room-id',
    roomId,
    '--base-url',
    args.baseUrl ?? process.env.V1_CHAT_BASE_URL ?? process.env.QVAC_BASE_URL ?? 'http://127.0.0.1:11435/v1',
    '--model',
    args.model ?? process.env.V1_CHAT_MODEL ?? process.env.QVAC_MODEL ?? 'qwen3-4b'
  ]

  if (args.thinkingModel ?? process.env.V1_CHAT_THINKING_MODEL) {
    agentArgs.push('--thinking-model', args.thinkingModel ?? process.env.V1_CHAT_THINKING_MODEL)
  }

  if (args.subscribe ?? (process.env.KEET_SUBSCRIBE ?? process.env.QVAC_KEET_SUBSCRIBE) === 'true') {
    agentArgs.push('--subscribe')
  } else {
    agentArgs.push('--poll-ms', String(args.pollMs ?? process.env.KEET_POLL_MS ?? process.env.QVAC_KEET_POLL_MS ?? 2000))
  }

  if (args.stripThink ?? (process.env.V1_CHAT_STRIP_THINK ?? process.env.QVAC_STRIP_THINK) !== 'false') {
    agentArgs.push('--strip-think')
  }

  if (args.system ?? process.env.V1_CHAT_SYSTEM_PROMPT ?? process.env.QVAC_SYSTEM_PROMPT) {
    agentArgs.push('--system', args.system ?? process.env.V1_CHAT_SYSTEM_PROMPT ?? process.env.QVAC_SYSTEM_PROMPT)
  }

  const agent = spawn('npm', agentArgs, {
    cwd: rootDir,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env
  })
  closeSync(logFd)
  agent.unref()

  await writeState({
    agentPid: agent.pid,
    roomId,
    log: agentLog,
    args: agentArgs,
    startedAt: new Date().toISOString()
  })

  const ready = await waitForStartup(agent, agentLog, 20_000)
  console.log(`Started Keet live agent pid ${agent.pid}`)
  console.log(`room id: ${roomId}`)
  console.log(`log: ${agentLog}`)
  if (ready) console.log(ready)
}

async function stop () {
  const state = await readState().catch(() => null)
  if (!state) {
    console.log('Not running')
    return
  }

  if (isRunning(state.agentPid)) {
    killGroup(state.agentPid, 'SIGTERM')
    await sleep(1000)
    if (isRunning(state.agentPid)) killGroup(state.agentPid, 'SIGKILL')
  }

  await writeState({ ...state, stoppedAt: new Date().toISOString() })
}

async function status () {
  const state = await readState().catch(() => null)
  if (!state) {
    console.log('Not running')
    return
  }

  console.log(`agent: ${state.agentPid} ${isRunning(state.agentPid) ? 'running' : 'stopped'}`)
  console.log(`room id: ${state.roomId}`)
  console.log(`log: ${state.log}`)
}

async function logs () {
  const state = await readState().catch(() => null)
  const file = state?.log ?? agentLog
  if (!existsSync(file)) {
    console.log(`No log found at ${file}`)
    return
  }

  console.log(await readFile(file, 'utf8'))
}

async function waitForStartup (child, logFile, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Agent exited before startup completed: code=${child.exitCode}. See ${logFile}`)
    }

    const text = existsSync(logFile) ? await readFile(logFile, 'utf8') : ''
    if (text.includes('"status": "green"')) return 'agent status: green'
    if (text.includes('"status": "red"')) throw new Error(`Agent reported red status. See ${logFile}`)

    await sleep(250)
  }

  return `startup still pending after ${timeoutMs}ms; check ${logFile}`
}

function parseArgs (argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--room-id':
        args.roomId = readValue(argv, ++index, arg)
        break
      case '--base-url':
        args.baseUrl = readValue(argv, ++index, arg)
        break
      case '--model':
        args.model = readValue(argv, ++index, arg)
        break
      case '--thinking-model':
        args.thinkingModel = readValue(argv, ++index, arg)
        break
      case '--poll-ms':
        args.pollMs = Number(readValue(argv, ++index, arg))
        if (!Number.isFinite(args.pollMs) || args.pollMs <= 0) throw new Error('--poll-ms requires a positive number')
        break
      case '--subscribe':
        args.subscribe = true
        break
      case '--system':
        args.system = readValue(argv, ++index, arg)
        break
      case '--no-strip-think':
        args.stripThink = false
        break
      default:
        throw new Error(`Unknown option: ${arg}\n${usage()}`)
    }
  }
  return args
}

function readValue (argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

async function readState () {
  if (!existsSync(stateFile)) throw new Error(`No daemon state found at ${stateFile}`)
  return JSON.parse(await readFile(stateFile, 'utf8'))
}

async function writeState (state) {
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`)
}

function isRunning (pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function killGroup (pid, signal) {
  try {
    process.kill(-pid, signal)
    console.log(`Sent ${signal} to process group ${pid}`)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function sleep (ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function usage () {
  return [
    'Usage: node scripts/keet-live-agent-daemon.mjs <start|stop|status|logs> [options]',
    '',
    'Start options:',
    '  --room-id <id>       local Keet room id; alternatively KEET_ROOM_ID or QVAC_KEET_ROOM_ID',
    '  --base-url <url>     default V1_CHAT_BASE_URL, QVAC_BASE_URL, or http://127.0.0.1:11435/v1',
    '  --model <name>       default V1_CHAT_MODEL, QVAC_MODEL, or qwen3-4b',
    '  --thinking-model <label>  label for thinking marker; alternatively V1_CHAT_THINKING_MODEL',
    '  --subscribe          use core.subscribeChatMessages; alternatively KEET_SUBSCRIBE=true or QVAC_KEET_SUBSCRIBE=true',
    '  --poll-ms <ms>       polling fallback; default KEET_POLL_MS, QVAC_KEET_POLL_MS, or 2000',
    '  --system <text>      optional system prompt; alternatively V1_CHAT_SYSTEM_PROMPT or QVAC_SYSTEM_PROMPT',
    '  --no-strip-think     do not pass --strip-think to the agent',
    '',
    'Legacy QVAC_* environment variable names are still accepted as fallbacks.',
    '',
    'Safety:',
    '  Keet must be closed on this Mac. The agent command still runs the live-store guard.'
  ].join('\n')
}
