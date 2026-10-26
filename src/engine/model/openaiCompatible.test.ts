import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completeOpenAICompatibleChat,
  completeOpenAICompatibleResponses,
  rejectsCacheKey,
  rejectsReasoning,
  rejectsStreamOptions,
  rejectsStreaming,
  rejectsTemperature,
  rejectsToolChoice,
  toResponsesInput,
} from './openaiCompatible'
import type { ModelMessage, ModelStreamEvent } from './types'

afterEach(() => vi.unstubAllGlobals())

function sseResponse(events: unknown[], done = false): Response {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '')
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('streaming', () => {
  const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, n: number) => JSON.parse(fetchMock.mock.calls[n][1].body)

  it('streams a Responses request only when asked, and returns the same completion', async () => {
    const final = {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'The door opens.' }] }],
      usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 4 } },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse([
        { type: 'response.output_text.delta', delta: 'The door opens.' },
        { type: 'response.completed', response: final },
      ]))
      .mockResolvedValueOnce(new Response(JSON.stringify(final), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const seen: ModelStreamEvent[] = []
    const connection = { baseUrl: 'https://api.x.ai/v1', apiKey: 'test' }
    const streamed = await completeOpenAICompatibleResponses(
      { model: 'grok-4.3', messages: [], onStream: (e) => seen.push(e) },
      connection,
      new AbortController().signal,
    )
    const plain = await completeOpenAICompatibleResponses({ model: 'grok-4.3', messages: [] }, connection, new AbortController().signal)
    expect(bodyOf(fetchMock, 0)).toMatchObject({ stream: true })
    expect(bodyOf(fetchMock, 1)).toMatchObject({ stream: false })
    expect(seen).toEqual([{ kind: 'text', delta: 'The door opens.' }])
    expect(streamed).toMatchObject({ text: 'The door opens.', promptTokens: 10, cachedTokens: 4 })
    expect(plain).toMatchObject({ text: streamed.text, cachedTokens: streamed.cachedTokens })
  })

  it('streams Chat Completions with usage, and keeps only advertised tool calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'steer', arguments: '{}' } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'delete_world', arguments: '{}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 12, prompt_tokens_details: { cached_tokens: 8 } } },
    ], true))
    vi.stubGlobal('fetch', fetchMock)
    const completion = await completeOpenAICompatibleChat(
      {
        model: 'stream-chat',
        messages: [],
        tools: [{ name: 'steer', description: 'Steer.', parameters: {} }],
        onStream: () => undefined,
      },
      { baseUrl: 'http://localhost:4400/v1', apiKey: '' },
      new AbortController().signal,
    )
    expect(bodyOf(fetchMock, 0)).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    expect(completion.toolCalls.map((c) => c.name)).toEqual(['steer'])
    expect(completion.anomalies.map((a) => a.kind)).toEqual(['unadvertised_tool_call'])
    expect(completion).toMatchObject({ finishReason: 'tool_calls', promptTokens: 12, cachedTokens: 8 })
  })

  it('reads a single JSON reply from a provider that ignores the stream flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const seen: ModelStreamEvent[] = []
    const completion = await completeOpenAICompatibleChat(
      { model: 'ignores-stream', messages: [], onStream: (e) => seen.push(e) },
      { baseUrl: 'http://localhost:4401/v1', apiKey: '' },
      new AbortController().signal,
    )
    expect(completion.text).toBe('Done.')
    expect(seen).toEqual([])
  })

  it('drops stream options, then streaming, when the provider rejects them, and remembers', async () => {
    const reply = () => new Response(JSON.stringify({ choices: [{ message: { content: 'Done.' } }] }), { status: 200 })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"Unrecognized request argument supplied: stream_options"}}', { status: 400 }))
      .mockResolvedValueOnce(new Response('{"error":{"message":"stream is not supported for this model"}}', { status: 400 }))
      .mockImplementation(async () => reply())
    vi.stubGlobal('fetch', fetchMock)
    const request = { model: 'no-stream', messages: [], onStream: () => undefined }
    const connection = { baseUrl: 'http://localhost:4402/v1', apiKey: '' }
    const first = await completeOpenAICompatibleChat(request, connection, new AbortController().signal)
    await completeOpenAICompatibleChat(request, connection, new AbortController().signal)
    expect(first.text).toBe('Done.')
    expect(bodyOf(fetchMock, 1)).toMatchObject({ stream: true })
    expect(bodyOf(fetchMock, 1)).not.toHaveProperty('stream_options')
    expect(bodyOf(fetchMock, 2)).not.toHaveProperty('stream')
    expect(bodyOf(fetchMock, 3)).toMatchObject({ stream: false })
    expect(bodyOf(fetchMock, 3)).not.toHaveProperty('stream_options')
  })

  it('tells a rejection of stream options from a rejection of streaming', () => {
    const options = '{"error":{"message":"Unrecognized request argument supplied: stream_options"}}'
    const streaming = '{"error":{"message":"\\"stream\\" is not supported"}}'
    expect(rejectsStreamOptions(400, options)).toBe(true)
    expect(rejectsStreaming(400, options)).toBe(false)
    expect(rejectsStreaming(400, streaming)).toBe(true)
    expect(rejectsStreaming(401, streaming)).toBe(false)
  })
})

