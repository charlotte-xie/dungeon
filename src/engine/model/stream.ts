// Streamed completions from OpenAI-compatible endpoints. A stream is read as
// it arrives, its pieces are reported to the caller, and it is put back
// together into the same response a non-streamed request returns, so the
// normalisers see no difference.

import type { ModelStreamEvent } from './types'

export interface ServerSentEvent {
  event?: string
  data: string
}

type StreamListener = (event: ModelStreamEvent) => void

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isEventStream(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('text/event-stream')
}

// Splits a server-sent event stream into its events. Lines end in \n or \r\n,
// an event ends at a blank line, and a stream that ends without one still
// yields its last event.
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<ServerSentEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event: string | undefined
  let data: string[] = []
  const take = (): ServerSentEvent | null => {
    const taken = data.length ? { event, data: data.join('\n') } : null
    event = undefined
    data = []
    return taken
  }
  try {
    for (;;) {
      const { value, done } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r?\n/)
      buffer = done ? '' : (lines.pop() ?? '')
      for (const line of lines) {
        if (line === '') {
          const taken = take()
          if (taken) yield taken
          continue
        }
        if (line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon < 0 ? line : line.slice(0, colon)
        const fieldValue = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = fieldValue
        else if (field === 'data') data.push(fieldValue)
      }
      if (done) break
    }
    const last = take()
    if (last) yield last
  } finally {
    // Frees the connection when reading stops early; a no-op once it has ended.
    void reader.cancel().catch(() => undefined)
  }
}

function parseData(data: string): unknown {
  try {
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

// Live updates are only for display: a listener that fails doesn't sink the
// request.
function reporter(onStream?: StreamListener): StreamListener {
  return (event) => {
    try {
      onStream?.(event)
    } catch (err) {
      console.warn('[model] stream listener failed', err)
    }
  }
}

function streamErrorMessage(value: unknown): string {
  if (isRecord(value)) {
    if (isRecord(value.error) && typeof value.error.message === 'string') return value.error.message
    if (typeof value.message === 'string') return value.message
  }
  return JSON.stringify(value ?? null).slice(0, 200)
}

// The Responses API streams typed events and ends with the whole response,
// which is returned as a non-streamed request would return it.
export async function readResponsesStream(response: Response, onStream?: StreamListener): Promise<unknown> {
  if (!response.body) throw new Error('Empty response from model (no stream)')
  const report = reporter(onStream)
  for await (const message of sseEvents(response.body)) {
    const data = parseData(message.data)
    if (!isRecord(data)) continue
    const type = typeof data.type === 'string' ? data.type : message.event
    switch (type) {
      case 'response.output_text.delta':
        if (typeof data.delta === 'string') report({ kind: 'text', delta: data.delta })
        break
      case 'response.reasoning_summary_text.delta':
      case 'response.reasoning_text.delta':
        if (typeof data.delta === 'string') report({ kind: 'reasoning', delta: data.delta })
        break
      case 'response.output_item.added':
        if (isRecord(data.item) && data.item.type === 'function_call' && typeof data.item.name === 'string') {
          report({ kind: 'call', name: data.item.name })
        }
        break
      case 'response.completed':
      case 'response.incomplete':
        return data.response
      case 'response.failed':
        throw new Error(`Model stream failed: ${streamErrorMessage(data.response)}`)
      case 'error':
        throw new Error(`Model stream error: ${streamErrorMessage(data)}`)
    }
  }
  throw new Error('Model stream ended before the response was complete')
}

// Chat Completions streams the message in chunks, put back together here into
// the response a non-streamed request returns. Usage arrives in a last chunk
// when asked for with stream_options.
export async function readChatStream(response: Response, onStream?: StreamListener): Promise<unknown> {
  if (!response.body) throw new Error('Empty response from model (no stream)')
  const report = reporter(onStream)
  let content = ''
  let reasoning = ''
  let finishReason: string | null = null
  let usage: Record<string, unknown> | undefined
  const calls: { id: string; name: string; arguments: string }[] = []
  for await (const message of sseEvents(response.body)) {
    if (message.data.trim() === '[DONE]') break
    const chunk = parseData(message.data)
    if (!isRecord(chunk)) continue
    if (isRecord(chunk.error)) throw new Error(`Model stream error: ${streamErrorMessage(chunk)}`)
    if (isRecord(chunk.usage)) usage = chunk.usage
    const choice = Array.isArray(chunk.choices) && isRecord(chunk.choices[0]) ? chunk.choices[0] : undefined
    if (!choice) continue
    if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
    const delta = isRecord(choice.delta) ? choice.delta : {}
    if (typeof delta.content === 'string' && delta.content) {
      content += delta.content
      report({ kind: 'text', delta: delta.content })
    }
    const thought =
      typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string'
          ? delta.reasoning
          : ''
    if (thought) {
      reasoning += thought
      report({ kind: 'reasoning', delta: thought })
    }
    for (const part of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      if (!isRecord(part)) continue
      const index = typeof part.index === 'number' ? part.index : calls.length
      const call = (calls[index] ??= { id: '', name: '', arguments: '' })
      if (typeof part.id === 'string' && part.id) call.id = part.id
      const fn = isRecord(part.function) ? part.function : {}
      if (typeof fn.name === 'string' && fn.name && !call.name) {
        call.name = fn.name
        report({ kind: 'call', name: fn.name })
      }
      if (typeof fn.arguments === 'string') call.arguments += fn.arguments
    }
  }
  const toolCalls = calls
    .filter((call) => call !== undefined)
    .map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }))
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    ...(usage ? { usage } : {}),
  }
}
