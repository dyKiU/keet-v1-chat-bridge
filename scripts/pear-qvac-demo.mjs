#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const rootDir = path.resolve(import.meta.dirname, '..')
const stateDir = path.join(rootDir, '.run', 'pear-qvac-demo')
const stateFile = path.join(stateDir, 'state.json')
const hostLog = path.join(stateDir, 'host.log')
const pearLog = path.join(stateDir, 'pear.log')
const pearBin = process.env.PEAR_BIN ?? '/Users/pj/Library/Application Support/pear/bin/pear'

const command = process.argv[2] ?? 'help'

switch (command) {
  case 'start':
    await start()
    break
  case 'stop':
    await stop()
    break
  case 'status':
    await status()
    break
  case 'logs':
    await logs(process.argv[3])
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

async function start () {
  const existing = await readState().catch(() => null)
  if (existing && isRunning(existing.hostPid)) {
    console.log(`Already running: host pid ${existing.hostPid}, topic ${existing.topic}`)
    if (existing.pearPid && isRunning(existing.pearPid)) console.log(`Pear pid ${existing.pearPid}`)
    return
  }

  await mkdir(stateDir, { recursive: true })
  await rm(hostLog, { force: true })
  await rm(pearLog, { force: true })

  const hostFd = openSync(hostLog, 'a')
  const host = spawn('npm', [
    'run',
    'dev',
    '--',
    'host',
    '--base-url',
    process.env.QVAC_BASE_URL ?? 'http://127.0.0.1:11435/v1',
    '--model',
    process.env.QVAC_MODEL ?? 'qwen3-4b',
    '--strip-think'
  ], {
    cwd: rootDir,
    detached: true,
    stdio: ['ignore', hostFd, hostFd],
    env: process.env
  })
  closeSync(hostFd)

  host.unref()

  const topic = await waitForTopic(host, hostLog, 30_000)
  const pearFd = openSync(pearLog, 'a')
  const pear = spawn('sh', [
    '-c',
    'tail -f /dev/null | script -q /dev/null "$@"',
    'pear-qvac-script',
    pearBin,
    'run',
    '--dev',
    '--tmp-store',
    '--no-ask',
    '.',
    topic,
    '--name',
    process.env.PEAR_NAME ?? 'pear-qvac'
  ], {
    cwd: path.join(rootDir, 'pear-terminal'),
    detached: true,
    stdio: ['ignore', pearFd, pearFd],
    env: process.env
  })
  closeSync(pearFd)
  pear.unref()

  await writeState({
    topic,
    hostPid: host.pid,
    pearPid: pear.pid,
    hostLog,
    pearLog,
    startedAt: new Date().toISOString()
  })

  console.log(`Started QVAC host pid ${host.pid}`)
  console.log(`Started Pear terminal pid ${pear.pid}`)
  console.log(`topic: ${topic}`)
  console.log(`logs: ${hostLog}`)
  console.log(`logs: ${pearLog}`)
}

async function stop () {
  const state = await readState().catch(() => null)
  if (!state) {
    console.log('Not running')
    return
  }

  const pids = [state.pearPid, state.hostPid].filter(Boolean)

  for (const pid of pids) {
    if (isRunning(pid)) {
      killGroup(pid, 'SIGTERM')
    }
  }

  await writeState({ ...state, stoppedAt: new Date().toISOString() })
}

async function status () {
  const state = await readState().catch(() => null)
  if (!state) {
    console.log('Not running')
    return
  }

  console.log(`topic: ${state.topic}`)
  console.log(`host: ${state.hostPid} ${isRunning(state.hostPid) ? 'running' : 'stopped'}`)
  console.log(`pear: ${state.pearPid} ${isRunning(state.pearPid) ? 'running' : 'stopped'}`)
  console.log(`host log: ${state.hostLog}`)
  console.log(`pear log: ${state.pearLog}`)
}

async function logs (target) {
  const state = await readState().catch(() => null)
  if (!state) {
    console.log('Not running')
    return
  }

  const file = target === 'pear' ? state.pearLog : state.hostLog
  console.log(await readFile(file, 'utf8'))
}

async function waitForTopic (child, logFile, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Host exited before printing a topic: code=${child.exitCode}. See ${logFile}`)
    }

    const text = existsSync(logFile) ? await readFile(logFile, 'utf8') : ''
    const match = text.match(/^topic:\s*([0-9a-f]{64})$/im)
    if (match) return match[1]

    await sleep(250)
  }

  throw new Error(`Timed out waiting for host topic. See ${logFile}`)
}

async function readState () {
  if (!existsSync(stateFile)) throw new Error(`No demo state found at ${stateFile}`)
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
    'Usage: node scripts/pear-qvac-demo.mjs <start|stop|status|logs>',
    '',
    'Environment:',
    '  QVAC_BASE_URL  default http://127.0.0.1:11435/v1',
    '  QVAC_MODEL     default qwen3-4b',
    '  PEAR_NAME      default pear-qvac',
    `  PEAR_BIN       default ${pearBin}`
  ].join('\n')
}
