/* global Pear, Bare */
'use strict'

const args = Pear.config.args
const dumpPath = readFlag(args, '--keet-dump') || '/tmp/keet-pear-dump'
const roomLink = readFlag(args, '--room')
const timeoutMs = Number(readFlag(args, '--timeout-ms') || 15000)
const storage = readFlag(args, '--storage') || Pear.config.storage + '/keet-core-readonly-probe-' + Date.now()

let rpc = null
let pipe = null
let rawPipe = null

Pear.teardown(() => {
  if (rpc) rpc.destroy()
  if (pipe) pipe.destroy()
  if (rawPipe) rawPipe.destroy()
})

main().catch((error) => {
  console.log(JSON.stringify({
    status: 'red',
    error: error && error.message ? error.message : String(error)
  }))
  exit(2)
})

async function main () {
  const FramedStream = require('framed-stream')
  const TinyBufferRPC = require('tiny-buffer-rpc')
  const any = require('tiny-buffer-rpc/any')
  const pearRun = require('pear-run')
  const coreEntrypoint = dumpPath + '/workers/core/index.js'
  const workerArgs = [
    storage,
    'false',
    'false',
    'false',
    'false',
    'undefined'
  ]

  rawPipe = pearRun(coreEntrypoint, workerArgs)
  pipe = new FramedStream(rawPipe)
  rpc = new TinyBufferRPC((buf) => pipe.write(buf))
  pipe.on('data', (buf) => rpc.recv(buf))
  pipe.on('error', (error) => {
    console.log(JSON.stringify({
      status: 'red',
      step: 'pipe',
      error: error && error.message ? error.message : String(error)
    }))
  })

  const swarmReady = rpc.register(0, { request: any, response: any })
  const getLinkInfo = rpc.register(19, { request: any, response: any })

  await withTimeout(swarmReady.request([]), timeoutMs, 'swarm.ready')

  const result = {
    status: 'green',
    storage,
    worker: coreEntrypoint,
    checks: ['swarm.ready']
  }

  if (roomLink) {
    const info = await withTimeout(getLinkInfo.request([roomLink]), timeoutMs, 'core.getLinkInfo')
    result.checks.push('core.getLinkInfo')
    result.linkInfo = summarize(info)
  }

  console.log(JSON.stringify(result, null, 2))
  exit(0)
}

function summarize (value) {
  if (Buffer.isBuffer(value)) return '<buffer:' + value.length + '>'
  if (Array.isArray(value)) return value.map(summarize)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    if (Buffer.isBuffer(item)) out[key] = '<buffer:' + item.length + '>'
    else if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) out[key] = item
    else if (Array.isArray(item)) out[key] = item.map(summarize)
    else out[key] = summarize(item)
  }
  return out
}

function withTimeout (promise, ms, label) {
  let timer = null
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function readFlag (argv, flag) {
  const index = argv.indexOf(flag)
  if (index === -1) return null
  const value = argv[index + 1]
  return value && !value.startsWith('--') ? value : null
}

function exit (code) {
  if (rpc) rpc.destroy()
  if (pipe) pipe.destroy()
  if (rawPipe) rawPipe.destroy()
  Bare.exit(code)
}
