import { describe, expect, it } from 'vitest'
import { normalizeOpenAIChatCompletion, normalizeResponsesApiResponse } from './normalize'

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

describe('Responses API normalization', () => {
  it('normalizes typed output items into text, reasoning, and tool calls', () => {
    const result = normalizeResponsesApiResponse(
      {
        status: 'completed',
        output: [
          {
            type: 'reasoning',
            summary: [{ type: 'summary_text', text: 'Consider the bell.' }],
          },
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'The bell tolls once.' }],
          },
          {
            type: 'function_call',
            call_id: 'call-9',
            name: 'update_memory',
            arguments: '{"set":{"bell":"An old bronze bell."}}',
          },
        ],
        usage: { output_tokens_details: { reasoning_tokens: 7 } },
      },
      allowed,
    )

    expect(result.text).toBe('The bell tolls once.')
    expect(result.reasoning).toEqual(['Consider the bell.'])
    expect(result.toolCalls).toEqual([
      {
        id: 'call-9',
        name: 'update_memory',
        arguments: '{"set":{"bell":"An old bronze bell."}}',
      },
    ])
    expect(result.finishReason).toBe('completed')
    expect(result.reasoningTokens).toBe(7)
  })

  it('quarantines unadvertised structured calls', () => {
    const result = normalizeResponsesApiResponse(
      {
        status: 'completed',
        output: [
          { type: 'function_call', call_id: 'x', name: 'erase_everything', arguments: '{}' },
        ],
      },
      allowed,
    )
    expect(result.toolCalls).toEqual([])
    expect(result.anomalies.every((entry) => entry.kind === 'unadvertised_tool_call')).toBe(true)
  })

  it('recovers text-form calls leaked into message text', () => {
    const result = normalizeResponsesApiResponse(
      {
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [
              {
                type: 'output_text',
                text: 'Narrative.\n```json\n{"name":"update_memory","parameters":{"set":{"a":"b"}}}\n```',
              },
            ],
          },
        ],
      },
      allowed,
    )
    expect(result.text).toBe('Narrative.')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0].name).toBe('update_memory')
  })

  it('surfaces the incomplete reason as the finish reason', () => {
    const result = normalizeResponsesApiResponse(
      {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
      },
      allowed,
    )
    expect(result.finishReason).toBe('max_output_tokens')
  })
})

describe('prompt usage', () => {
  it('surfaces prompt and cached token counts from Chat Completions', () => {
    const result = normalizeOpenAIChatCompletion(
      {
        choices: [{ finish_reason: 'stop', message: { content: 'Hi.' } }],
        usage: { prompt_tokens: 4000, prompt_tokens_details: { cached_tokens: 3840 } },
      },
      allowed,
    )
    expect(result.promptTokens).toBe(4000)
    expect(result.cachedTokens).toBe(3840)
  })

  it('distinguishes a reported cache miss from an unreported count', () => {
    const miss = normalizeOpenAIChatCompletion(
      {
        choices: [{ finish_reason: 'stop', message: { content: 'Hi.' } }],
        usage: { prompt_tokens: 900, prompt_tokens_details: { cached_tokens: 0 } },
      },
      allowed,
    )
    expect(miss.promptTokens).toBe(900)
    expect(miss.cachedTokens).toBe(0)

    const silent = normalizeOpenAIChatCompletion(response({ content: 'Hi.' }), allowed)
    expect(silent.promptTokens).toBeUndefined()
    expect(silent.cachedTokens).toBeUndefined()
  })

  it('surfaces prompt and cached token counts from the Responses API', () => {
    const result = normalizeResponsesApiResponse(
      {
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Hi.' }],
          },
        ],
        usage: { input_tokens: 5000, input_tokens_details: { cached_tokens: 4096 } },
      },
      allowed,
    )
    expect(result.promptTokens).toBe(5000)
    expect(result.cachedTokens).toBe(4096)
  })
})
