import { describe, expect, it } from 'vitest'
import { readChatStream, readResponsesStream, sseEvents } from './stream'
import type { ModelStreamEvent } from './types'

const encoder = new TextEncoder()

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function sseResponse(chunks: string[]): Response {
  return new Response(streamOf(chunks), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

const responsesEvent = (data: Record<string, unknown>) => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`
const chatChunk = (data: Record<string, unknown>) => `data: ${JSON.stringify(data)}\n\n`

describe('server-sent events', () => {
  it('splits events across chunks and line endings, and keeps an unterminated last event', async () => {
    const events = []
    for await (const event of sseEvents(
      streamOf(['event: a\r\nda', 'ta: {"x":1}\r\n\r\n: a comment\n', 'data: one\ndata: two\n\ndata: last']),
    )) {
      events.push(event)
    }
    expect(events).toEqual([
      { event: 'a', data: '{"x":1}' },
      { event: undefined, data: 'one\ntwo' },
      { event: undefined, data: 'last' },
    ])
  })
})

describe('a streamed Responses reply', () => {
  const final = {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'The door opens.' }] }],
    usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 4 } },
  }

  it('reports thinking, calls and text as they come, and returns the whole response', async () => {
    const seen: ModelStreamEvent[] = []
    const raw = await readResponsesStream(
      sseResponse([
        responsesEvent({ type: 'response.created' }),
        responsesEvent({ type: 'response.reasoning_summary_text.delta', delta: 'Weigh the door.' }),
        responsesEvent({ type: 'response.output_item.added', item: { type: 'function_call', name: 'steer' } }),
        responsesEvent({ type: 'response.output_text.delta', delta: 'The door' }),
        responsesEvent({ type: 'response.output_text.delta', delta: ' opens.' }),
        responsesEvent({ type: 'response.completed', response: final }),
      ]),
      (event) => seen.push(event),
    )
    expect(seen).toEqual([
      { kind: 'reasoning', delta: 'Weigh the door.' },
      { kind: 'call', name: 'steer' },
      { kind: 'text', delta: 'The door' },
      { kind: 'text', delta: ' opens.' },
    ])
    expect(raw).toEqual(final)
  })

  it('fails on an error event, and on a stream that ends before the response', async () => {
    await expect(readResponsesStream(sseResponse([responsesEvent({ type: 'error', message: 'overloaded' })])))
      .rejects.toThrow('overloaded')
    await expect(readResponsesStream(sseResponse([responsesEvent({ type: 'response.created' })])))
      .rejects.toThrow('ended before')
  })

  it('finishes the request when a listener fails', async () => {
    const raw = await readResponsesStream(
      sseResponse([
        responsesEvent({ type: 'response.output_text.delta', delta: 'The door' }),
        responsesEvent({ type: 'response.completed', response: final }),
      ]),
      () => {
        throw new Error('display broke')
      },
    )
    expect(raw).toEqual(final)
  })
})

describe('a streamed Chat Completions reply', () => {
  it('puts the message back together from its chunks', async () => {
    const seen: ModelStreamEvent[] = []
    const raw = await readChatStream(
      sseResponse([
        chatChunk({ choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Hmm.' } }] }),
        chatChunk({ choices: [{ index: 0, delta: { content: 'The door' } }] }),
        chatChunk({
          choices: [{
            index: 0,
            delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'steer', arguments: '{"te' } }] },
          }],
        }),
        chatChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: 'xt":"On."}' } }] } }] }),
        chatChunk({ choices: [{ index: 0, delta: { content: ' opens.' }, finish_reason: 'tool_calls' }] }),
        chatChunk({ choices: [], usage: { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 4 } } }),
        'data: [DONE]\n\n',
      ]),
      (event) => seen.push(event),
    )
    expect(seen).toEqual([
      { kind: 'reasoning', delta: 'Hmm.' },
      { kind: 'text', delta: 'The door' },
      { kind: 'call', name: 'steer' },
      { kind: 'text', delta: ' opens.' },
    ])
    expect(raw).toEqual({
      choices: [{
        message: {
          role: 'assistant',
          content: 'The door opens.',
          reasoning_content: 'Hmm.',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'steer', arguments: '{"text":"On."}' } }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 4 } },
    })
  })

  it('fails on an error chunk', async () => {
    await expect(readChatStream(sseResponse([chatChunk({ error: { message: 'rate limited' } })])))
      .rejects.toThrow('rate limited')
  })
})
