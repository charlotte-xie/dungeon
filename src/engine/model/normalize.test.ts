import { describe, expect, it } from 'vitest'
import { normalizeOpenAIChatCompletion } from './normalize'

const allowed = new Set(['future_plot_plan', 'update_memory'])

function response(message: Record<string, unknown>) {
  return {
    choices: [{ finish_reason: 'stop', message }],
    usage: { completion_tokens_details: { reasoning_tokens: 12 } },
  }
}

describe('OpenAI-compatible response normalization', () => {
  it('normalizes native tool calls', () => {
    const result = normalizeOpenAIChatCompletion(
      response({
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'future_plot_plan',
              arguments: '{"op":"append","text":"A bell will ring."}',
            },
          },
        ],
      }),
      allowed,
    )

    expect(result.toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'future_plot_plan',
        arguments: '{"op":"append","text":"A bell will ring."}',
      },
    ])
    expect(result.reasoningTokens).toBe(12)
  })

  it('recovers Grok-style fenced calls and removes leaked thinking markers', () => {
    const result = normalizeOpenAIChatCompletion(
      response({
        content:
          '```html\n<!--thinking-->\n```\n' +
          '```json\n' +
          '{"name":"future_plot_plan","parameters":{"op":"append","text":"The watch closes in."}}\n' +
          '```',
      }),
      allowed,
    )

    expect(result.text).toBe('')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('future_plot_plan')
    expect(JSON.parse(result.toolCalls[0].arguments)).toEqual({
      op: 'append',
      text: 'The watch closes in.',
    })
    expect(result.anomalies.map((entry) => entry.kind)).toContain('reasoning_in_content')
    expect(result.anomalies.map((entry) => entry.kind)).toContain('recovered_tool_call')
  })

  it('recovers legacy XML calls without exposing protocol text', () => {
    const result = normalizeOpenAIChatCompletion(
      response({
        content:
          'Narrative. <function_call name="update_memory">' +
          '{"set":{"bell":"The bell warned the watch."}}' +
          '</function_call>',
      }),
      allowed,
    )

    expect(result.text).toBe('Narrative.')
    expect(result.toolCalls[0].name).toBe('update_memory')
  })

  it('quarantines calls to tools that were not advertised', () => {
    const result = normalizeOpenAIChatCompletion(
      response({
        content: '{"name":"erase_everything","parameters":{}}',
        tool_calls: [
          {
            id: 'bad-call',
            function: { name: 'erase_everything', arguments: '{}' },
          },
        ],
      }),
      allowed,
    )

    expect(result.text).toBe('')
    expect(result.toolCalls).toEqual([])
    expect(result.anomalies.every((entry) => entry.kind === 'unadvertised_tool_call')).toBe(true)
  })

  it('deduplicates a leaked text copy of a native call', () => {
    const args = '{"op":"delete","position":1}'
    const result = normalizeOpenAIChatCompletion(
      response({
        content: `\`\`\`json\n{"name":"future_plot_plan","parameters":${args}}\n\`\`\``,
        tool_calls: [
          {
            id: 'call-1',
            function: { name: 'future_plot_plan', arguments: args },
          },
        ],
      }),
      allowed,
    )

    expect(result.toolCalls).toHaveLength(1)
    expect(result.anomalies.map((entry) => entry.kind)).toContain('duplicate_tool_call')
  })
})
