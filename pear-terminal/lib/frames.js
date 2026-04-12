export function encodeFrame (message) {
  return `${JSON.stringify(message)}\n`
}

export function decodeFrames (chunk, previousRemainder = '') {
  const text = previousRemainder + chunk
  const lines = text.split('\n')
  const remainder = lines.pop() ?? ''
  const messages = []
  const errors = []

  for (const line of lines) {
    if (!line.trim()) continue

    try {
      const parsed = JSON.parse(line)
      if (isBridgeMessage(parsed)) messages.push(parsed)
      else errors.push({ line, error: new Error('Unknown bridge frame') })
    } catch (error) {
      errors.push({
        line,
        error: error instanceof Error ? error : new Error(String(error))
      })
    }
  }

  return { messages, errors, remainder }
}

export function isBridgeMessage (message) {
  if (!message || typeof message !== 'object') return false

  switch (message.type) {
    case 'hello':
      return typeof message.peerId === 'string'
    case 'chat.text':
      return typeof message.text === 'string'
    case 'chat.request':
      return typeof message.id === 'string' &&
        (typeof message.prompt === 'string' || Array.isArray(message.messages))
    case 'chat.delta':
      return typeof message.id === 'string' && typeof message.content === 'string'
    case 'chat.done':
      return typeof message.id === 'string'
    case 'chat.error':
      return typeof message.id === 'string' && typeof message.message === 'string'
    default:
      return false
  }
}

export function parseCommand (line) {
  const text = line.trim()
  if (!text) return { type: 'empty' }
  if (text === '/help') return { type: 'help' }
  if (text === '/peers') return { type: 'peers' }
  if (text.startsWith('/ask ')) return { type: 'ask', text: text.slice(5).trim() }
  if (text.startsWith('/say ')) return { type: 'say', text: text.slice(5).trim() }
  return { type: 'say', text }
}
