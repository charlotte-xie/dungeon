import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chronicleCutoff,
  chronicleRanges,
  compactCascade,
  entryTurnNumbers,
  indexChronicle,
  rebuildChronicle,
  sameChronicle,
  withoutEntries,
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
}

function completedTurn(i: number): Turn {
  return {
    id: `t${i}`,
    kind: 'player',
    input: `p${i}`,
    reply: { id: `t${i}-reply`, model: 'test', text: `d${i}` },
  }
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

const TEN = Array.from({ length: 10 }, (_, i) => completedTurn(i))

// What each summariser call was given as the story so far, in call order.
function storiesSeen() {
  return mockedSummarizer.mock.calls.map(([input]) => input.storySoFar)
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

describe('compactCascade drain events', () => {
  beforeEach(() => {
    mockedSummarizer.mockClear()
  })

  it('drains the live tail from the threshold down to the floor in one event', async () => {
    const turns = Array.from({ length: 32 }, (_, i) => completedTurn(i))
    const chronicle = await compactCascade(
      turns,
      [],
      { compactionThreshold: 32, compactionFloor: 16, compactionBatch: 4 },
      AGENT,
      new AbortController().signal,
    )
    // 16 turns folded as 4 sub-batches of 4; 16 remain live.
    expect(chronicleCutoff(chronicle, turns)).toBe(16)
    expect(chronicle).toHaveLength(1)
    expect(mockedSummarizer).toHaveBeenCalledTimes(4)
    // Entries preserve story order and each points at its own sub-batch.
    expect(spans(chronicle, turns)?.map(([, start, end]) => [start, end])).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
      [12, 16],
    ])
    expect(chronicle[0][0].text).toContain('1:PLAYER: p0')
    expect(chronicle[0][3].text).toContain('13:PLAYER: p12')
    // Each fold is written with the ones before it as its story so far.
    const texts = chronicle[0].map((e) => e.text)
    expect(storiesSeen()).toEqual([[], texts.slice(0, 1), texts.slice(0, 2), texts.slice(0, 3)])
  })

  it('gives a fold the whole chronicle, and a promotion the levels above it, as the story so far', async () => {
    // Threshold 4, batch 2, floor 2: four live turns fold down to two, which
    // fills level 0 and promotes its first two entries.
    const turns = Array.from({ length: 14 }, (_, i) => completedTurn(i))
    const chronicle: Chronicle = [
      [entry('a', 't4', 't5'), entry('b', 't6', 't7'), entry('c', 't8', 't9')],
      [entry('x', 't0', 't3')],
    ]
    const compacted = await compactCascade(
      turns,
      chronicle,
      { compactionThreshold: 4, compactionFloor: 2, compactionBatch: 2 },
      AGENT,
      new AbortController().signal,
    )
    expect(storiesSeen()).toEqual([['x', 'a', 'b', 'c'], ['x']])
    expect(mockedSummarizer.mock.calls[1][0].turns.map((t) => t.number)).toEqual([5, 6, 7, 8])
    expect(spans(compacted, turns)?.map(([id, start, end]) => [id.length === 1 ? id : 'new', start, end])).toEqual([
      ['x', 0, 4],
      ['new', 4, 8],
      ['c', 8, 10],
      ['new', 10, 12],
    ])
  })

  it('does nothing below the high watermark', async () => {
    const turns = Array.from({ length: 31 }, (_, i) => completedTurn(i))
    const chronicle = await compactCascade(
      turns,
      [],
      { compactionThreshold: 32, compactionFloor: 16, compactionBatch: 4 },
      AGENT,
      new AbortController().signal,
    )
    expect(chronicle).toEqual([])
    expect(mockedSummarizer).not.toHaveBeenCalled()
  })

  it('summarises a promoted entry from the turns it covers, not from the summaries', async () => {
    const turns = Array.from({ length: 8 }, (_, i) => completedTurn(i))
    const chronicle = await compactCascade(
      turns,
      [],
      { compactionThreshold: 4, compactionFloor: 0, compactionBatch: 2 },
      { ...AGENT, model: 'grok-4.3', reasoningEffort: 'none' },
      new AbortController().signal,
    )
    // Four folds of two turns, then the first two entries promoted to one.
    expect(chronicle).toHaveLength(2)
    expect(mockedSummarizer).toHaveBeenCalledTimes(5)
    expect(spans(chronicle, turns)?.map(([, start, end]) => [start, end])).toEqual([
      [0, 4],
      [4, 6],
      [6, 8],
    ])
    const promotion = mockedSummarizer.mock.calls[4][0]
    expect(promotion.turns.map((t) => t.number)).toEqual([1, 2, 3, 4])
    expect(promotion.turns.every((t) => !t.text.includes('SUMMARY'))).toBe(true)
    for (const [input] of mockedSummarizer.mock.calls) {
      expect(input).toMatchObject({ model: 'grok-4.3', reasoningEffort: 'none' })
    }
  })

  it('folds every live turn but the latest when forced, below the threshold', async () => {
    const settings = { compactionThreshold: 32, compactionFloor: 16, compactionBatch: 4 }
    const turns = Array.from({ length: 6 }, (_, i) => completedTurn(i))
    const chronicle = await compactCascade(turns, [], settings, AGENT, new AbortController().signal, undefined, true)
    // Five turns folded as sub-batches of 4 and 1; the latest stays live.
    expect(spans(chronicle, turns)?.map(([, start, end]) => [start, end])).toEqual([
      [0, 4],
      [4, 5],
    ])
    expect(mockedSummarizer).toHaveBeenCalledTimes(2)
    // With only the latest turn live there is nothing to force.
    mockedSummarizer.mockClear()
    const again = await compactCascade(turns, chronicle, settings, AGENT, new AbortController().signal, undefined, true)
    expect(again).toBe(chronicle)
    expect(mockedSummarizer).not.toHaveBeenCalled()
  })

  it('clamps the floor for legacy configs whose threshold predates it', async () => {
    // Stored threshold 8 with the new default floor 16: floor clamps to
    // N - M = 4, reproducing the old fold-one-batch behaviour.
    const turns = Array.from({ length: 8 }, (_, i) => completedTurn(i))
    const chronicle = await compactCascade(
      turns,
      [],
      { compactionThreshold: 8, compactionFloor: 16, compactionBatch: 4 },
      AGENT,
      new AbortController().signal,
    )
    expect(chronicleCutoff(chronicle, turns)).toBe(4)
    expect(chronicle[0]).toHaveLength(1)
    expect(mockedSummarizer).toHaveBeenCalledTimes(1)
  })
})

