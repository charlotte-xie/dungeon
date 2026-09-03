import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compactCascade, memoryForCompaction } from './chronicle'
import { runSummarizer } from './agents/summarizer'
import type { Turn } from './types'

vi.mock('./agents/summarizer', () => ({
  runSummarizer: vi.fn(async (input: { inputs: string[] }) => ({
    summary: `SUMMARY[${input.inputs.join('|')}]`,
  })),
}))

const mockedSummarizer = vi.mocked(runSummarizer)

const AGENT = {
  model: 'test',
  apiKey: 'k',
  baseUrl: 'http://x',
  protocol: 'chat-completions' as const,
  memory: {},
}

function completedTurn(i: number): Turn {
  return {
    id: `t${i}`,
    kind: 'player',
    input: `p${i}`,
    reply: { id: `t${i}-reply`, model: 'test', text: `d${i}` },
  }
}

describe('compaction context', () => {
  it('omits persistent memory when the feature is disabled', () => {
    const memory = { hidden_fact: { is: 'The duke is the masked patron.' } }

    expect(memoryForCompaction(memory, false)).toEqual({})
    expect(memoryForCompaction(memory, true)).toBe(memory)
  })
})

describe('compactCascade drain events', () => {
  beforeEach(() => {
    mockedSummarizer.mockClear()
  })

  it('drains the live tail from the threshold down to the floor in one event', async () => {
    const turns = Array.from({ length: 32 }, (_, i) => completedTurn(i))
    const result = await compactCascade(
      turns,
      0,
      [],
      { compactionThreshold: 32, compactionFloor: 16, compactionBatch: 4 },
      AGENT,
      new AbortController().signal,
    )
    // 16 turns folded as 4 sub-batches of 4; 16 remain live.
    expect(result.cutoff).toBe(16)
    expect(result.chronicle).toHaveLength(1)
    expect(result.chronicle[0]).toHaveLength(4)
    expect(mockedSummarizer).toHaveBeenCalledTimes(4)
    // Entries preserve story order and each covers its own sub-batch.
    expect(result.chronicle[0][0].text).toContain('PLAYER: p0')
    expect(result.chronicle[0][3].text).toContain('PLAYER: p12')
    for (const entry of result.chronicle[0]) expect(entry.turnsCovered).toBe(4)
  })

  it('does nothing below the high watermark', async () => {
    const turns = Array.from({ length: 31 }, (_, i) => completedTurn(i))
    const result = await compactCascade(
      turns,
      0,
      [],
      { compactionThreshold: 32, compactionFloor: 16, compactionBatch: 4 },
      AGENT,
      new AbortController().signal,
    )
    expect(result.cutoff).toBe(0)
    expect(result.chronicle).toEqual([])
    expect(mockedSummarizer).not.toHaveBeenCalled()
  })

  it('clamps the floor for legacy configs whose threshold predates it', async () => {
    // Stored threshold 8 with the new default floor 16: floor clamps to
    // N - M = 4, reproducing the old fold-one-batch behavior.
    const turns = Array.from({ length: 8 }, (_, i) => completedTurn(i))
    const result = await compactCascade(
      turns,
      0,
      [],
      { compactionThreshold: 8, compactionFloor: 16, compactionBatch: 4 },
      AGENT,
      new AbortController().signal,
    )
    expect(result.cutoff).toBe(4)
    expect(result.chronicle[0]).toHaveLength(1)
    expect(mockedSummarizer).toHaveBeenCalledTimes(1)
  })
})

describe('failed turns', () => {
  const failedTurn = (i: number): Turn => ({
    id: `f${i}`,
    kind: 'player',
    input: `p${i}`,
    reply: {
      id: `f${i}-reply`,
      model: 'test',
      text: '(The dungeon master falters: boom)',
      error: 'boom',
    },
  })
  // Threshold 8, batch 4: the floor clamps to 4, so one event folds turns 0-3.
  const SETTINGS = { compactionThreshold: 8, compactionFloor: 4, compactionBatch: 4 }

  it('folds only the turns that produced narration', async () => {
    mockedSummarizer.mockClear()
    const turns = [
      completedTurn(0),
      failedTurn(1),
      completedTurn(2),
      completedTurn(3),
      ...Array.from({ length: 4 }, (_, i) => completedTurn(4 + i)),
    ]
    const result = await compactCascade(turns, 0, [], SETTINGS, AGENT, new AbortController().signal)
    expect(result.cutoff).toBe(4)
    expect(result.chronicle[0]).toHaveLength(1)
    expect(result.chronicle[0][0].text).not.toContain('falters')
    expect(result.chronicle[0][0].text).toContain('PLAYER: p2')
  })

  it('makes no entry — and no summarizer call — for a sub-batch of nothing but failures', async () => {
    mockedSummarizer.mockClear()
    const turns = [
      ...Array.from({ length: 4 }, (_, i) => failedTurn(i)),
      ...Array.from({ length: 4 }, (_, i) => completedTurn(4 + i)),
    ]
    const result = await compactCascade(turns, 0, [], SETTINGS, AGENT, new AbortController().signal)
    expect(result.cutoff).toBe(4)
    expect(result.chronicle).toEqual([])
    expect(mockedSummarizer).not.toHaveBeenCalled()
  })
})
