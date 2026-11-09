import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildChronicleSystemMessage,
  chronicleCutoff,
  chronicleNeedsCompaction,
  chronicleRanges,
  compactChronicle,
  entryTurnNumbers,
  indexChronicle,
  rebuildCallCount,
  rebuildChronicle,
  sameChronicle,
  withoutEntries,
  type ChronicleSettings,
  type LegacyChronicleEntry,
} from './chronicle'
import { runSummarizer, type SummaryTurn } from './agents/summarizer'
import type { Chronicle, ChronicleEntry, Turn } from './types'

vi.mock('./agents/summarizer', () => ({
  runSummarizer: vi.fn(async (input: { turns: SummaryTurn[] }) => ({
    summary: `SUMMARY[${input.turns.map((t) => `${t.number}:${t.text}`).join('|')}]`,
  })),
}))

const mockedSummarizer = vi.mocked(runSummarizer)

const AGENT = {
  model: 'test',
  apiKey: 'k',
  baseUrl: 'http://x',
  protocol: 'chat-completions' as const,
  scenario: 'A wagon, a winter, a secret.',
}

const DEFAULTS: ChronicleSettings = { compactionThreshold: 32, compactionFloor: 16, summaryTargetChars: 1500 }
const SMALL: ChronicleSettings = { compactionThreshold: 8, compactionFloor: 4, summaryTargetChars: 1500 }

function completedTurn(i: number): Turn {
  return {
    id: `t${i}`,
    kind: 'player',
    input: `p${i}`,
    reply: { id: `t${i}-reply`, model: 'test', text: `d${i}` },
  }
}

function completedTurns(count: number): Turn[] {
  return Array.from({ length: count }, (_, i) => completedTurn(i))
}

function entry(id: string, first: string, last: string): ChronicleEntry {
  return { id, text: id, firstTurnId: first, lastTurnId: last, createdAt: 1 }
}

function legacy(id: string, turnsCovered: number): LegacyChronicleEntry {
  return { id, text: id, turnsCovered, createdAt: 1 }
}

// Each entry's turns as indices, in story order.
function spans(chronicle: Chronicle, turns: Turn[]) {
  return chronicleRanges(chronicle, turns)?.map((r): [string, number, number] => [r.entry.id, r.start, r.end])
}

function turnRanges(chronicle: Chronicle, turns: Turn[]) {
  return spans(chronicle, turns)?.map(([, start, end]) => [start, end])
}

function compact(turns: Turn[], chronicle: Chronicle, settings = DEFAULTS) {
  return compactChronicle(turns, chronicle, settings, AGENT, new AbortController().signal)
}

const TEN = completedTurns(10)

// What each summariser call was given as the summary so far, in call order.
function summariesSeen() {
  return mockedSummarizer.mock.calls.map(([input]) => input.previousSummary)
}

// The log numbers of the turns a summariser call read.
function turnNumbersRead(call: number) {
  return mockedSummarizer.mock.calls[call][0].turns.map((t) => t.number)
}

