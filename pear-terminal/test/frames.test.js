import test from 'brittle'
import { decodeFrames, encodeFrame, parseCommand } from '../lib/frames.js'

test('encodes and decodes bridge frames', function (t) {
  const frame = encodeFrame({ type: 'chat.text', text: 'hello', from: 'test' })
  const result = decodeFrames(frame)

  t.is(result.remainder, '')
  t.alike(result.errors, [])
  t.alike(result.messages, [{ type: 'chat.text', text: 'hello', from: 'test' }])
})

test('keeps partial frame remainder', function (t) {
  const result = decodeFrames('{"type":"chat.text"')

  t.is(result.messages.length, 0)
  t.is(result.errors.length, 0)
  t.is(result.remainder, '{"type":"chat.text"')
})

test('parses terminal commands', function (t) {
  t.alike(parseCommand('/ask ping'), { type: 'ask', text: 'ping' })
  t.alike(parseCommand('/say hello'), { type: 'say', text: 'hello' })
  t.alike(parseCommand('hello'), { type: 'say', text: 'hello' })
  t.alike(parseCommand('/peers'), { type: 'peers' })
  t.alike(parseCommand(''), { type: 'empty' })
})
