import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeModel } from '../model/client'
import type { ModelCompletion } from '../model/types'
import { runSummarizer, type SummarizerInput } from './summarizer'

vi.mock('../model/client', () => ({ completeModel: vi.fn() }))
const mockedModel = vi.mocked(completeModel)

const completion: ModelCompletion = {
  text: 'The priest gave you the sealed ledger.',
  reasoning: [],
  toolCalls: [],
  anomalies: [],
  finishReason: 'stop',
  raw: {},
}

const INPUT: SummarizerInput = {
  model: 'test-model',
  apiKey: 'k',
  baseUrl: 'http://x',
  protocol: 'chat-completions',
  scenario: '',
  previousSummary: '',
  turns: [{ number: 1, text: 'DM: Rain falls.' }],
  maxChars: 400,
}

describe('summariser input', () => {
  beforeEach(() => {
    mockedModel.mockReset()
    mockedModel.mockResolvedValue(completion)
  })

  it('sends the scenario, then the summary so far, before the turns', async () => {
    const result = await runSummarizer(
      {
        ...INPUT,
        scenario: 'You are a travelling cooper in a flooded country.',
        previousSummary: 'You reached the village, and Father Aldo took you in.',
      },
      new AbortController().signal,
    )
    expect(result.summary).toBe(completion.text)
    const content = mockedModel.mock.calls[0][0].messages[1].content
    const order = [
      'You are a travelling cooper in a flooded country.',
      'You reached the village, and Father Aldo took you in.',
      'DM: Rain falls.',
    ].map((part) =>
      content.indexOf(part),
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('sends every turn with its number from the log', async () => {
    await runSummarizer(
      {
        ...INPUT,
        turns: [
          { number: 17, text: 'DM: Rain falls.' },
          { number: 18, text: 'DM: The river rises.' },
        ],
      },
      new AbortController().signal,
    )
    const content = mockedModel.mock.calls[0][0].messages[1].content
    for (const part of ['17', 'DM: Rain falls.', '18', 'DM: The river rises.']) expect(content).toContain(part)
  })
})