describe('the chronicle as an index over the turns', () => {
  // Level 1 is older than level 0, so it comes first in story order.
  const chronicle: Chronicle = [
    [entry('b', 't4', 't5'), entry('c', 't6', 't6')],
    [entry('a', 't0', 't3')],
  ]

  it('reads the entries in story order, each with its turns', () => {
    expect(spans(chronicle, TEN)).toEqual([
      ['a', 0, 4],
      ['b', 4, 6],
      ['c', 6, 7],
    ])
    expect(chronicleCutoff(chronicle, TEN)).toBe(7)
    expect(entryTurnNumbers(chronicle, TEN).get('b')).toEqual({ first: 5, last: 6 })
  })

  it('knows a chronicle by its entries, not by which object holds them', () => {
    expect(sameChronicle(chronicle, chronicle)).toBe(true)
    expect(sameChronicle(chronicle, JSON.parse(JSON.stringify(chronicle)))).toBe(true)
    expect(sameChronicle(chronicle, withoutEntries(chronicle, new Set(['c'])))).toBe(false)
  })

  it('treats an empty chronicle as covering nothing', () => {
    expect(chronicleRanges([], TEN)).toEqual([])
    expect(chronicleCutoff([], TEN)).toBe(0)
  })

  it('rejects entries that leave a gap, overlap, or point at unknown turns', () => {
    const invalid: Chronicle[] = [
      [[entry('a', 't1', 't3')]],
      [[entry('a', 't0', 't3'), entry('b', 't5', 't6')]],
      [[entry('a', 't0', 't3'), entry('b', 't3', 't6')]],
      [[entry('a', 't0', 'gone')]],
      [[entry('a', 't3', 't0')]],
      // Story order puts the higher level first.
      [[entry('a', 't0', 't3')], [entry('b', 't4', 't6')]],
    ]
    for (const c of invalid) {
      expect(chronicleRanges(c, TEN)).toBeNull()
      expect(chronicleCutoff(c, TEN)).toBe(0)
    }
  })

  it('gives a dropped entry’s turns to the entry before it, or after it when it was first', () => {
    expect(spans(withoutEntries(chronicle, new Set(['b'])), TEN)).toEqual([
      ['a', 0, 6],
      ['c', 6, 7],
    ])
    expect(spans(withoutEntries(chronicle, new Set(['a'])), TEN)).toEqual([
      ['b', 0, 6],
      ['c', 6, 7],
    ])
    expect(spans(withoutEntries(chronicle, new Set(['a', 'b'])), TEN)).toEqual([['c', 0, 7]])
    expect(withoutEntries(chronicle, new Set(['a', 'b', 'c']))).toEqual([])
  })
})

describe('loading a stored chronicle', () => {
  it('keeps an indexed chronicle that fits the turns and drops one that does not', () => {
    const fits: Chronicle = [[entry('a', 't0', 't3')]]
    expect(indexChronicle(fits, TEN)).toBe(fits)
    expect(indexChronicle([[entry('a', 't0', 'gone')]], TEN)).toEqual([])
    expect(indexChronicle([[entry('a', 't0', 't3'), legacy('b', 2)]], TEN)).toEqual([])
  })

  it('lays legacy entries over the turns by their counts, in story order', () => {
    const indexed = indexChronicle([[legacy('b', 2), legacy('c', 1)], [legacy('a', 4)]], TEN, 7)
    expect(spans(indexed, TEN)).toEqual([
      ['a', 0, 4],
      ['b', 4, 6],
      ['c', 6, 7],
    ])
    expect(indexed[0][0]).not.toHaveProperty('turnsCovered')
  })

  it('gives turns up to the old cutoff that no entry counted to the last entry', () => {
    // Older versions made no entry for a batch of nothing but failed turns.
    const indexed = indexChronicle([[legacy('a', 4), legacy('b', 0)]], TEN, 8)
    expect(spans(indexed, TEN)).toEqual([['a', 0, 8]])
  })

  it('drops legacy entries that count more turns than the log holds, or none', () => {
    expect(indexChronicle([[legacy('a', 11)]], TEN, 10)).toEqual([])
    expect(indexChronicle([[legacy('a', 0)]], TEN, 4)).toEqual([])
  })
})