describe('rebuildChronicle', () => {
  beforeEach(() => {
    mockedSummarizer.mockClear()
  })

  it('writes every entry afresh from its own turns, keeping its place and turns', async () => {
    const chronicle: Chronicle = [
      [entry('b', 't4', 't5'), entry('c', 't6', 't6')],
      [entry('a', 't0', 't3')],
    ]
    const progress: number[] = []
    const rebuilt = await rebuildChronicle(TEN, chronicle, AGENT, new AbortController().signal, (done) =>
      progress.push(done),
    )
    expect(spans(rebuilt, TEN)).toEqual(spans(chronicle, TEN))
    expect(rebuilt[1][0].text).toBe('SUMMARY[1:PLAYER: p0\n\nDM: d0|2:PLAYER: p1\n\nDM: d1|3:PLAYER: p2\n\nDM: d2|4:PLAYER: p3\n\nDM: d3]')
    expect(rebuilt[0][1].text).toBe('SUMMARY[7:PLAYER: p6\n\nDM: d6]')
    expect(mockedSummarizer).toHaveBeenCalledTimes(3)
    expect(progress).toEqual([1, 2, 3])
    // In story order, each with the entries rewritten before it.
    expect(storiesSeen()).toEqual([[], [rebuilt[1][0].text], [rebuilt[1][0].text, rebuilt[0][0].text]])
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
  // Threshold 8, batch 4: the floor clamps to 4, so one event folds down to
  // four live turns.
  const SETTINGS = { compactionThreshold: 8, compactionFloor: 4, compactionBatch: 4 }

  beforeEach(() => {
    mockedSummarizer.mockClear()
  })

  it('folds only the turns that produced narration', async () => {
    const turns = [
      completedTurn(0),
      failedTurn(1),
      completedTurn(2),
      completedTurn(3),
      ...Array.from({ length: 4 }, (_, i) => completedTurn(4 + i)),
    ]
    const chronicle = await compactCascade(turns, [], SETTINGS, AGENT, new AbortController().signal)
    // The entry still covers the failed turn, but its text never reaches the
    // summariser.
    expect(spans(chronicle, turns)).toEqual([[chronicle[0][0].id, 0, 4]])
    expect(chronicle[0][0].text).not.toContain('falters')
    expect(chronicle[0][0].text).toContain('3:PLAYER: p2')
  })

  it('gives a batch of nothing but failures to the entry before it', async () => {
    const turns = [
      ...Array.from({ length: 4 }, (_, i) => completedTurn(i)),
      ...Array.from({ length: 4 }, (_, i) => failedTurn(4 + i)),
      ...Array.from({ length: 4 }, (_, i) => completedTurn(8 + i)),
    ]
    const chronicle = await compactCascade(turns, [], SETTINGS, AGENT, new AbortController().signal)
    expect(spans(chronicle, turns)?.map(([, start, end]) => [start, end])).toEqual([[0, 8]])
    expect(mockedSummarizer).toHaveBeenCalledTimes(1)
  })

  it('gives failures at the start to the next new entry', async () => {
    const turns = [
      ...Array.from({ length: 4 }, (_, i) => failedTurn(i)),
      ...Array.from({ length: 8 }, (_, i) => completedTurn(4 + i)),
    ]
    const chronicle = await compactCascade(turns, [], SETTINGS, AGENT, new AbortController().signal)
    expect(spans(chronicle, turns)?.map(([, start, end]) => [start, end])).toEqual([[0, 8]])
    expect(mockedSummarizer).toHaveBeenCalledTimes(1)
  })

  it('leaves failures live when there is no entry for them to join', async () => {
    const turns = [
      ...Array.from({ length: 4 }, (_, i) => failedTurn(i)),
      ...Array.from({ length: 4 }, (_, i) => completedTurn(4 + i)),
    ]
    const chronicle = await compactCascade(turns, [], SETTINGS, AGENT, new AbortController().signal)
    expect(chronicle).toEqual([])
    expect(mockedSummarizer).not.toHaveBeenCalled()
  })
})