describe('reasoning settings on the wire', () => {
  it.each(['low', 'none'] as const)('sends Responses reasoning effort %s', async (effort) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await completeOpenAICompatibleResponses(
      { model: effort === 'none' ? 'grok-4.3' : 'grok-4.7', messages: [], reasoningEffort: effort },
      { baseUrl: 'https://api.x.ai/v1', apiKey: 'test' },
      new AbortController().signal,
    )
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.x.ai/v1/responses')
    expect(JSON.parse(init.body)).toMatchObject({ reasoning: { effort }, store: false })
    expect(JSON.parse(init.body)).not.toHaveProperty('reasoning_effort')
  })

  it('uses the Chat Completions field and omits provider-default effort', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    for (const reasoningEffort of ['low', 'default'] as const) {
      await completeOpenAICompatibleChat(
        { model: 'grok-4.3', messages: [], reasoningEffort },
        { baseUrl: 'https://api.x.ai/v1', apiKey: 'test' },
        new AbortController().signal,
      )
    }
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ reasoning_effort: 'low' })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('reasoning_effort')
  })

  it('omits Responses reasoning when provider default is selected', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await completeOpenAICompatibleResponses(
      { model: 'custom', messages: [], reasoningEffort: 'default' },
      { baseUrl: 'http://localhost:1234/v1', apiKey: '' },
      new AbortController().signal,
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('reasoning')
  })
})

describe('OpenAI-compatible capability fallback', () => {
  it('recognises a provider rejection of temperature', () => {
    expect(
      rejectsTemperature(
        400,
        `{"error":{"message":"Unsupported parameter: 'temperature' is not supported with this model."}}`,
      ),
    ).toBe(true)
  })

  it('does not reinterpret unrelated request failures', () => {
    expect(rejectsTemperature(401, 'invalid API key')).toBe(false)
    expect(rejectsTemperature(400, 'messages must not be empty')).toBe(false)
    expect(rejectsReasoning(401, 'invalid API key')).toBe(false)
    expect(rejectsReasoning(400, 'messages must not be empty')).toBe(false)
  })

  it.each([
    `{"error":{"message":"Unrecognized request argument supplied: reasoning_effort"}}`,
    `{"detail":[{"type":"extra_forbidden","loc":["body","reasoning_effort"],"msg":"Extra inputs are not permitted"}]}`,
    `{"error":{"message":"This model does not support reasoning.effort"}}`,
  ])('recognises a provider rejection of reasoning: %s', (body) => {
    expect(rejectsReasoning(400, body)).toBe(true)
  })

  const completed = (text: string) => new Response(JSON.stringify({
    choices: [{ message: { content: text }, finish_reason: 'stop' }],
  }), { status: 200 })
  const rejected = (message: string) => new Response(JSON.stringify({ error: { message } }), { status: 400 })

  it('retries without rejected reasoning, remembers it, and notes it on each call', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rejected('Unrecognized request argument supplied: reasoning_effort'))
      .mockResolvedValueOnce(completed('First.'))
      .mockResolvedValueOnce(completed('Second.'))
    vi.stubGlobal('fetch', fetchMock)
    const request = { model: 'no-reasoning-chat', messages: [], reasoningEffort: 'low' as const }
    const connection = { baseUrl: 'http://localhost:1234/v1', apiKey: '' }

    const first = await completeOpenAICompatibleChat(request, connection, new AbortController().signal)
    expect(first.text).toBe('First.')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveProperty('reasoning_effort', 'low')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('reasoning_effort')
    expect(first.anomalies).toContainEqual(expect.objectContaining({ kind: 'unsupported_reasoning' }))

    const second = await completeOpenAICompatibleChat(request, connection, new AbortController().signal)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).not.toHaveProperty('reasoning_effort')
    expect(second.anomalies).toContainEqual(expect.objectContaining({ kind: 'unsupported_reasoning' }))
  })

  it('drops temperature and then reasoning when a Responses provider rejects both', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rejected("Unsupported parameter: 'temperature' is not supported with this model."))
      .mockResolvedValueOnce(rejected('Unsupported parameter: reasoning.effort'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }],
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await completeOpenAICompatibleResponses(
      { model: 'strict-responses', messages: [], reasoningEffort: 'high', temperature: 0.8 },
      { baseUrl: 'http://localhost:1234/v1', apiKey: '' },
      new AbortController().signal,
    )
    expect(result.text).toBe('Done.')
    const finalBody = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(finalBody).not.toHaveProperty('temperature')
    expect(finalBody).not.toHaveProperty('reasoning')
    expect(result.anomalies).toContainEqual(expect.objectContaining({ kind: 'unsupported_reasoning' }))
  })

  it('still fails on a rejection it cannot repair', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(rejected('model not found')))
    await expect(completeOpenAICompatibleChat(
      { model: 'missing-model', messages: [], reasoningEffort: 'low' },
      { baseUrl: 'http://localhost:1234/v1', apiKey: '' },
      new AbortController().signal,
    )).rejects.toThrow('model API 400')
  })
})

