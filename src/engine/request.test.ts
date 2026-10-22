import { describe, expect, it } from 'vitest'
import {
  buildContextInjectionMessages,
  buildMemoryPayload,
  buildNarratorMessages,
  buildNarratorSections,
  buildPlotterGuidance,
  buildPlotterMessages,
  buildPlotterSections,
  buildStateGuidance,
  buildStatePayload,
  type ContextFlags,
  type ModelMessagesArgs,
} from './request'
import type { ModelMessage } from './model/types'
import type { AdventureSlots, Turn } from './types'

const SLOTS: AdventureSlots = { scenario: 'A haunted mill.', styleGuide: '' }

const ALL_FLAGS: ContextFlags = {
  includeWorldState: true,
  includePlotOutline: true,
  includeMemory: true,
  includeOoc: true,
}

const RULE_HEADINGS = ['# Long-Term Memory', '# Story Direction', '# Live State', '# OOC Instructions']

const VOLATILE = ['the mill"', 'A drifter with a debt.', 'The miller returns at dusk', 'Keep replies short.']

function playerTurn(id: string, input: string, reply?: string): Turn {
  return {
    id,
    kind: 'player',
    input,
    reply: { id: `${id}-reply`, model: 'test', text: reply },
  }
}

function args(
  history: Turn[],
  overrides?: Partial<ContextFlags>,
  reminderAsSystem = true,
): ModelMessagesArgs {
  return {
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
    includePriorPlayerTurns: true,
    flags: { ...ALL_FLAGS, ...overrides },
    nsfw: false,
    reminderAsSystem,
  }
}

function narrator(history: Turn[], overrides?: Partial<ContextFlags>): ModelMessage[] {
  return buildNarratorMessages(args(history, overrides))
}

const PLOTTER_EXTRAS = { prose: 'The mill is dark.', pivot: 'Now record the turn.' }

function plotter(history: Turn[], overrides?: Partial<ContextFlags>): ModelMessage[] {
  return buildPlotterMessages({ ...args(history, overrides), ...PLOTTER_EXTRAS })
}

// The conversational spine: user inputs and narration prose, ignoring the
// system prefix and any seeded tool exchange.
function storyRoles(messages: ModelMessage[]): string[] {
  return messages
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.toolCalls?.length))
    .map((m) => m.role)
}

