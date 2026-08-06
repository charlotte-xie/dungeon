import { describe, expect, it } from 'vitest'
import {
  buildContextInjectionMessages,
  buildHistoricalToolMessages,
  buildModelMessages,
  buildStatePayload,
} from './request'
import type { ModelMessage } from './model/types'
import type { AdventureSlots, Turn } from './types'

const SLOTS: AdventureSlots = { scenario: 'A haunted mill.', styleGuide: '' }

function playerTurn(id: string, input: string, reply?: string): Turn {
  return {
    id,
    kind: 'player',
    input,
    reply: { id: `${id}-reply`, model: 'test', text: reply },
  }
}

function build(
  history: Turn[],
  overrides?: Partial<{
    includeWorldState: boolean
    includePlotOutline: boolean
    includeMemory: boolean
  }>,
): ModelMessage[] {
  const flags = {
    includeWorldState: true,
    includePlotOutline: true,
    includeMemory: true,
    ...overrides,
  }
  return buildModelMessages(
    'system prompt',
    SLOTS,
    [],
    history,
    { scene: { location: 'the mill' } },
    ['The miller returns at dusk'],
    { player: 'A drifter with a debt.' },
    4000,
    true,
    flags.includeWorldState,
    flags.includePlotOutline,
    flags.includeMemory,
    true,
    false,
  )
}

describe('buildModelMessages layout', () => {
  it('puts subsystem rules in the stable prefix, before any history', () => {
    const messages = build([playerTurn('t1', 'I enter the mill.')])
    const firstUser = messages.findIndex((m) => m.role === 'user')
    const ruleIndexes = ['# Long-Term Memory', '# Future Plot Plan', '# Live State'].map(
      (heading) => messages.findIndex((m) => m.role === 'system' && m.content.includes(heading)),
    )
    for (const idx of ruleIndexes) {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(firstUser)
    }
  })

  it('ends with a seeded tool exchange carrying the volatile data', () => {
    const messages = build([playerTurn('t1', 'I enter the mill.')])
    const [call, ...results] = messages.slice(-4)
    expect(call.role).toBe('assistant')
    expect(call.toolCalls?.map((c) => c.name)).toEqual([
      'get_memory',
      'get_plot_plan',
      'get_state',
    ])
    expect(results.map((m) => m.role)).toEqual(['tool', 'tool', 'tool'])
    expect(results.map((m) => m.toolCallId)).toEqual(call.toolCalls?.map((c) => c.id))
    expect(results[0].content).toContain('A drifter with a debt.')
    expect(results[1].content).toContain('1. The miller returns at dusk')
    expect(results[2].content).toContain('"location": "the mill"')
    // The latest player input sits immediately before the injection.
    expect(messages[messages.length - 5]).toMatchObject({
      role: 'user',
      content: 'I enter the mill.',
    })
  })

  it('keeps volatile data out of system messages', () => {
    const messages = build([playerTurn('t1', 'I enter the mill.')])
    for (const m of messages) {
      if (m.role !== 'system') continue
      expect(m.content).not.toContain('the mill"')
      expect(m.content).not.toContain('A drifter with a debt.')
      expect(m.content).not.toContain('The miller returns at dusk')
    }
  })

  it('omits disabled subsystems from both rules and injection', () => {
    const messages = build([playerTurn('t1', 'Hello?')], {
      includeMemory: false,
      includePlotOutline: false,
    })
    expect(
      messages.some((m) => m.role === 'system' && m.content.includes('# Long-Term Memory')),
    ).toBe(false)
    const call = messages[messages.length - 2]
    expect(call.role).toBe('assistant')
    expect(call.toolCalls?.map((c) => c.name)).toEqual(['get_state'])
  })

  it('replays tool calls only for the most recent completed turn', () => {
    const withCalls = (turn: Turn, callName: string): Turn => ({
      ...turn,
      reply: {
        ...turn.reply,
        trace: [
          { kind: 'call', name: callName, arguments: '{"keep":[],"set":{}}', result: 'ok' },
        ],
      },
    })
    const messages = build([
      withCalls(playerTurn('t1', 'I knock.', 'No answer.'), 'update_state'),
      withCalls(playerTurn('t2', 'I knock louder.', 'The door creaks open.'), 'update_memory'),
      playerTurn('t3', 'I step inside.'),
    ])
    const replayed = messages
      .filter((m) => m.role === 'assistant' && m.toolCalls?.length)
      .flatMap((m) => m.toolCalls?.map((c) => c.name) ?? [])
    // Only turn t2 (the latest completed turn) replays; t1's calls are dropped.
    // The remaining tool-call message is the seeded context injection.
    expect(replayed).toEqual(['update_memory', 'get_memory', 'get_plot_plan', 'get_state'])
  })

  it('produces no injection when all subsystems are disabled', () => {
    const messages = build([playerTurn('t1', 'Hello?')], {
      includeWorldState: false,
      includePlotOutline: false,
      includeMemory: false,
    })
    expect(messages[messages.length - 1]).toMatchObject({ role: 'user', content: 'Hello?' })
    expect(messages.some((m) => m.role === 'tool')).toBe(false)
  })
})

describe('buildContextInjectionMessages', () => {
  it('uses stable ids so identical data produces identical bytes', () => {
    const a = buildContextInjectionMessages({}, [], {}, 4000, true, true, true)
    const b = buildContextInjectionMessages({}, [], {}, 4000, true, true, true)
    expect(a).toEqual(b)
    expect(a[0].toolCalls?.map((c) => c.id)).toEqual([
      'ctx-get-memory',
      'ctx-get-plot-plan',
      'ctx-get-state',
    ])
  })
})

describe('buildHistoricalToolMessages', () => {
  it('replays update calls but drops stale context reads', () => {
    const turn: Turn = {
      id: 't1',
      kind: 'player',
      input: 'I look around.',
      reply: {
        id: 't1-reply',
        model: 'test',
        text: 'You look around.',
        trace: [
          { kind: 'call', name: 'get_state', arguments: '{}', result: '(stale state)' },
          { kind: 'call', name: 'update_state', arguments: '{"keep":[],"set":{}}', result: 'ok' },
          { kind: 'call', name: 'get_memory (inline)', arguments: '{}', result: '(stale memory)' },
        ],
      },
    }
    const messages = buildHistoricalToolMessages(turn)
    expect(messages).toHaveLength(2)
    expect(messages[0].toolCalls?.map((c) => c.name)).toEqual(['update_state'])
    expect(messages[1]).toMatchObject({ role: 'tool', content: 'ok' })
  })

  it('returns nothing when the only calls were context reads', () => {
    const turn: Turn = {
      id: 't1',
      kind: 'player',
      input: 'Hm.',
      reply: {
        id: 't1-reply',
        model: 'test',
        text: 'Quiet.',
        trace: [{ kind: 'call', name: 'get_state', arguments: '{}', result: '(stale)' }],
      },
    }
    expect(buildHistoricalToolMessages(turn)).toEqual([])
  })
})

describe('buildStatePayload', () => {
  it('flags oversized state against the cleanup threshold', () => {
    const big = { notes: 'x'.repeat(100) }
    expect(buildStatePayload(big, 50)).toContain('OVER the 50 cleanup threshold')
    expect(buildStatePayload(big, 5000)).toContain('within budget')
  })
})