describe('prompt-cache key', () => {
  const chatReply = () => new Response(JSON.stringify({
    choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }],
  }), { status: 200 })

  it('sends the key in the Responses body, and nothing without one', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ output: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await completeOpenAICompatibleResponses(
      { model: 'grok-4.7', messages: [] },
      { baseUrl: 'https://api.x.ai/v1', apiKey: 'test', cacheKey: 'adventure-1' },
      new AbortController().signal,
    )
    await completeOpenAICompatibleResponses(
      { model: 'grok-4.7', messages: [] },
      { baseUrl: 'https://api.x.ai/v1', apiKey: 'test' },
      new AbortController().signal,
    )
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveProperty('prompt_cache_key', 'adventure-1')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('prompt_cache_key')
  })

  it('adds the routing header for xAI only, on both APIs', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url.endsWith('/responses') ? new Response(JSON.stringify({ output: [] }), { status: 200 }) : chatReply())
    vi.stubGlobal('fetch', fetchMock)
    for (const complete of [completeOpenAICompatibleChat, completeOpenAICompatibleResponses]) {
      for (const baseUrl of ['https://api.x.ai/v1', 'https://api.mistral.ai/v1']) {
        await complete(
          { model: 'some-model', messages: [] },
          { baseUrl, apiKey: 'test', cacheKey: 'adventure-1' },
          new AbortController().signal,
        )
      }
    }
    const [chatXai, chatOther, responsesXai, responsesOther] = fetchMock.mock.calls.map((call) => call[1])
    expect(chatXai.headers).toHaveProperty('x-grok-conv-id', 'adventure-1')
    expect(responsesXai.headers).toHaveProperty('x-grok-conv-id', 'adventure-1')
    expect(chatOther.headers).not.toHaveProperty('x-grok-conv-id')
    expect(responsesOther.headers).not.toHaveProperty('x-grok-conv-id')
    expect(JSON.parse(chatOther.body)).toHaveProperty('prompt_cache_key', 'adventure-1')
  })

  it.each([
    [400, `{"error":{"message":"Unrecognized request argument supplied: prompt_cache_key"}}`],
    [422, `{"detail":[{"type":"extra_forbidden","loc":["body","prompt_cache_key"],"msg":"Extra inputs are not permitted"}]}`],
  ])('recognises a provider rejection of the key: %s', (status, body) => {
    expect(rejectsCacheKey(status, body)).toBe(true)
  })

  it('does not mistake other failures for a rejected key', () => {
    expect(rejectsCacheKey(401, 'invalid API key')).toBe(false)
    expect(rejectsCacheKey(422, '{"detail":"messages must not be empty"}')).toBe(false)
  })

  it('recognises a provider rejection of the tool choice', () => {
    expect(rejectsToolChoice(400, '{"error":{"message":"Invalid value for tool_choice: required"}}')).toBe(true)
    expect(rejectsToolChoice(400, '{"error":{"message":"Invalid value for temperature"}}')).toBe(false)
  })

  it('retries without a rejected key and stops sending it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ detail: [{ type: 'extra_forbidden', loc: ['body', 'prompt_cache_key'], msg: 'Extra inputs are not permitted' }] }),
        { status: 422 },
      ))
      .mockImplementation(async () => chatReply())
    vi.stubGlobal('fetch', fetchMock)
    const request = { model: 'strict-chat', messages: [] }
    const connection = { baseUrl: 'http://localhost:4321/v1', apiKey: '', cacheKey: 'adventure-1' }
    const first = await completeOpenAICompatibleChat(request, connection, new AbortController().signal)
    await completeOpenAICompatibleChat(request, connection, new AbortController().signal)
    expect(first.text).toBe('Done.')
    expect(first.anomalies).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('prompt_cache_key')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).not.toHaveProperty('prompt_cache_key')
  })
})

describe('Responses API input mapping', () => {
  it('maps the conversation onto typed input items', () => {
    const messages: ModelMessage[] = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: 'I knock.' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'ctx-check-memory', name: 'check_memory', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: 'ctx-check-memory', content: '(no memory yet)' },
      { role: 'assistant', content: 'The door creaks open.' },
    ]
    expect(toResponsesInput(messages)).toEqual([
      { role: 'system', content: [{ type: 'input_text', text: 'rules' }] },
      { role: 'user', content: [{ type: 'input_text', text: 'I knock.' }] },
      {
        type: 'function_call',
        call_id: 'ctx-check-memory',
        name: 'check_memory',
        arguments: '{}',
      },
      { type: 'function_call_output', call_id: 'ctx-check-memory', output: '(no memory yet)' },
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'The door creaks open.' }],
      },
    ])
  })

  it('emits both the message and its calls when an assistant turn has prose and tools', () => {
    const items = toResponsesInput([
      {
        role: 'assistant',
        content: 'Noted.',
        toolCalls: [{ id: 'c1', name: 'update_memory', arguments: '{"set":{"a":"b"}}' }],
      },
    ])
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ role: 'assistant' })
    expect(items[1]).toMatchObject({ type: 'function_call', call_id: 'c1' })
  })
})
