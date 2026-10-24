import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeModel } from '../model/client'
import type { ModelCompletion } from '../model/types'
import { runSummarizer } from './summarizer'

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

describe('summariser grounding', () => {
  beforeEach(() => {
    mockedModel.mockReset()
    mockedModel.mockResolvedValue(completion)
  })

  it('grounds the summary in the whole memory, as reference only', async () => {
    // The inputs name none of these entries; "the priest" only matches
    // Father Aldo with the whole memory in view.
    const memory = {
      'Father Aldo': { is: 'Father Aldo is the village priest.' },
      the_baker: { is: 'Hesta the baker', secret: 'hiding her son upstairs' },
      you: { is: 'You are new in town.' },
    }
    const result = await runSummarizer(
      {
        model: 'test-model',
        apiKey: 'k',
        baseUrl: 'http://x',
        protocol: 'chat-completions',
        memory,
        inputs: ['DM: The priest hands you the sealed ledger.'],
        targetChars: 400,
      },
      new AbortController().signal,
    )

    expect(result.summary).toBe(completion.text)
    const content = mockedModel.mock.calls[0][0].messages[1].content
    expect(content).toContain('grounding only')
    expect(content).toContain(JSON.stringify(memory, null, 2))
  })

  it('leaves the canon out when memory is empty', async () => {
    await runSummarizer(
      {
        model: 'test-model',
        apiKey: 'k',
        baseUrl: 'http://x',
        protocol: 'chat-completions',
        memory: {},
        inputs: ['DM: Rain falls.'],
        targetChars: 400,
      },
      new AbortController().signal,
    )
    expect(mockedModel.mock.calls[0][0].messages[1].content).not.toContain('CANON')
  })
})
