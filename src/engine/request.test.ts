import { describe, expect, it } from 'vitest'
import {
  CONTEXT_SUBSYSTEMS,
  buildContextInjectionMessages,
  buildMemoryPayload,
  buildNarratorMessages,
  buildNarratorNotesMessage,
  buildNarratorSections,
  buildPlotterGuidance,
  buildPlotterMessages,
  buildPlotterSections,
  buildPlotterTools,
  buildReplyNotes,
  buildStateGuidance,
  buildStoryUpdate,
  storyUpdateCalls,
  buildStatePayload,
  type ContextFlags,
  type ModelMessagesArgs,
} from './request'
import type { ModelMessage } from './model/types'
import { PLOTTER_SYSTEM_PROMPT, buildTurnReminder } from '../prompts'
import { STATE_RULES } from './state'
import { MEMORY_RULES, OOC_RULES, PLOT_RULES } from './tools'
import type { AdventureSlots, BriefingCall, StoryUpdate, Turn } from './types'

const SLOTS: AdventureSlots = { scenario: 'A haunted mill.', styleGuide: '' }

const ALL_FLAGS: ContextFlags = {
  includeWorldState: true,
  includePlotOutline: true,
  includeMemory: true,
  includeOoc: true,
}

// Each record's rules, which travel in the description of the tool that keeps it.
const RULES = [MEMORY_RULES, PLOT_RULES, STATE_RULES, OOC_RULES]

// Records only the Plotter reads in full: the narrator gets the scene in its
// notes, and the OOC list and recalled memories only through story updates.
const PLOTTER_ONLY = ['A drifter with a debt.', 'The miller returns at dusk', 'Keep replies short.']

const UPDATE: StoryUpdate = { recalled: { Hesta: { is: 'The baker.' } } }

const BRIEFING: BriefingCall[] = [
  { name: 'recall_memory', arguments: '{"names":["player","Hesta"]}', result: '{"player":{}}' },
  { name: 'steer', arguments: '{"text":"Nobody answers."}', result: 'ok' },
]

function playerTurn(id: string, input: string, reply?: string, storyUpdate?: StoryUpdate): Turn {
  return {
    id,
    kind: 'player',
    input,
    reply: { id: `${id}-reply`, model: 'test', text: reply },
    storyUpdate,
  }
}

function args(
  history: Turn[],
  overrides?: Partial<ContextFlags>,
  reminderAsSystem = true,
  briefing?: BriefingCall[],
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
    briefing,
  }
}

function narrator(
  history: Turn[],
  overrides?: Partial<ContextFlags>,
  briefing?: BriefingCall[],
): ModelMessage[] {
  return buildNarratorMessages(args(history, overrides, true, briefing))
}