describe('compaction', () => {
  beforeEach(() => {
    mockedSummarizer.mockClear()
  })

  it('drains the live tail down to the floor in one rewrite of a single summary', async () => {
    const turns = completedTurns(32)
    const chronicle = await compact(turns, [])
    expect(chronicleCutoff(chronicle, turns)).toBe(16)
    expect(chronicle.flat()).toHaveLength(1)
    expect(mockedSummarizer).toHaveBeenCalledTimes(1)
    expect(summariesSeen()).toEqual([''])
    expect(turnNumbersRead(0)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
  })

  it('rewrites the summary from its last version and the turns being folded in', async () => {
    const turns = completedTurns(48)
    const chronicle = await compact(turns, [[entry('old', 't0', 't15')]])
    expect(summariesSeen()).toEqual(['old'])
    expect(turnNumbersRead(0)).toEqual(Array.from({ length: 16 }, (_, i) => i + 17))
    expect(chronicle.flat()).toHaveLength(1)
    expect(chronicle[0][0].text).not.toBe('old')
    expect(turnRanges(chronicle, turns)).toEqual([[0, 32]])
  })

  it('folds a chronicle saved with several entries into one summary, reading them in story order', async () => {
    const turns = completedTurns(16)
    const chronicle: Chronicle = [
      [entry('b', 't4', 't5'), entry('c', 't6', 't7')],
      [entry('a', 't0', 't3')],
    ]
    const compacted = await compact(turns, chronicle, SMALL)
    expect(summariesSeen()).toEqual(['a\n\nb\n\nc'])
    expect(compacted.flat()).toHaveLength(1)
    expect(turnRanges(compacted, turns)).toEqual([[0, 12]])
  })

  it('takes a long backlog in stretches, each reading the summary the last one left', async () => {
    const turns = completedTurns(48)
    const chronicle = await compact(turns, [])
    expect(mockedSummarizer).toHaveBeenCalledTimes(2)
    expect(turnNumbersRead(1)[0]).toBe(17)
    const first = await mockedSummarizer.mock.results[0].value
    expect(summariesSeen()).toEqual(['', first.summary])
    expect(chronicle.flat()).toHaveLength(1)
    expect(turnRanges(chronicle, turns)).toEqual([[0, 32]])
  })

  it('does nothing below the high watermark', async () => {
    const turns = completedTurns(31)
    const empty: Chronicle = []
    expect(await compact(turns, empty)).toBe(empty)
    expect(mockedSummarizer).not.toHaveBeenCalled()
    expect(chronicleNeedsCompaction(turns, empty, DEFAULTS)).toBe(false)
    expect(chronicleNeedsCompaction(completedTurns(32), empty, DEFAULTS)).toBe(true)
  })

  it('writes with the agent it was given', async () => {
    await compactChronicle(
      completedTurns(8),
      [],
      SMALL,
      { ...AGENT, model: 'grok-4.3', reasoningEffort: 'none' },
      new AbortController().signal,
    )
    for (const [input] of mockedSummarizer.mock.calls) {
      expect(input).toMatchObject({ model: 'grok-4.3', reasoningEffort: 'none', scenario: AGENT.scenario })
    }
  })

  it('folds every live turn but the latest when forced, below the threshold', async () => {
    const turns = completedTurns(6)
    const forced = (chronicle: Chronicle) =>
      compactChronicle(turns, chronicle, DEFAULTS, AGENT, new AbortController().signal, undefined, true)
    const chronicle = await forced([])
    expect(turnRanges(chronicle, turns)).toEqual([[0, 5]])
    expect(mockedSummarizer).toHaveBeenCalledTimes(1)
    // With only the latest turn live there is nothing to force.
    mockedSummarizer.mockClear()
    expect(await forced(chronicle)).toBe(chronicle)
    expect(mockedSummarizer).not.toHaveBeenCalled()
  })

  it('still folds when a stored threshold sits below the floor', async () => {
    // Stored threshold 8 with the default floor 16: an event folds half.
    const turns = completedTurns(8)
    const chronicle = await compact(turns, [], { ...DEFAULTS, compactionThreshold: 8 })
    expect(chronicleCutoff(chronicle, turns)).toBe(4)
    expect(mockedSummarizer).toHaveBeenCalledTimes(1)
  })

  it('aims for the same length however long the story has grown', async () => {
    await compact(completedTurns(32), [])
    await compact(completedTurns(48), [[entry('old', 't0', 't15')]], { ...DEFAULTS, summaryTargetChars: 900 })
    expect(mockedSummarizer.mock.calls.map(([input]) => input.targetChars)).toEqual([1500, 900])
  })
})

describe('rebuildChronicle', () => {
  beforeEach(() => {
    mockedSummarizer.mockClear()
  })

  it('replays compaction from the first turn, covering the same turns', async () => {
    const chronicle: Chronicle = [[entry('b', 't4', 't7')], [entry('a', 't0', 't3')]]
    const progress: number[] = []
    const rebuilt = await rebuildChronicle(TEN, chronicle, SMALL, AGENT, new AbortController().signal, (done) =>
      progress.push(done),
    )
    expect(rebuilt.flat()).toHaveLength(1)
    expect(turnRanges(rebuilt, TEN)).toEqual([[0, 8]])
    expect(turnNumbersRead(0)).toEqual([1, 2, 3, 4])
    expect(turnNumbersRead(1)).toEqual([5, 6, 7, 8])
    expect(progress).toEqual([1, 2])
    expect(rebuildCallCount(TEN, chronicle, SMALL)).toBe(2)
    // The old text plays no part: the first rewrite starts from nothing.
    const first = await mockedSummarizer.mock.results[0].value
    expect(summariesSeen()).toEqual(['', first.summary])
  })
})

describe('the chronicle in the request', () => {
  const part = (id: string, text: string, first: string, last: string) => ({ ...entry(id, first, last), text })

  it('sends nothing when there is no summary', () => {
    expect(buildChronicleSystemMessage([])).toBeNull()
  })

  it('sends a saved chronicle of several entries in story order', () => {
    const message = buildChronicleSystemMessage([
      [part('b', 'The river rose.', 't4', 't7')],
      [part('a', 'You reached the village.', 't0', 't3')],
    ])
    expect(message?.role).toBe('system')
    const content = message?.content ?? ''
    expect(content.indexOf('You reached the village.')).toBeGreaterThanOrEqual(0)
    expect(content.indexOf('You reached the village.')).toBeLessThan(content.indexOf('The river rose.'))
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
  const failedTurns = (count: number, from = 0) => Array.from({ length: count }, (_, i) => failedTurn(from + i))
  const completedFrom = (count: number, from: number) =>
    Array.from({ length: count }, (_, i) => completedTurn(from + i))

  beforeEach(() => {
    mockedSummarizer.mockClear()
  })

  it('folds only the turns that produced narration', async () => {
    const turns = [completedTurn(0), failedTurn(1), completedTurn(2), completedTurn(3), ...completedFrom(4, 4)]
    const chronicle = await compact(turns, [], SMALL)
    // The summary still covers the failed turn, but its text never reaches
    // the summariser.
    expect(turnRanges(chronicle, turns)).toEqual([[0, 4]])
    expect(chronicle[0][0].text).not.toContain('falters')
    expect(chronicle[0][0].text).toContain('3:PLAYER: p2')
  })

  it('gives a stretch of nothing but failures to the summary', async () => {
    const turns = [...completedFrom(4, 0), ...failedTurns(4, 4), ...completedFrom(4, 8)]
    const chronicle = await compact(turns, [], SMALL)
    expect(turnRanges(chronicle, turns)).toEqual([[0, 8]])
    expect(mockedSummarizer).toHaveBeenCalledTimes(1)
  })

  it('gives failures at the start to the first summary written', async () => {
    const turns = [...failedTurns(4), ...completedFrom(8, 4)]
    const chronicle = await compact(turns, [], SMALL)
    expect(turnRanges(chronicle, turns)).toEqual([[0, 8]])
    expect(mockedSummarizer).toHaveBeenCalledTimes(1)
  })

  it('leaves failures live when there is no summary for them to join', async () => {
    const turns = [...failedTurns(4), ...completedFrom(4, 4)]
    expect(await compact(turns, [], SMALL)).toEqual([])
    expect(mockedSummarizer).not.toHaveBeenCalled()
  })

  it('leaves the chronicle as it is when a rebuild has nothing narrated to read', async () => {
    const turns = failedTurns(4)
    const chronicle: Chronicle = [[entry('a', 'f0', 'f3')]]
    expect(await rebuildChronicle(turns, chronicle, SMALL, AGENT, new AbortController().signal)).toBe(chronicle)
    expect(mockedSummarizer).not.toHaveBeenCalled()
  })
})
