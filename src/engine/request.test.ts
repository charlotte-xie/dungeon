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
import type { AdventureSlots, BriefingCall, Turn } from './types'

const SLOTS: AdventureSlots = { scenario: 'A haunted mill.', styleGuide: '' }

const ALL_FLAGS: ContextFlags = {
  includeWorldState: true,
  includePlotOutline: true,
  includeMemory: true,
  includeOoc: true,
}

const RULE_HEADINGS = ['# Long-Term Memory', '# Story Direction', '# Live State', '# OOC Instructions']

// Records only the Plotter reads in full; the narrator gets the OOC list.
const PLOTTER_ONLY = ['the mill"', 'A drifter with a debt.', 'The miller returns at dusk']

const BRIEFING: BriefingCall[] = [
  { name: 'update_state', arguments: '{"keep":[],"set":{"scene.door":"open"}}', result: 'ok — state rebuilt' },
  { name: 'steer', arguments: '{"text":"Nobody answers."}', result: 'ok' },
]

function playerTurn(id: string, input: string, reply?: string, briefing?: BriefingCall[]): Turn {
  return {
    id,
    kind: 'player',
    input,
    reply: { id: `${id}-reply`, model: 'test', text: reply },
    briefing,
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

const PIVOT = 'Plan the turn.'

function plotter(history: Turn[], overrides?: Partial<ContextFlags>): ModelMessage[] {
  return buildPlotterMessages({ ...args(history, overrides), pivot: PIVOT })
}

// The conversational spine: user inputs and narration prose, ignoring the
// system prefix and any tool exchange.
function storyRoles(messages: ModelMessage[]): string[] {
  return messages
    .filter((m) => m.role === 'user' || (m.role === 'assistant' && !m.toolCalls?.length))
    .map((m) => m.role)
}

describe('buildNarratorMessages layout', () => {
  it('gives the narrator a line on its briefing per record, not the rules for keeping them', () => {
    const messages = narrator([playerTurn('t1', 'I enter the mill.')])
    for (const heading of RULE_HEADINGS) {
      expect(messages.some((m) => m.content.includes(heading))).toBe(false)
    }
    const firstUser = messages.findIndex((m) => m.role === 'user')
    const notes = messages.filter((m, i) => i < firstUser && m.content.startsWith('Before each reply'))
    expect(notes).toHaveLength(1)
    for (const mention of ['`update_memory`', '`recall_memory`', '`steer`', '`update_state`', 'OOC instructions']) {
      expect(notes[0].content).toContain(mention)
    }
  })

  it('replays each turn’s briefing as the DM’s own calls between its input and reply', () => {
    const messages = narrator([
      playerTurn('t1', 'I knock.', 'No answer.', BRIEFING),
      playerTurn('t2', 'I try the handle.', undefined, [
        { name: 'recall_memory', arguments: '{"names":["player"]}', result: '{"player":{}}' },
      ]),
    ])
    const story = messages.slice(messages.findIndex((m) => m.role === 'user'))
    expect(story.map((m) => (m.toolCalls ? 'calls' : m.role))).toEqual([
      'user',
      'calls',
      'tool',
      'tool',
      'assistant',
      'user',
      'calls',
      'tool',
      'system',
      'system',
    ])
    expect(story[1].toolCalls).toEqual([
      { id: 'dm-t1-1', name: 'update_state', arguments: BRIEFING[0].arguments },
      { id: 'dm-t1-2', name: 'steer', arguments: BRIEFING[1].arguments },
    ])
    expect(story[2]).toEqual({ role: 'tool', toolCallId: 'dm-t1-1', content: BRIEFING[0].result })
  })

  it('ends with the OOC list, then the turn reminder, and holds no other records', () => {
    const messages = narrator([playerTurn('t1', 'I enter the mill.')])
    const [input, ooc, reminder] = messages.slice(-3)
    expect(input).toMatchObject({ role: 'user', content: 'I enter the mill.' })
    expect(ooc).toEqual({ role: 'system', content: '# OOC instructions\n\n1. Keep replies short.' })
    expect(reminder).toEqual({ role: 'system', content: 'Tell what happens next.' })
    for (const m of messages) {
      for (const value of PLOTTER_ONLY) expect(m.content).not.toContain(value)
    }
  })

  it('sends the reminder in-channel when asked, keeping the OOC list out of the player’s voice', () => {
    const messages = buildNarratorMessages(args([playerTurn('t1', 'I wait.')], undefined, false))
    const [ooc, reminder] = messages.slice(-2)
    expect(ooc.role).toBe('system')
    expect(reminder).toMatchObject({ role: 'user', content: '(OOC: Tell what happens next.)' })
  })

  it('omits disabled records from the note and the tail', () => {
    const messages = narrator([playerTurn('t1', 'Hello?')], {
      includeMemory: false,
      includePlotOutline: false,
      includeOoc: false,
    })
    const notes = messages.find((m) => m.content.startsWith('Before each reply'))
    expect(notes?.content).toContain('`update_state`')
    expect(notes?.content).not.toContain('`recall_memory`')
    expect(notes?.content).not.toContain('`steer`')
    expect(messages[messages.length - 2]).toMatchObject({ role: 'user', content: 'Hello?' })
  })

  it('sends no note when every record is switched off', () => {
    const messages = narrator([playerTurn('t1', 'Hello?')], {
      includeWorldState: false,
      includePlotOutline: false,
      includeMemory: false,
      includeOoc: false,
    })
    expect(messages.some((m) => m.content.startsWith('Before each reply'))).toBe(false)
    expect(messages[messages.length - 2]).toMatchObject({ role: 'user', content: 'Hello?' })
  })

  it('never replays past turns’ other tool activity or reasoning', () => {
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
    expect(narrator(history).some((m) => m.toolCalls?.length || m.role === 'tool')).toBe(false)
    const plotterCalls = plotter(history)
      .filter((m) => m.role === 'assistant' && m.toolCalls?.length)
      .flatMap((m) => m.toolCalls?.map((c) => c.id) ?? [])
    // Only the Plotter's own seeded reads.
    expect(plotterCalls.every((id) => id.startsWith('ctx-'))).toBe(true)
    for (const messages of [narrator(history), plotter(history)]) {
      expect(messages.some((m) => m.content.includes('private thinking'))).toBe(false)
      expect(messages.some((m) => m.content.includes('(stale)'))).toBe(false)
    }
  })

  it('extends a stable prefix across successive turns, briefing included (cache-friendly)', () => {
    const t1 = playerTurn('t1', 'I knock.', undefined, BRIEFING)
    const first = narrator([t1])
    const t1Done: Turn = { ...t1, reply: { ...t1.reply, text: 'No answer.' } }
    const second = narrator([t1Done, playerTurn('t2', 'I try the handle.')])
    // Request 1 ends with the OOC list and reminder after t1's briefing.
    // Request 2 must reproduce everything before them byte-for-byte, so the
    // provider's prefix cache stays valid.
    const shared = first.slice(0, -2)
    expect(shared[shared.length - 1].role).toBe('tool')
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

  it('skips failed turns entirely — input, briefing, and notice', () => {
    const failed: Turn = {
      id: 'f',
      kind: 'player',
      input: 'I shout.',
      briefing: BRIEFING,
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
    expect(messages.some((m) => m.toolCalls?.length)).toBe(false)
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

  it('ends with the latest input, the seeded tool exchange, then its instruction', () => {
    const messages = plotter([playerTurn('t1', 'I enter the mill.')])
    const [input, call, ...rest] = messages.slice(-7)
    const results = rest.slice(0, 4)
    const pivot = rest[4]
    expect(input).toMatchObject({ role: 'user', content: 'I enter the mill.' })
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
    expect(pivot).toEqual({ role: 'system', content: PIVOT })
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
    const call = messages[messages.length - 3]
    expect(call.role).toBe('assistant')
    expect(call.toolCalls?.map((c) => c.name)).toEqual(['check_state'])
  })

  it('leaves the briefings to the narrator', () => {
    const messages = plotter([playerTurn('t1', 'I knock.', 'No answer.', BRIEFING), playerTurn('t2', 'I wait.')])
    expect(messages.some((m) => m.toolCalls?.some((c) => c.id.startsWith('dm-')))).toBe(false)
  })

  it('extends a stable prefix across successive turns (cache-friendly)', () => {
    const t1 = playerTurn('t1', 'I knock.')
    const first = plotter([t1])
    const t1Done: Turn = { ...t1, briefing: BRIEFING, reply: { ...t1.reply, text: 'No answer.' } }
    const second = plotter([t1Done, playerTurn('t2', 'I try the handle.')])
    // The injection and instruction follow t1's input; everything before them
    // must reappear byte-for-byte in the next turn's request.
    const shared = first.slice(0, -6)
    expect(shared[shared.length - 1]).toMatchObject({ role: 'user', content: 'I knock.' })
    expect(second.slice(0, shared.length)).toEqual(shared)
  })

  it('shares the story with the narrator request', () => {
    const history = [playerTurn('t1', 'I knock.', 'No answer.'), playerTurn('t2', 'I wait.')]
    const n = buildNarratorSections(args(history))
    const p = buildPlotterSections({ ...args(history), pivot: PIVOT })
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

  it('serves payloads as pure data, and per-turn guidance only as size status', () => {
    expect(buildStatePayload({ a: 1 })).not.toMatch(/update_state|STATUS|Plotter/)
    expect(buildMemoryPayload({})).toBe('(no memory yet)')
    const emptyData = { state: {}, plot: [], memory: {}, ooc: [] }
    for (const m of buildContextInjectionMessages(emptyData, ALL_FLAGS)) {
      expect(m.content).not.toMatch(/update_|Plotter/)
    }
    // What to record lives in the cached rules; the tail carries only status.
    expect(buildPlotterGuidance(emptyData, 4000, ALL_FLAGS)).toMatch(/^Live state: STATUS: state size/)
    expect(buildPlotterGuidance(emptyData, 4000, { ...ALL_FLAGS, includeWorldState: false })).toBe('')
    const bigMemory = { ...emptyData, memory: { notes: { is: 'x'.repeat(9000) } } }
    expect(buildPlotterGuidance(bigMemory, 4000, ALL_FLAGS)).toContain('Memory: STATUS: memory is')
  })
})

describe('buildStateGuidance', () => {
  it('flags oversized state against the cleanup threshold', () => {
    const big = { notes: 'x'.repeat(100) }
    expect(buildStateGuidance(big, 50)).toContain('OVER the 50 cleanup threshold')
    expect(buildStateGuidance(big, 5000)).toContain('within budget')
  })
})
