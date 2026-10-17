import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  completeOpenAICompatibleChat,
  completeOpenAICompatibleResponses,
  rejectsReasoning,
  rejectsTemperature,
  toResponsesInput,
} from './openaiCompatible'
import type { ModelMessage } from './types'

afterEach(() => vi.unstubAllGlobals())

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