// A request up to and including its latest input: what the next turn's
// request must reproduce.
function upToLatestInput(messages: ModelMessage[]): ModelMessage[] {
  return messages.slice(0, messages.findLastIndex((m) => m.role === 'user') + 1)
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
  it('gives the narrator a line on its notes per record, not the rules for keeping them', () => {
    const messages = narrator([playerTurn('t1', 'I enter the mill.')])
    for (const rules of RULES) {
      expect(messages.some((m) => m.content.includes(rules))).toBe(false)
    }
    const firstUser = messages.findIndex((m) => m.role === 'user')
    const note = buildNarratorNotesMessage(ALL_FLAGS)
    const notes = messages.filter((m, i) => i < firstUser && m.content === note?.content)
    expect(notes).toHaveLength(1)
    // It names the narrator's own calls, and holds each record's line.
    for (const call of ['`recall_memories`', '`get_ooc_instructions`', '`get_steer`']) {
      expect(notes[0].content).toContain(call)
    }
    for (const s of CONTEXT_SUBSYSTEMS) expect(notes[0].content).toContain(s.narratorNote)
    // The Plotter's record-keeping stays out of sight.
    expect(notes[0].content).not.toMatch(/update_|recall_memory|`steer`/)
  })

  it('replays each turn’s story update in history, and gives notes for the current reply only', () => {
    const t1: Turn = {
      ...playerTurn('t1', 'I knock.', 'No answer.', UPDATE),
      // A briefing an older version saved is never replayed.
      briefing: BRIEFING,
    }
    const messages = narrator(
      [t1, playerTurn('t2', 'I try the handle.', undefined, { ooc: ['Keep replies short.'] })],
      undefined,
      BRIEFING,
    )
    const story = messages.slice(messages.findIndex((m) => m.role === 'user'))
    expect(story.map((m) => (m.toolCalls ? 'calls' : m.role))).toEqual([
      'user',
      'calls',
      'tool',
      'assistant',
      'user',
      'calls',
      'tool',
      'calls',
      'tool',
      'system',
    ])
    expect(story[1].toolCalls).toEqual([{ id: 'dm-t1-recall-memories', name: 'recall_memories', arguments: '{}' }])
    expect(story[2]).toEqual({
      role: 'tool',
      toolCallId: 'dm-t1-recall-memories',
      content: storyUpdateCalls(UPDATE, undefined)[0].result,
    })
    expect(story[5].toolCalls?.map((c) => c.name)).toEqual(['get_ooc_instructions'])
    expect(story[6].content).toBe('1. Keep replies short.')
    expect(story[7].toolCalls).toEqual([{ id: 'dm-get-steer', name: 'get_steer', arguments: '{}' }])
    expect(story[8]).toMatchObject({ role: 'tool', toolCallId: 'dm-get-steer' })
    expect(story[8].content).toContain('Nobody answers.')
  })

  it('ends with its notes, then the turn reminder, and holds no other records', () => {
    const messages = narrator([playerTurn('t1', 'I enter the mill.')])
    const [input, call, notes, reminder] = messages.slice(-4)
    expect(input).toMatchObject({ role: 'user', content: 'I enter the mill.' })
    expect(call.toolCalls?.map((c) => c.name)).toEqual(['get_steer'])
    // With nothing steered, the notes hold the scene alone.
    expect(notes.content).toBe('# Scene\n\n```json\n{\n  "scene": {\n    "location": "the mill"\n  }\n}\n```')
    // After the player's own input, the reply opens by telling their move.
    expect(reminder).toEqual({ role: 'system', content: buildTurnReminder('player') })
    for (const m of messages) {
      for (const value of PLOTTER_ONLY) expect(m.content).not.toContain(value)
    }
  })

  it('sends the reminder in-channel when asked', () => {
    const messages = buildNarratorMessages(args([playerTurn('t1', 'I wait.')], undefined, false))
    const reminder = messages[messages.length - 1]
    expect(reminder).toMatchObject({ role: 'user', content: `(OOC: ${buildTurnReminder('player')})` })
  })

  it('omits disabled records from the note and the tail', () => {
    const messages = narrator(
      [playerTurn('t1', 'Hello?')],
      { includeMemory: false, includePlotOutline: false, includeOoc: false },
      BRIEFING,
    )
    const notes = messages.find((m) => m.content === buildNarratorNotesMessage({ ...ALL_FLAGS, includeMemory: false, includePlotOutline: false, includeOoc: false })?.content)
    // Only the scene is switched on: its line, and no story updates.
    for (const s of CONTEXT_SUBSYSTEMS) {
      if (s.label === 'Live state') expect(notes?.content).toContain(s.narratorNote)
      else expect(notes?.content).not.toContain(s.narratorNote)
    }
    expect(notes?.content).not.toMatch(/`recall_memories`|`get_ooc_instructions`/)
    const [input, , replyNotes, reminder] = messages.slice(-4)
    expect(input).toMatchObject({ role: 'user', content: 'Hello?' })
    expect(replyNotes.content).toMatch(/^# Scene/)
    expect(replyNotes.content).not.toMatch(/# Remembered|# Steer/)
    expect(reminder.role).toBe('system')
  })

  it('sends no note when every record is switched off', () => {
    const messages = narrator([playerTurn('t1', 'Hello?')], {
      includeWorldState: false,
      includePlotOutline: false,
      includeMemory: false,
      includeOoc: false,
    })
    expect(
      buildNarratorNotesMessage({
        includeWorldState: false,
        includePlotOutline: false,
        includeMemory: false,
        includeOoc: false,
      }),
    ).toBeNull()
    for (const sub of CONTEXT_SUBSYSTEMS) {
      expect(messages.some((m) => m.content.includes(sub.narratorNote))).toBe(false)
    }
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
    const narratorHistory = buildNarratorSections(args(history)).history
    expect(narratorHistory.some((m) => m.toolCalls?.length || m.role === 'tool')).toBe(false)
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

  it('extends a stable prefix across successive turns, story update included (cache-friendly)', () => {
    const t1 = playerTurn('t1', 'I knock.', undefined, UPDATE)
    const first = narrator([t1], undefined, BRIEFING)
    const t1Done: Turn = { ...t1, reply: { ...t1.reply, text: 'No answer.' } }
    const second = narrator([t1Done, playerTurn('t2', 'I try the handle.')])
    // Request 1 ends with t1's notes and the reminder after t1's story
    // update. Request 2 must reproduce everything before them byte-for-byte,
    // so the provider's prefix cache stays valid.
    const shared = first.slice(0, -3)
    expect(shared[shared.length - 1]).toMatchObject({ role: 'tool', toolCallId: 'dm-t1-recall-memories' })
    expect(second.slice(0, shared.length)).toEqual(shared)
    expect(second.some((m) => m.content.includes('Nobody answers.'))).toBe(false)
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
    const shared = upToLatestInput(opening)
    expect(later.slice(0, shared.length)).toEqual(shared)
  })

  it('skips failed turns entirely — input, briefing, and notice', () => {
    const failed: Turn = {
      id: 'f',
      kind: 'player',
      input: 'I shout.',
      storyUpdate: { recalled: { Lost: { is: 'Lost direction.' } } },
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
    expect(messages.some((m) => m.content.includes('Lost direction.'))).toBe(false)
    expect(storyRoles(messages)).toEqual(['user', 'assistant', 'user'])
  })
})

describe('buildPlotterMessages layout', () => {
  it('carries each record’s rules in the tool that keeps it, not in a message', () => {
    const messages = plotter([playerTurn('t1', 'I enter the mill.')])
    const tools = buildPlotterTools(ALL_FLAGS)
    for (const rules of RULES) {
      expect(messages.some((m) => m.content.includes(rules))).toBe(false)
      expect(tools.some((t) => t.description.includes(rules))).toBe(true)
    }
    // A record switched off takes its rules with its tools.
    const withoutPlan = buildPlotterTools({ ...ALL_FLAGS, includePlotOutline: false })
    expect(withoutPlan.some((t) => t.description.includes(PLOT_RULES))).toBe(false)
  })

  it('gets the scenario but leaves the style guide to the narrator', () => {
    const slots = { scenario: 'A haunted mill.', styleGuide: 'Spare, wry prose.' }
    const both = { ...args([playerTurn('t1', 'I enter the mill.')]), slots }
    const said = (messages: ModelMessage[], text: string) => messages.some((m) => m.content.includes(text))
    const plotterMessages = buildPlotterMessages({ ...both, pivot: PIVOT })
    expect(said(plotterMessages, 'A haunted mill.')).toBe(true)
    expect(said(plotterMessages, 'Spare, wry prose.')).toBe(false)
    expect(said(buildNarratorMessages(both), 'Spare, wry prose.')).toBe(true)
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

  it('omits disabled records from the tools and the injection', () => {
    const off = { includeMemory: false, includePlotOutline: false, includeOoc: false }
    const messages = plotter([playerTurn('t1', 'Hello?')], off)
    expect(buildPlotterTools({ ...ALL_FLAGS, ...off }).map((t) => t.name)).toEqual(['update_state', 'check_state'])
    const call = messages[messages.length - 3]
    expect(call.role).toBe('assistant')
    expect(call.toolCalls?.map((c) => c.name)).toEqual(['check_state'])
  })

  it('leaves the narrator’s story updates and notes to the narrator', () => {
    const history = [playerTurn('t1', 'I knock.', 'No answer.', UPDATE), playerTurn('t2', 'I wait.')]
    const messages = buildPlotterMessages({ ...args(history, undefined, true, BRIEFING), pivot: PIVOT })
    const ids = messages.flatMap((m) => m.toolCalls?.map((c) => c.id) ?? [])
    expect(ids.filter((id) => id.startsWith('dm-'))).toEqual([])
    expect(messages.some((m) => m.content.includes('Nobody answers.'))).toBe(false)
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

  it('shares the story with the narrator request, without the narrator’s story updates', () => {
    const history = [playerTurn('t1', 'I knock.', 'No answer.', UPDATE), playerTurn('t2', 'I wait.')]
    const n = buildNarratorSections(args(history))
    const p = buildPlotterSections({ ...args(history), pivot: PIVOT })
    expect(p.history).toEqual(n.history.filter((m) => !m.toolCalls?.length && m.role !== 'tool'))
    expect(p.chronicle).toEqual(n.chronicle)
    // Each role has its own system prompt; the content stance and scenario
    // follow it in both.
    expect(n.system[0].content).toBe('system prompt')
    expect(p.system[0].content).toBe(PLOTTER_SYSTEM_PROMPT)
    expect(p.system.slice(1, 3)).toEqual(n.system.slice(1, 3))
  })
})

describe('buildReplyNotes', () => {
  const data = {
    state: { scene: { location: 'the mill' } },
    plot: ['The miller returns at dusk'],
    memory: { player: { is: 'A drifter with a debt.' }, Hesta: { is: 'The baker.' } },
    ooc: [],
  }

  it('notes the scene, then the steer, and leaves the rest to the story update', () => {
    const notes = buildReplyNotes(
      [
        { name: 'recall_memory', arguments: '{"names":["Hesta"]}', result: 'ok' },
        { name: 'steer', arguments: '{"text":"Hesta looks up."}', result: 'ok' },
      ],
      data,
      ALL_FLAGS,
    )
    expect(notes).toMatch(/^# Scene\n\n```json\n[\s\S]*"the mill"[\s\S]*```\n\n# Steer\n\nHesta looks up\.$/)
  })

  it('leaves out what is switched off or empty', () => {
    const steer = [{ name: 'steer', arguments: '{"text":"Quiet."}', result: 'ok' }]
    expect(buildReplyNotes(steer, data, { ...ALL_FLAGS, includeWorldState: false })).toBe('# Steer\n\nQuiet.')
    expect(buildReplyNotes(steer, { ...data, state: {} }, { ...ALL_FLAGS, includePlotOutline: false })).toBe('')
  })
})

describe('buildStoryUpdate', () => {
  const data = {
    state: {},
    plot: ['The miller returns at dusk'],
    memory: { player: { is: 'A drifter with a debt.' }, Hesta: { is: 'The baker.' } },
    ooc: ['Keep replies short.'],
  }
  const recall = (names: string[]): BriefingCall => ({
    name: 'recall_memory',
    arguments: JSON.stringify({ names }),
    result: '(stale)',
  })
  const done = (id: string, storyUpdate?: StoryUpdate): Turn =>
    playerTurn(id, 'I wait.', 'Time passes.', storyUpdate)

  it('adds recalled entries as they stand, and the OOC list', () => {
    const update = buildStoryUpdate(
      [],
      [recall(['Hesta', 'Nobody']), { name: 'steer', arguments: '{"text":"Hesta looks up."}', result: 'ok' }],
      data,
      ALL_FLAGS,
    )
    // Entries come from the records, not the recall's result; unknown names
    // and unrecalled entries stay out, and the steer is for the reply alone.
    expect(update).toEqual({ recalled: { Hesta: { is: 'The baker.' } }, ooc: ['Keep replies short.'] })
    const calls = storyUpdateCalls(update ?? {}, undefined)
    expect(calls.map((c) => c.name)).toEqual(['recall_memories', 'get_ooc_instructions'])
    expect(calls[0].result).toMatch(/^# Remembered\n\n```json\n[\s\S]*The baker\.[\s\S]*```$/)
    expect(calls[1].result).toBe('1. Keep replies short.')
    for (const c of calls) expect(c.result).not.toMatch(/stale|Nobody|A drifter|The miller|Hesta looks up/)
  })

  it('adds only what is new to the narrator’s view or changed', () => {
    const earlier = [done('t1', { recalled: { Hesta: { is: 'The baker.' } }, ooc: ['Keep replies short.'] })]
    expect(buildStoryUpdate(earlier, [recall(['Hesta'])], data, ALL_FLAGS)).toBeUndefined()
    const changed = { ...data, memory: { Hesta: { is: 'The widowed baker.' } }, ooc: [] }
    expect(buildStoryUpdate(earlier, [recall(['Hesta'])], changed, ALL_FLAGS)).toEqual({
      changed: { Hesta: { is: 'The widowed baker.' } },
      // A cleared list is news too.
      ooc: [],
    })
  })

  it('says only what changed in an entry the narrator holds, never the rest again', () => {
    // Saoirse's unchanged plans went out again with every new line of her
    // regard for the player, until "four days" filled the narrator's view.
    const held = {
      is: 'a marine biologist',
      wants: { move: 'take up the post in Tromsø', stay: 'one more night' },
      regard: 'wary',
      wearing: { coat: 'yellow raincoat' },
    }
    const earlier = [done('t1', { recalled: { Saoirse: held } })]
    const now = {
      ...data,
      ooc: [],
      memory: { Saoirse: { is: 'a marine biologist', wants: { move: 'take up the post in Tromsø' }, regard: 'warming' } },
    }
    expect(buildStoryUpdate(earlier, [recall(['Saoirse'])], now, ALL_FLAGS)).toEqual({
      changed: { Saoirse: { wants: { stay: null }, regard: 'warming', wearing: null } },
    })
  })

  it('reads later changes on top of the entry it was first given', () => {
    const earlier = [
      done('t1', { recalled: { Hesta: { is: 'The baker.', wants: { shop: 'keep the bakery open' } } } }),
      done('t2', { changed: { Hesta: { is: 'The widowed baker.' } } }),
    ]
    const now = {
      ...data,
      ooc: [],
      memory: { Hesta: { is: 'The widowed baker.', wants: { shop: 'keep the bakery open' } } },
    }
    expect(buildStoryUpdate(earlier, [recall(['Hesta'])], now, ALL_FLAGS)).toBeUndefined()
  })

  it('gives an entry in full again once its full version is out of view', () => {
    // Compaction dropped the turn that gave it; a change alone can't be read.
    const earlier = [done('t2', { changed: { Hesta: { is: 'The widowed baker.' } } })]
    const now = { ...data, ooc: [], memory: { Hesta: { is: 'The widowed baker.', bond: 'wary' } } }
    expect(buildStoryUpdate(earlier, [recall(['Hesta'])], now, ALL_FLAGS)).toEqual({
      recalled: { Hesta: { is: 'The widowed baker.', bond: 'wary' } },
    })
  })

  it('keeps entries the narrator holds up to date without a recall', () => {
    const earlier = [done('t1', { recalled: { Hesta: { is: 'The baker.' } } })]
    const changed = {
      ...data,
      memory: { ...data.memory, Hesta: { is: 'The widowed baker.' }, Tam: { is: 'A new face.' } },
      ooc: [],
    }
    // Tam changed too, but the narrator has never been given Tam.
    expect(buildStoryUpdate(earlier, [], changed, ALL_FLAGS)).toEqual({
      changed: { Hesta: { is: 'The widowed baker.' } },
    })
  })

  it('brings the OOC list back once it is out of view', () => {
    // A failed turn's update was never shown; compaction drops older ones.
    const failed: Turn = {
      ...done('f', { ooc: ['Keep replies short.'] }),
      reply: { id: 'f-reply', model: 'test', text: '(falters)', error: 'boom' },
    }
    expect(buildStoryUpdate([failed, done('t2')], [], data, ALL_FLAGS)).toEqual({
      ooc: ['Keep replies short.'],
    })
    expect(buildStoryUpdate([], [], { ...data, ooc: [] }, ALL_FLAGS)).toBeUndefined()
  })

  it('tells the narrator the whole OOC list first, then only what is added or withdrawn', () => {
    const t1 = playerTurn('t1', 'I knock.', 'No answer.', { ooc: ['Keep replies short.', 'No gore.'] })
    const t2 = playerTurn('t2', 'I wait.', 'Still nothing.', { ooc: ['Keep replies short.', 'Slow the pace.'] })
    const told = (turns: Turn[]) =>
      narrator(turns)
        .filter((m) => m.toolCallId?.endsWith('-get-ooc-instructions'))
        .map((m) => m.content)
    expect(told([t1, t2])).toEqual([
      '1. Keep replies short.\n2. No gore.',
      '# Added\n\n- Slow the pace.\n\n# Withdrawn\n\n- No gore.',
    ])
    // Once compaction folds the first away, the next is told in full.
    expect(told([t2])).toEqual(['1. Keep replies short.\n2. Slow the pace.'])
  })

  it('leaves out what is switched off', () => {
    const update = buildStoryUpdate(
      [],
      [recall(['Hesta']), { name: 'steer', arguments: '{"text":"x"}', result: 'ok' }],
      data,
      { ...ALL_FLAGS, includeMemory: false, includeOoc: false },
    )
    expect(update).toBeUndefined()
  })
})

describe('buildContextInjectionMessages', () => {
  const fullData = {
    state: { scene: 'the mill' },
    plot: ['The miller returns.'],
    memory: { Hesta: { is: 'the baker' } },
    ooc: ['Keep replies short.'],
  }

  it('uses stable ids so identical data produces identical bytes', () => {
    const a = buildContextInjectionMessages(fullData, ALL_FLAGS)
    const b = buildContextInjectionMessages(structuredClone(fullData), ALL_FLAGS)
    expect(a).toEqual(b)
    expect(a[0].toolCalls?.map((c) => c.id)).toEqual([
      'ctx-check-memory',
      'ctx-check-plot-plan',
      'ctx-check-state',
      'ctx-check-ooc',
    ])
  })

  it('leaves out the records that hold nothing', () => {
    const someEmpty = { ...fullData, plot: [], ooc: [] }
    expect(buildContextInjectionMessages(someEmpty, ALL_FLAGS)[0].toolCalls?.map((c) => c.name)).toEqual([
      'check_memory',
      'check_state',
    ])
    expect(buildContextInjectionMessages({ state: {}, plot: [], memory: {}, ooc: [] }, ALL_FLAGS)).toEqual([])
  })

  it('serves payloads as pure data, and per-turn guidance only as size status', () => {
    expect(buildStatePayload({ a: 1 })).not.toMatch(/update_state|STATUS|Plotter/)
    expect(buildMemoryPayload({})).toBe('(no memory yet)')
    const emptyData = { state: {}, plot: [], memory: {}, ooc: [] }
    for (const m of buildContextInjectionMessages(fullData, ALL_FLAGS)) {
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