describe('buildNarratorMessages layout', () => {
  it('gives the narrator one line on each record, not the rules for keeping it', () => {
    const messages = narrator([playerTurn('t1', 'I enter the mill.')])
    for (const heading of RULE_HEADINGS) {
      expect(messages.some((m) => m.content.includes(heading))).toBe(false)
    }
    const firstUser = messages.findIndex((m) => m.role === 'user')
    const notes = messages.filter((m, i) => i < firstUser && m.content.startsWith('Your private notes'))
    expect(notes).toHaveLength(1)
    for (const label of ['Memory', 'Plot plan', 'Live state', 'OOC instructions']) {
      expect(notes[0].content).toContain(`- **${label}**: `)
    }
  })

  it('ends with the records as plain text, then the turn reminder, and offers no tool exchange', () => {
    const messages = narrator([playerTurn('t1', 'I enter the mill.')])
    const [input, records, reminder] = messages.slice(-3)
    expect(input).toMatchObject({ role: 'user', content: 'I enter the mill.' })
    expect(records.role).toBe('system')
    expect(records.content).toContain('# Memory')
    expect(records.content).toContain('A drifter with a debt.')
    expect(records.content).toContain('# Plot plan\n\n1. The miller returns at dusk')
    expect(records.content).toContain('# Live state')
    expect(records.content).toContain('"location": "the mill"')
    expect(records.content).toContain('# OOC instructions\n\n1. Keep replies short.')
    expect(reminder).toMatchObject({ role: 'system', content: "Reply to the player's latest input." })
    expect(messages.some((m) => m.role === 'tool' || m.toolCalls?.length)).toBe(false)
  })

  it('sends the reminder in-channel when asked, keeping the records out of the player’s voice', () => {
    const messages = buildNarratorMessages(args([playerTurn('t1', 'I wait.')], undefined, false))
    const [records, reminder] = messages.slice(-2)
    expect(records.role).toBe('system')
    expect(reminder).toMatchObject({ role: 'user', content: "(OOC: Reply to the player's latest input.)" })
  })

  it('keeps volatile data out of everything before the tail', () => {
    const sections = buildNarratorSections(args([playerTurn('t1', 'I enter the mill.')]))
    for (const m of [...sections.system, ...sections.chronicle, ...sections.history]) {
      for (const value of VOLATILE) expect(m.content).not.toContain(value)
    }
  })

  it('omits disabled records from both the notes and the tail', () => {
    const messages = narrator([playerTurn('t1', 'Hello?')], {
      includeMemory: false,
      includePlotOutline: false,
      includeOoc: false,
    })
    const notes = messages.find((m) => m.content.startsWith('Your private notes'))
    expect(notes?.content).toContain('**Live state**')
    expect(notes?.content).not.toContain('**Memory**')
    const records = messages[messages.length - 2]
    expect(records.content).toContain('# Live state')
    expect(records.content).not.toContain('# Memory')
  })

  it('sends no records when every record is switched off', () => {
    const messages = narrator([playerTurn('t1', 'Hello?')], {
      includeWorldState: false,
      includePlotOutline: false,
      includeMemory: false,
      includeOoc: false,
    })
    expect(messages[messages.length - 2]).toMatchObject({ role: 'user', content: 'Hello?' })
    expect(messages.some((m) => m.content.startsWith('Your private notes'))).toBe(false)
  })

  it('never replays past turns\' tool activity', () => {
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
    const history = [
      withCalls(playerTurn('t1', 'I knock.', 'No answer.'), 'update_state'),
      withCalls(playerTurn('t2', 'I knock louder.', 'The door creaks open.'), 'update_memory'),
      playerTurn('t3', 'I step inside.'),
    ]
    for (const messages of [narrator(history), plotter(history)]) {
      const toolCallNames = messages
        .filter((m) => m.role === 'assistant' && m.toolCalls?.length)
        .flatMap((m) => m.toolCalls?.map((c) => c.name) ?? [])
      // Only the Plotter's own seeded reads, never a past turn's calls.
      expect(toolCallNames.every((name) => name.startsWith('check_'))).toBe(true)
      expect(messages.some((m) => m.content.includes('private thinking'))).toBe(false)
      expect(messages.some((m) => m.content.includes('(stale)'))).toBe(false)
    }
  })

  it('extends a stable prefix across successive turns (cache-friendly)', () => {
    const t1 = playerTurn('t1', 'I knock.')
    const first = narrator([t1])
    const t1Done: Turn = { ...t1, reply: { ...t1.reply, text: 'No answer.' } }
    const second = narrator([t1Done, playerTurn('t2', 'I try the handle.')])
    // Request 1 ends with the records and reminder after t1's input. Request 2
    // must reproduce everything before them byte-for-byte, so the provider's
    // prefix cache stays valid.
    const shared = first.slice(0, -2)
    expect(shared[shared.length - 1]).toMatchObject({ role: 'user', content: 'I knock.' })
    expect(second.slice(0, shared.length)).toEqual(shared)
  })

  it('keeps bootstrap and Continue directives once their turn completes', () => {
    const bootstrap: Turn = {
      id: 'b',
      kind: 'bootstrap',
      input: '(OOC: Begin a new adventure.)',
      reply: { id: 'b-reply', model: 'test', text: 'You arrive at the mill.' },
    }
    const cont: Turn = {
      id: 'c',
      kind: 'continue',
      input: '(OOC: The player is skipping their turn.)',
      reply: { id: 'c-reply', model: 'test', text: 'The wind picks up.' },
    }
    const opening = narrator([bootstrap])
    const later = narrator([bootstrap, cont, playerTurn('t3', 'I look around.')])
    // Roles alternate — no narration ever follows narration directly.
    expect(storyRoles(later)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect(later.some((m) => m.content === '(OOC: Begin a new adventure.)')).toBe(true)
    // And the opening request's bytes are still a prefix of the later one:
    // nothing that was sent is later removed.
    const shared = opening.slice(0, -2)
    expect(later.slice(0, shared.length)).toEqual(shared)
  })

  it('skips failed turns entirely — neither the unanswered input nor the notice', () => {
    const failed: Turn = {
      id: 'f',
      kind: 'player',
      input: 'I shout.',
      reply: {
        id: 'f-reply',
        model: 'test',
        text: '(The dungeon master falters: boom)',
        error: 'boom',
      },
    }
    const messages = narrator([
      playerTurn('t1', 'I knock.', 'No answer.'),
      failed,
      playerTurn('t3', 'I wait.'),
    ])
    expect(messages.some((m) => m.content.includes('falters'))).toBe(false)
    expect(messages.some((m) => m.content === 'I shout.')).toBe(false)
    expect(storyRoles(messages)).toEqual(['user', 'assistant', 'user'])
  })
})

describe('buildPlotterMessages layout', () => {
  it('puts the full rules in the stable prefix, before any history', () => {
    const messages = plotter([playerTurn('t1', 'I enter the mill.')])
    const firstUser = messages.findIndex((m) => m.role === 'user')
    for (const heading of RULE_HEADINGS) {
      const idx = messages.findIndex((m) => m.role === 'system' && m.content.includes(heading))
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(firstUser)
    }
  })

  it('ends with the seeded tool exchange, the prose, then the pivot', () => {
    const messages = plotter([playerTurn('t1', 'I enter the mill.')])
    const [call, ...rest] = messages.slice(-7)
    const results = rest.slice(0, 4)
    const [prose, pivot] = rest.slice(4)
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
    expect(prose).toEqual({ role: 'assistant', content: 'The mill is dark.' })
    expect(pivot).toEqual({ role: 'system', content: 'Now record the turn.' })
    // The latest player input sits immediately before the injection.
    expect(messages[messages.length - 8]).toMatchObject({
      role: 'user',
      content: 'I enter the mill.',
    })
  })

  it('omits disabled records from both rules and injection', () => {
    const messages = plotter([playerTurn('t1', 'Hello?')], {
      includeMemory: false,
      includePlotOutline: false,
      includeOoc: false,
    })
    expect(
      messages.some((m) => m.role === 'system' && m.content.includes('# Long-Term Memory')),
    ).toBe(false)
    const call = messages[messages.length - 4]
    expect(call.role).toBe('assistant')
    expect(call.toolCalls?.map((c) => c.name)).toEqual(['check_state'])
  })

  it('extends a stable prefix across successive turns (cache-friendly)', () => {
    const t1 = playerTurn('t1', 'I knock.')
    const first = plotter([t1])
    const t1Done: Turn = { ...t1, reply: { ...t1.reply, text: 'No answer.' } }
    const second = plotter([t1Done, playerTurn('t2', 'I try the handle.')])
    // The injection, prose and pivot follow t1's input; everything before
    // them must reappear byte-for-byte in the next turn's request.
    const shared = first.slice(0, -7)
    expect(shared[shared.length - 1]).toMatchObject({ role: 'user', content: 'I knock.' })
    expect(second.slice(0, shared.length)).toEqual(shared)
  })

  it('shares the story with the narrator request', () => {
    const history = [playerTurn('t1', 'I knock.', 'No answer.'), playerTurn('t2', 'I wait.')]
    const n = buildNarratorSections(args(history))
    const p = buildPlotterSections({ ...args(history), ...PLOTTER_EXTRAS })
    expect(p.history).toEqual(n.history)
    expect(p.chronicle).toEqual(n.chronicle)
    // System prompt, content stance, and scenario come first in both.
    expect(p.system.slice(0, 3)).toEqual(n.system.slice(0, 3))
  })
})

describe('buildContextInjectionMessages', () => {
  it('uses stable ids so identical data produces identical bytes', () => {
    const emptyData = { state: {}, plot: [], memory: {}, ooc: [] }
    const a = buildContextInjectionMessages(emptyData, ALL_FLAGS)
    const b = buildContextInjectionMessages({ ...emptyData }, ALL_FLAGS)
    expect(a).toEqual(b)
    expect(a[0].toolCalls?.map((c) => c.id)).toEqual([
      'ctx-check-memory',
      'ctx-check-plot-plan',
      'ctx-check-state',
      'ctx-check-ooc',
    ])
  })

  it('serves payloads as pure data — the bookkeeping guidance rides in the pivot', () => {
    expect(buildStatePayload({ a: 1 })).not.toMatch(/update_state|STATUS|Plotter/)
    expect(buildMemoryPayload({})).toBe('(no memory yet)')
    const emptyData = { state: {}, plot: [], memory: {}, ooc: [] }
    for (const m of buildContextInjectionMessages(emptyData, ALL_FLAGS)) {
      expect(m.content).not.toMatch(/update_|Plotter/)
    }
    const guidance = buildPlotterGuidance(emptyData, 4000, ALL_FLAGS)
    expect(guidance).toContain('`update_memory`')
    expect(guidance).toContain('`update_state`')
    expect(guidance).toContain('`update_ooc`')
    expect(buildPlotterGuidance(emptyData, 4000, { ...ALL_FLAGS, includeMemory: false })).not.toContain(
      'update_memory',
    )
  })
})

describe('buildStateGuidance', () => {
  it('flags oversized state against the cleanup threshold', () => {
    const big = { notes: 'x'.repeat(100) }
    expect(buildStateGuidance(big, 50)).toContain('OVER the 50 cleanup threshold')
    expect(buildStateGuidance(big, 5000)).toContain('within budget')
  })
})
