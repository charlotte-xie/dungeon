import { describe, expect, it } from 'vitest'
import { rejectsTemperature, toResponsesInput } from './openaiCompatible'
import type { ModelMessage } from './types'

describe('OpenAI-compatible capability fallback', () => {
  it('recognizes a provider rejection of temperature', () => {
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
