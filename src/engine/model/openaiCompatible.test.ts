import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeOpenAICompatibleChat, completeOpenAICompatibleResponses, rejectsTemperature, toResponsesInput } from './openaiCompatible'
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
