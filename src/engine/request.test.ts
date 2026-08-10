import { describe, expect, it } from 'vitest'
import {
  buildContextInjectionMessages,
  buildModelMessages,
  buildStatePayload,
  type ContextFlags,
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

function build(history: Turn[], overrides?: Partial<ContextFlags>): ModelMessage[] {
  return buildModelMessages({
    systemPrompt: 'system prompt',
    slots: SLOTS,
    chronicle: [],
    history,
    data: {
      state: { scene: { location: 'the mill' } },
      plot: ['The miller returns at dusk'],
      memory: { player: { is: 'A drifter with a debt.' } },
      ooc: ['Keep replies short.'],
    },
    stateCleanupThreshold: 4000,
    includePriorPlayerTurns: true,
    flags: {
      includeWorldState: true,
      includePlotOutline: true,
      includeMemory: true,
      includeOoc: true,
      ...overrides,
    },
    nsfw: false,
  })
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
    const [call, ...results] = messages.slice(-5)
    expect(call.role).toBe('assistant')
    expect(call.toolCalls?.map((c) => c.name)).toEqual([
      'check_memory',
      'check_plot_plan',
      'check_state',
      'check_ooc',
    ])
    expect(results.map((m) => m.role)).toEqual(['tool', 'tool', 'tool', 'tool'])
    expect(results.map((m) => m.toolCallId)).toEqual(call.toolCalls?.map((c) => c.id))
    expect(results[0].content).toContain('A drifter with a debt.')
    expect(results[1].content).toContain('1. The miller returns at dusk')
    expect(results[2].content).toContain('"location": "the mill"')
    expect(results[3].content).toContain('1. Keep replies short.')
    // The latest player input sits immediately before the injection.
    expect(messages[messages.length - 6]).toMatchObject({
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
      expect(m.content).not.toContain('Keep replies short.')
    }
  })

  it('omits disabled subsystems from both rules and injection', () => {
    const messages = build([playerTurn('t1', 'Hello?')], {
      includeMemory: false,
      includePlotOutline: false,
      includeOoc: false,
    })
    expect(
      messages.some((m) => m.role === 'system' && m.content.includes('# Long-Term Memory')),
    ).toBe(false)
    const call = messages[messages.length - 2]
    expect(call.role).toBe('assistant')
    expect(call.toolCalls?.map((c) => c.name)).toEqual(['check_state'])
  })

  it('never replays past turns\' tool activity — only the seeded injection', () => {
    const withCalls = (turn: Turn, callName: string): Turn => ({
      ...turn,
      reply: {
        ...turn.reply,
        trace: [
          { kind: 'call', name: callName, arguments: '{"keep":[],"set":{}}', result: 'ok' },
          { kind: 'call', name: 'check_state', arguments: '{}', result: '(stale)' },
          { kind: 'reasoning', text: 'private thinking' },
        ],
      },
    })
    const messages = build([
      withCalls(playerTurn('t1', 'I knock.', 'No answer.'), 'update_state'),
      withCalls(playerTurn('t2', 'I knock louder.', 'The door creaks open.'), 'update_memory'),
      playerTurn('t3', 'I step inside.'),
    ])
    const toolCallNames = messages
      .filter((m) => m.role === 'assistant' && m.toolCalls?.length)
      .flatMap((m) => m.toolCalls?.map((c) => c.name) ?? [])
    expect(toolCallNames).toEqual([
      'check_memory',
      'check_plot_plan',
      'check_state',
      'check_ooc',
    ])
    expect(messages.filter((m) => m.role === 'tool')).toHaveLength(4)
    expect(messages.some((m) => m.content.includes('private thinking'))).toBe(false)
    expect(messages.some((m) => m.content.includes('(stale)'))).toBe(false)
  })

  it('extends a stable prefix across successive turns (cache-friendly)', () => {
    const t1 = playerTurn('t1', 'I knock.')
    const first = build([t1])
    const t1Done: Turn = { ...t1, reply: { ...t1.reply, text: 'No answer.' } }
    const second = build([t1Done, playerTurn('t2', 'I try the handle.')])
    // Request 1 ends with the 5-message injection after t1's input. Request 2
    // must reproduce everything before that injection byte-for-byte, so the
    // provider's prefix cache stays valid; only the tail beyond t1's input
    // (t1's prose, t2's input, the fresh injection) is new.
    const shared = first.slice(0, -5)
    expect(shared[shared.length - 1]).toMatchObject({ role: 'user', content: 'I knock.' })
    expect(second.slice(0, shared.length)).toEqual(shared)
  })

  it('produces no injection when all subsystems are disabled', () => {
    const messages = build([playerTurn('t1', 'Hello?')], {
      includeWorldState: false,
      includePlotOutline: false,
      includeMemory: false,
      includeOoc: false,
    })
    expect(messages[messages.length - 1]).toMatchObject({ role: 'user', content: 'Hello?' })
    expect(messages.some((m) => m.role === 'tool')).toBe(false)
  })
})

describe('buildContextInjectionMessages', () => {
  it('uses stable ids so identical data produces identical bytes', () => {
    const allFlags = {
      includeWorldState: true,
      includePlotOutline: true,
      includeMemory: true,
      includeOoc: true,
    }
    const emptyData = { state: {}, plot: [], memory: {}, ooc: [] }
    const a = buildContextInjectionMessages(emptyData, 4000, allFlags)
    const b = buildContextInjectionMessages({ ...emptyData }, 4000, allFlags)
    expect(a).toEqual(b)
    expect(a[0].toolCalls?.map((c) => c.id)).toEqual([
      'ctx-check-memory',
      'ctx-check-plot-plan',
      'ctx-check-state',
      'ctx-check-ooc',
    ])
  })
})

describe('buildStatePayload', () => {
  it('flags oversized state against the cleanup threshold', () => {
    const big = { notes: 'x'.repeat(100) }
    expect(buildStatePayload(big, 50)).toContain('OVER the 50 cleanup threshold')
    expect(buildStatePayload(big, 5000)).toContain('within budget')
  })
})
