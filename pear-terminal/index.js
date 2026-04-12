/** @typedef {import('pear-interface')} */ /* global Pear */
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import readline from 'bare-readline'
import tty from 'bare-tty'
import process from 'bare-process'
import { decodeFrames, encodeFrame, parseCommand } from './lib/frames.js'

const { teardown, config, updates } = Pear
const swarm = new Hyperswarm()
const topicArg = config.args.find((arg) => /^[0-9a-f]{64}$/i.test(arg))
const name = readFlag(config.args, '--name') ?? `pear-${shortKey(swarm.keyPair.publicKey)}`
const topicBuffer = topicArg ? b4a.from(topicArg, 'hex') : crypto.randomBytes(32)
const topicHex = b4a.toString(topicBuffer, 'hex')
const remainders = new WeakMap()
const pending = new Map()

teardown(() => swarm.destroy())
updates(() => Pear.reload())

const rl = readline.createInterface({
  input: new tty.ReadStream(0),
  output: new tty.WriteStream(1)
})

swarm.on('connection', (peer) => {
  const remoteName = shortKey(peer.remotePublicKey)
  remainders.set(peer, '')
  console.log(`[info] connected ${remoteName}`)
  peer.write(encodeFrame({
    type: 'hello',
    peerId: b4a.toString(swarm.keyPair.publicKey, 'hex'),
    name,
    ts: Date.now()
  }))

  peer.on('data', (chunk) => onData(peer, remoteName, chunk))
  peer.on('close', () => remainders.delete(peer))
  peer.on('error', (error) => console.log(`[error] ${remoteName}: ${error.message}`))
})

swarm.on('update', () => {
  console.log(`[info] peers=${swarm.connections.size}`)
})

const discovery = swarm.join(topicBuffer, { client: true, server: true })
await discovery.flushed()
await swarm.flush()

console.log(`[info] qvac pear terminal bridge ready`)
console.log(`[info] topic: ${topicHex}`)
console.log(`[info] name: ${name}`)
console.log(`[info] commands: /ask <prompt>, /say <text>, /peers, /help`)

rl.input.setMode(tty.constants.MODE_RAW)
rl.on('data', (line) => {
  handleLine(line)
  rl.prompt()
})
rl.prompt()
rl.on('close', () => process.kill(process.pid, 'SIGINT'))

function onData (peer, remoteName, chunk) {
  const decoded = decodeFrames(b4a.toString(chunk), remainders.get(peer) ?? '')
  remainders.set(peer, decoded.remainder)

  for (const { line, error } of decoded.errors) {
    console.log(`[error] ${remoteName}: ${error.message}: ${line}`)
  }

  for (const message of decoded.messages) {
    handleMessage(remoteName, message)
  }
}

function handleLine (line) {
  const command = parseCommand(line)
  if (command.type === 'empty') return
  if (command.type === 'help') {
    console.log('commands: /ask <prompt>, /say <text>, /peers, /help')
    return
  }
  if (command.type === 'peers') {
    console.log(`[info] peers=${swarm.connections.size}`)
    return
  }

  if (command.type === 'ask') {
    const id = `req_${b4a.toString(crypto.randomBytes(8), 'hex')}`
    pending.set(id, [])
    writeAll({ type: 'chat.request', id, prompt: command.text, ts: Date.now() })
    return
  }

  writeAll({ type: 'chat.text', text: command.text, from: name, ts: Date.now() })
}

function handleMessage (remoteName, message) {
  switch (message.type) {
    case 'hello':
      console.log(`[hello] ${message.name ?? remoteName}`)
      break
    case 'chat.text':
      console.log(`[${message.from ?? remoteName}] ${message.text}`)
      break
    case 'chat.request':
      console.log(`[request] ${message.prompt ?? '(messages)'}`)
      break
    case 'chat.delta':
      if (!pending.has(message.id)) pending.set(message.id, [])
      pending.get(message.id).push(message.content)
      break
    case 'chat.done': {
      const chunks = pending.get(message.id) ?? []
      pending.delete(message.id)
      console.log(`[assistant] ${chunks.join('')}`)
      break
    }
    case 'chat.error':
      pending.delete(message.id)
      console.log(`[error] ${message.message}`)
      break
  }
}

function writeAll (message) {
  const frame = encodeFrame(message)
  for (const peer of swarm.connections) peer.write(frame)
}

function shortKey (key) {
  return b4a.toString(key, 'hex').slice(0, 6)
}

function readFlag (args, flag) {
  const index = args.indexOf(flag)
  if (index === -1) return null
  const value = args[index + 1]
  return value && !value.startsWith('--') ? value : null
}
