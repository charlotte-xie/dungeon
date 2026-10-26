import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EmptyNarrativeError,
  MAX_PLOTTER_ITERATIONS,
  buildPlotterInstruction,
  runNarrator,
  type NarratorContext,
  type Plotting,
} from './narrator'
import { completeModel } from '../model/client'
import type { ModelCompletion, ModelCompletionRequest, ModelMessage } from '../model/types'
import type { Turn } from '../types'

vi.mock('../model/client', () => ({ completeModel: vi.fn() }))
const mockedModel = vi.mocked(completeModel)

function completion(partial: Partial<ModelCompletion>): ModelCompletion {
  return {
    text: '',
    reasoning: [],
    toolCalls: [],
    anomalies: [],
    finishReason: 'stop',
    raw: {},
    ...partial,
  }
}

const CTX: NarratorContext = {
  systemPrompt: 'sys',
  model: 'test-model',
  apiKey: 'k',
  baseUrl: 'http://x',
  protocol: 'chat-completions',
  slots: { scenario: 'A haunted mill.', styleGuide: '' },
  chronicle: [],
  history: [
    {
      id: 't1',
      kind: 'player',
      input: 'I knock.',
      reply: { id: 't1-reply', model: 'test-model', text: '' },
    },
  ],
  initialData: { state: {}, plot: [], memory: {}, ooc: [] },
  sampling: { temperature: 0.7 },
  stateCleanupThreshold: 4000,
  includePriorPlayerTurns: true,
  reminderAsSystem: true,
  flags: {
    includeWorldState: true,
    includePlotOutline: true,
    includeMemory: true,
    includeOoc: true,
  },
  nsfw: false,
}

const isPlotter = (req: ModelCompletionRequest) => req.label?.startsWith('plotter') ?? false

// With the plot plan on, a Plotter turn ends cleanly once it has steered.
const STEER = { id: 'st', name: 'steer', arguments: '{"text":"The story moves on."}' }

function requests() {
  return mockedModel.mock.calls.map(([req]) => req)
}

// Snapshots each request's messages as sent: the loops keep appending to the
// live list after a request goes out.
function recordRequests(
  reply: (req: ModelCompletionRequest, n: number) => ModelCompletion,
): ModelMessage[][] {
  const snapshots: ModelMessage[][] = []
  mockedModel.mockImplementation(async (req) => {
    snapshots.push(req.messages.map((m) => ({ ...m })))
    return reply(req, snapshots.length)
  })
  return snapshots
}

describe('runNarrator: the Plotter plans, then the narrator writes', () => {
  beforeEach(() => {
    mockedModel.mockReset()
  })

  it('plans first, then the narrator writes from the briefing with no tools', async () => {
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [
          { id: 'c1', name: 'update_state', arguments: '{"keep":[],"set":{"scene.location":"the mill"}}' },
          { id: 'c2', name: 'steer', arguments: '{"text":"The door gives under your knock."}' },
        ],
      }),
    )
    mockedModel.mockResolvedValueOnce(completion({ text: 'The door creaks open.' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('The door creaks open.')
    expect(result.data.state).toEqual({ scene: { location: 'the mill' } })
    // A clean batch ends the Plotter's phase — no confirmation round-trip.
    expect(mockedModel).toHaveBeenCalledTimes(2)

    const [plotterReq, narratorReq] = requests()
    expect(plotterReq.label).toBe('plotter:0')
    expect(plotterReq.tools?.map((t) => t.name)).toEqual(
      expect.arrayContaining(['update_state', 'update_memory', 'recall_memory', 'steer']),
    )
    expect(plotterReq.messages.some((m) => m.content.includes('# Live State'))).toBe(true)
    expect(plotterReq.messages.some((m) => m.toolCalls?.some((c) => c.id === 'ctx-check-state'))).toBe(
      true,
    )

    // The narrator gets no tools, no rules, and no record-keeping — only its
    // notes for the reply, as one call of its own after the player's input.
    expect(narratorReq.label).toBe('narrator:0')
    expect(narratorReq.tools ?? []).toEqual([])
    expect(narratorReq.messages.some((m) => m.content.includes('# Live State'))).toBe(false)
    const inputIdx = narratorReq.messages.findIndex((m) => m.role === 'user' && m.content === 'I knock.')
    const call = narratorReq.messages[inputIdx + 1]
    expect(call.toolCalls?.map((c) => c.name)).toEqual(['reply_notes'])
    const notes = narratorReq.messages[inputIdx + 2]
    expect(notes.role).toBe('tool')
    expect(notes.content).toContain('"location": "the mill"')
    expect(notes.content).toContain('# Steer\n\nThe door gives under your knock.')
    expect(notes.content).not.toContain('update_state')

    expect(result.plotting?.briefing.map((c) => c.name)).toEqual(['steer'])
    expect(result.plotting?.trace.some((e) => e.kind === 'call' && e.name === 'update_state')).toBe(
      true,
    )
    // The narrator's trace shows the notes it was given, and nothing else.
    expect(result.trace.filter((e) => e.kind === 'call')).toEqual([
      { kind: 'call', name: 'reply_notes', arguments: '{}', result: notes.content },
    ])
  })

  it('keeps the plan, OOC edits, reads, updates, and rejected calls out of the briefing', async () => {
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [
          { id: 'p1', name: 'future_plot_plan', arguments: '{"op":"insert","text":"The miller returns."}' },
          { id: 'o1', name: 'update_ooc', arguments: '{"op":"append","text":"Keep replies short."}' },
          { id: 'r1', name: 'check_state', arguments: '{}' },
          { id: 'bad', name: 'update_memory', arguments: '{"set":{}}' },
        ],
      }),
    )
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [STEER] }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.data.plot).toEqual(['The miller returns.'])
    expect(result.data.ooc).toEqual(['Keep replies short.'])
    expect(result.plotting?.briefing.map((c) => c.name)).toEqual(['steer'])
    // The OOC list the Plotter changed reaches the narrator in the turn's
    // story update; the plan never does.
    expect(result.plotting?.storyUpdate).toEqual({ ooc: ['Keep replies short.'] })
    const narratorReq = requests()[2]
    const shown = narratorReq.messages.flatMap((m) => m.toolCalls?.map((c) => c.name) ?? [])
    expect(shown).toEqual(['story_update', 'reply_notes'])
    expect(narratorReq.messages.some((m) => m.content.includes('The miller returns.'))).toBe(false)
    expect(narratorReq.messages.some((m) => m.content.includes('1. Keep replies short.'))).toBe(true)
  })

  it('recalls memory entries into the story update, as they stand after the updates', async () => {
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [
          { id: 'm1', name: 'recall_memory', arguments: '{"names":["Hesta","Nobody"]}' },
          { id: 'm2', name: 'update_memory', arguments: '{"set":{"Hesta":{"is":"The widowed baker."}}}' },
          STEER,
        ],
      }),
    )
    mockedModel.mockResolvedValueOnce(completion({ text: 'Hesta looks up.' }))

    await runNarrator(
      { ...CTX, initialData: { ...CTX.initialData, memory: { Hesta: { is: 'The baker.' } } } },
      new AbortController().signal,
    )

    const narratorReq = requests()[1]
    const update = narratorReq.messages.find((m) => m.role === 'tool' && m.toolCallId?.endsWith('-update'))
    expect(update?.content).toContain('The widowed baker.')
    expect(update?.content).not.toContain('The baker.')
    expect(update?.content).not.toContain('Nobody')
  })

  it('reports the plotting before the narrator writes', async () => {
    const order: string[] = []
    mockedModel.mockImplementation(async (req) => {
      order.push(`${req.label} request`)
      return isPlotter(req)
        ? completion({ toolCalls: [STEER], reasoningTokens: 5 })
        : completion({ text: 'The door creaks open.' })
    })

    let plotting: Plotting | undefined
    await runNarrator(CTX, new AbortController().signal, {
      onPlotted: (p) => {
        order.push('plotted')
        plotting = p
      },
    })

    expect(order).toEqual(['plotter:0 request', 'plotted', 'narrator:0 request'])
    expect(plotting).toMatchObject({ reasoningTokens: 5 })
    expect(plotting?.briefing.map((c) => c.name)).toEqual(['steer'])
  })

  it('routes plotting and narration independently and attributes reasoning to each', async () => {
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [STEER], reasoningTokens: 5 }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'The door opens.', reasoningTokens: 12 }))
    const result = await runNarrator(
      {
        ...CTX,
        model: 'narrator-model',
        reasoningEffort: 'none',
        plotterModel: 'plotter-model',
        plotterReasoning: 'low',
      },
      new AbortController().signal,
    )
    expect(requests()[0]).toMatchObject({ model: 'plotter-model', reasoningEffort: 'low' })
    expect(requests()[1]).toMatchObject({ model: 'narrator-model', reasoningEffort: 'none' })
    expect(result.plotting?.reasoningTokens).toBe(5)
    expect(result.reasoningTokens).toBe(12)
  })

  it('gives the Plotter and the narrator their own prompt-cache keys', async () => {
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [STEER] }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    await runNarrator({ ...CTX, cacheKey: 'adventure-1' }, new AbortController().signal)
    const keys = mockedModel.mock.calls.map(([, connection]) => connection.cacheKey)
    expect(keys).toEqual(['adventure-1-plotter', 'adventure-1-narrator'])
  })

  it('uses the narrator model for the Plotter when the plotter model is blank', async () => {
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [STEER] }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    await runNarrator({ ...CTX, plotterModel: '  ', plotterReasoning: 'low' }, new AbortController().signal)
    expect(requests()[0]).toMatchObject({ model: CTX.model, reasoningEffort: 'low' })
  })

  it('iterates after a context read so the Plotter can act on it', async () => {
    mockedModel.mockResolvedValueOnce(
      completion({ toolCalls: [{ id: 'r1', name: 'check_state', arguments: '{}' }] }),
    )
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [{ id: 'c1', name: 'update_state', arguments: '{"keep":[],"set":{"scene.mood":"tense"}}' }, STEER],
      }),
    )
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.data.state).toEqual({ scene: { mood: 'tense' } })
    expect(mockedModel).toHaveBeenCalledTimes(3)
  })

  it('nudges a repair iteration when a call is rejected', async () => {
    mockedModel.mockResolvedValueOnce(
      completion({ toolCalls: [{ id: 'bad', name: 'update_memory', arguments: '{"set":{}}' }] }),
    )
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [{ id: 'ok', name: 'update_memory', arguments: '{"set":{"the_mill":"An old mill."}}' }, STEER],
      }),
    )
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.data.memory).toEqual({ the_mill: 'An old mill.' })
    expect(mockedModel).toHaveBeenCalledTimes(3)
    expect(result.plotting?.trace.some((e) => e.kind === 'thought' && e.text.includes('rejected'))).toBe(
      true,
    )
  })

  it('reminds the Plotter once to steer when it writes prose instead, and has it make a call', async () => {
    const snapshots = recordRequests((req, n) =>
      n === 1
        ? completion({ text: 'Hesta opens the door.' })
        : isPlotter(req)
          ? completion({ toolCalls: [STEER] })
          : completion({ text: 'Prose.' }),
    )

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(mockedModel).toHaveBeenCalledTimes(3)
    expect(result.plotting?.briefing.map((c) => c.name)).toEqual(['steer'])
    // Its prose stays out of its conversation: fed back, it was copied word
    // for word in place of the steer. The reminder only appends.
    const [plotter0, plotter1] = snapshots
    expect(plotter1.slice(0, plotter0.length)).toEqual(plotter0)
    expect(plotter1).toHaveLength(plotter0.length + 1)
    expect(plotter1.at(-1)).toMatchObject({ role: 'system' })
    expect(plotter1.at(-1)?.content).toContain('`steer`')
    expect(plotter1.some((m) => m.content === 'Hesta opens the door.')).toBe(false)
    expect(result.plotting?.trace.some((e) => e.kind === 'thought' && e.text === 'Hesta opens the door.')).toBe(true)
    // The request after the reminder has it make a call; no other does.
    expect(requests().map((r) => r.toolChoice)).toEqual([undefined, 'required', undefined])
  })

  it('sets the story up on the opening, and records each reply after it', async () => {
    const snapshots = recordRequests((req) =>
      isPlotter(req) ? completion({ toolCalls: [STEER] }) : completion({ text: 'Prose.' }),
    )
    const opening: NarratorContext = {
      ...CTX,
      history: [
        {
          id: 't0',
          kind: 'bootstrap',
          input: '(OOC: Begin the story.)',
          reply: { id: 't0-reply', model: 'test-model', text: '' },
        },
      ],
    }
    await runNarrator(opening, new AbortController().signal)
    await runNarrator(CTX, new AbortController().signal)

    const [openingPlotter, , replyPlotter] = snapshots
    expect(openingPlotter.at(-1)?.content).toBe(
      buildPlotterInstruction(CTX.flags, CTX.initialData, 4000, 'bootstrap'),
    )
    expect(replyPlotter.at(-1)?.content).toBe(buildPlotterInstruction(CTX.flags, CTX.initialData, 4000, 'player'))
  })

  it('reminds the Plotter once to steer after a batch without one, and only once', async () => {
    const update = { id: 'u', name: 'update_state', arguments: '{"keep":[],"set":{"scene.mood":"still"}}' }
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [update] }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'DONE' }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(mockedModel).toHaveBeenCalledTimes(3)
    expect(result.text).toBe('Prose.')
    expect(result.plotting?.briefing).toEqual([])
  })

  it('still writes the reply when the Plotter fails', async () => {
    mockedModel.mockRejectedValueOnce(new Error('network down'))
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('Prose.')
    expect(result.data.state).toEqual({})
    expect(result.plotting?.error).toBe('network down')
    expect(
      result.plotting?.trace.some((e) => e.kind === 'thought' && e.text.includes('plotter failed')),
    ).toBe(true)
  })

  it('caps the Plotter loop even if the model keeps failing', async () => {
    mockedModel.mockImplementation(async (req) =>
      isPlotter(req)
        ? completion({ toolCalls: [{ id: 'cX', name: 'update_memory', arguments: '{"set":{}}' }] })
        : completion({ text: 'Prose.' }),
    )

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('Prose.')
    expect(result.data.memory).toEqual({})
    expect(mockedModel).toHaveBeenCalledTimes(MAX_PLOTTER_ITERATIONS + 1)
  })

  it('keeps each role’s requests append-only within a turn', async () => {
    const snapshots = recordRequests((_req, n) => {
      // A rejected plotter call, then DONE; an empty narrator reply, then prose.
      if (n === 1) {
        return completion({ toolCalls: [{ id: 'bad', name: 'update_memory', arguments: '{"set":{}}' }] })
      }
      if (n === 2) return completion({ toolCalls: [STEER] })
      if (n === 3) return completion({})
      return completion({ text: 'Prose.' })
    })

    await runNarrator(CTX, new AbortController().signal)

    expect(snapshots).toHaveLength(4)
    const [plotter0, plotter1, narrator0, narrator1] = snapshots
    expect(plotter1.slice(0, plotter0.length)).toEqual(plotter0)
    expect(narrator1.slice(0, narrator0.length)).toEqual(narrator0)
    // The nudge repeats the turn reminder after the empty reply.
    expect(narrator1).toHaveLength(narrator0.length + 1)
    expect(narrator1[narrator1.length - 1]).toEqual(narrator0[narrator0.length - 1])
  })

  it('keeps the story update in history and the notes for the current reply only', async () => {
    const snapshots = recordRequests((req, n) =>
      isPlotter(req)
        ? completion({
            // The first turn recalls Hesta; the second only changes her.
            toolCalls: [
              { id: 'x1', name: 'update_memory', arguments: `{"set":{"Hesta":{"is":"Baker ${n}."}}}` },
              ...(n === 1 ? [{ id: 'x2', name: 'recall_memory', arguments: '{"names":["Hesta"]}' }] : []),
              { id: 'x3', name: 'steer', arguments: `{"text":"Steer ${n}."}` },
            ],
          })
        : completion({ text: 'Nobody answers.' }),
    )
    const first = await runNarrator(CTX, new AbortController().signal)
    expect(first.plotting?.storyUpdate).toEqual({ recalled: { Hesta: { is: 'Baker 1.' } } })
    const done: Turn = {
      ...CTX.history[0],
      storyUpdate: first.plotting?.storyUpdate,
      reply: { ...CTX.history[0].reply, text: first.text },
    }
    const next: Turn = {
      id: 't2',
      kind: 'player',
      input: 'I knock again.',
      reply: { id: 't2-reply', model: 'test-model', text: '' },
    }
    await runNarrator(
      { ...CTX, history: [done, next], initialData: first.data },
      new AbortController().signal,
    )

    const [, firstNarrator, secondPlotter, secondNarrator] = snapshots
    // Everything up to the first request's story update is reused; its notes
    // and reminder were its tail.
    const notesAt = firstNarrator.findIndex((m) => m.toolCalls?.[0]?.name === 'reply_notes')
    const shared = firstNarrator.slice(0, notesAt)
    expect(shared[shared.length - 1].content).toContain('Baker 1.')
    expect(secondNarrator.slice(0, shared.length)).toEqual(shared)
    expect(firstNarrator.some((m) => m.content.includes('Steer 1.'))).toBe(true)
    expect(secondNarrator.some((m) => m.content.includes('Steer 1.'))).toBe(false)
    expect(secondNarrator.some((m) => m.content.includes('Steer 3.'))).toBe(true)
    // Hesta changed without a recall: the narrator, who holds her, is told.
    const updates = secondNarrator.filter((m) => m.toolCallId?.endsWith('-update'))
    expect(updates.map((m) => m.content.includes('Baker 3.'))).toEqual([false, true])
    // The Plotter sees the story updates the narrator was given.
    expect(secondPlotter.some((m) => m.toolCallId?.endsWith('-update'))).toBe(true)
  })

  it('never executes a call the narrator returns, and nudges it for prose', async () => {
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [STEER] }))
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [{ id: 's1', name: 'update_state', arguments: '{"keep":[],"set":{"x":1}}' }],
      }),
    )
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('Prose.')
    expect(result.data.state).toEqual({})
    expect(result.trace.some((e) => e.kind === 'call' && e.name === 'update_state')).toBe(false)
    expect(result.trace.some((e) => e.kind === 'thought' && e.text.includes('nudge'))).toBe(true)
  })

  it('gives up when the narrator is still empty after one nudge', async () => {
    mockedModel.mockImplementation(async (req) =>
      isPlotter(req) ? completion({ toolCalls: [STEER] }) : completion({}),
    )

    await expect(runNarrator(CTX, new AbortController().signal)).rejects.toBeInstanceOf(
      EmptyNarrativeError,
    )
    expect(mockedModel).toHaveBeenCalledTimes(3)
  })

  it('offers the narrator’s own tools, calls forbidden, when a provider rejects calls without them', async () => {
    const ctx = { ...CTX, baseUrl: 'http://strict-provider' }
    let narratorCalls = 0
    mockedModel.mockImplementation(async (req) => {
      if (isPlotter(req)) {
        return completion({ toolCalls: [{ id: 's', name: 'steer', arguments: '{"text":"Quiet."}' }] })
      }
      narratorCalls++
      if (narratorCalls === 1) {
        throw new Error('narrator:0 API 400: {"error":"tool messages require tools to be defined"}')
      }
      return completion({ text: 'Quiet.' })
    })

    const result = await runNarrator(ctx, new AbortController().signal)
    await runNarrator(ctx, new AbortController().signal)

    expect(result.text).toBe('Quiet.')
    const narratorReqs = requests().filter((r) => !isPlotter(r))
    expect(narratorReqs[0].tools).toBeUndefined()
    expect(narratorReqs[1].tools?.map((t) => t.name)).toEqual(['story_update', 'reply_notes'])
    expect(narratorReqs[1].toolChoice).toBe('none')
    // Remembered for the session: the next turn sends them straight away.
    expect(narratorReqs[2].toolChoice).toBe('none')
    expect(
      result.trace.some((e) => e.kind === 'thought' && e.text.includes('rejected replayed tool calls')),
    ).toBe(true)
  })

  it('records the provider’s prompt and cached token counts per request', async () => {
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [STEER], promptTokens: 1200, cachedTokens: 1100 }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.', promptTokens: 1000, cachedTokens: 900 }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.plotting?.trace).toContainEqual({
      kind: 'usage',
      label: 'plotter:0',
      promptTokens: 1200,
      cachedTokens: 1100,
      durationMs: expect.any(Number),
    })
    expect(result.trace).toContainEqual({
      kind: 'usage',
      label: 'narrator:0',
      promptTokens: 1000,
      cachedTokens: 900,
      durationMs: expect.any(Number),
    })
  })

  it('skips the Plotter when no subsystems are enabled', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))

    const result = await runNarrator(
      {
        ...CTX,
        flags: {
          includeWorldState: false,
          includePlotOutline: false,
          includeMemory: false,
          includeOoc: false,
        },
      },
      new AbortController().signal,
    )

    expect(result.text).toBe('Prose.')
    expect(result.plotting).toBeUndefined()
    expect(mockedModel).toHaveBeenCalledTimes(1)
  })
})

describe('buildPlotterInstruction', () => {
  const noPlan = { ...CTX.flags, includePlotOutline: false }

  it('names only the enabled records and their tools, updates before recalls before the steer', () => {
    const memoryOnly = buildPlotterInstruction(
      {
        includeWorldState: false,
        includePlotOutline: false,
        includeMemory: true,
        includeOoc: false,
      },
      CTX.initialData,
      4000,
    )
    expect(memoryOnly).toContain('check_memory')
    expect(memoryOnly).toContain('`update_memory`')
    expect(memoryOnly).toContain('`recall_memory`')
    for (const name of ['`steer`', 'check_state', 'future_plot_plan', 'update_ooc']) {
      expect(memoryOnly).not.toContain(name)
    }

    const all = buildPlotterInstruction(CTX.flags, CTX.initialData, 4000)
    for (const name of ['`update_memory`', '`future_plot_plan`', '`update_state`', '`update_ooc`', '`recall_memory`', '`steer`']) {
      expect(all).toContain(name)
    }
    expect(all).toContain('then `recall_memory`, then `steer`')
  })

  it('lets the Plotter make no calls only when there is no steer to give', () => {
    expect(buildPlotterInstruction(noPlan, CTX.initialData, 4000)).toContain('DONE')
    expect(buildPlotterInstruction(CTX.flags, CTX.initialData, 4000)).not.toContain('DONE')
  })

  it('gives the opening, a reply and a Continue their own steps', () => {
    const reply = buildPlotterInstruction(CTX.flags, CTX.initialData, 4000)
    const opening = buildPlotterInstruction(CTX.flags, CTX.initialData, 4000, 'bootstrap')
    const continuing = buildPlotterInstruction(CTX.flags, CTX.initialData, 4000, 'continue')
    expect(new Set([reply, opening, continuing]).size).toBe(3)
    // The opening has no reply yet to record from, and pointing a Continue
    // at the player's last action had steers retell it.
    expect(opening).not.toMatch(/last reply|last action/)
    expect(continuing).not.toContain('last action')
    // A switched-off record is never mentioned.
    expect(buildPlotterInstruction(noPlan, CTX.initialData, 4000, 'bootstrap')).not.toMatch(/plan|steer/i)
  })

  it('keeps out wording that pulled the models the wrong way', () => {
    for (const kind of [undefined, 'bootstrap', 'continue'] as const) {
      const text = buildPlotterInstruction(CTX.flags, CTX.initialData, 4000, kind)
      // Choice wording pulled models towards ending on a choice.
      expect(text).not.toMatch(/decision|choice|decide|choose/i)
      // Asking what a reply should "achieve" drew the player's character
      // into the outcome, and the narrator spoke for them on Continue.
      expect(text).not.toContain('achieve')
      // Scripting the last line turned a fight into attack after attack.
      expect(text).not.toMatch(/closes? on|camera|how far/i)
      expect(text).not.toMatch(/respond to/i)
    }
  })

  it('carries size status for the records, memory’s only once it grows long', () => {
    const all = buildPlotterInstruction(CTX.flags, CTX.initialData, 4000)
    expect(all).toContain('STATUS: state size')
    expect(all).not.toContain('Memory: STATUS')
    const bigMemory = { ...CTX.initialData, memory: { notes: { is: 'x'.repeat(9000) } } }
    expect(buildPlotterInstruction(CTX.flags, bigMemory, 4000)).toContain('Memory: STATUS')
  })
})

describe('runNarrator: live updates', () => {
  beforeEach(() => {
    mockedModel.mockReset()
  })

  it("streams the Plotter's stage and thinking, and the reply so far, when asked", async () => {
    mockedModel.mockImplementation(async (req) => {
      if (isPlotter(req)) {
        req.onStream?.({ kind: 'reasoning', delta: 'Weigh ' })
        req.onStream?.({ kind: 'reasoning', delta: 'the door.' })
        req.onStream?.({ kind: 'call', name: 'update_memory' })
        req.onStream?.({ kind: 'call', name: 'recall_memory' })
        req.onStream?.({ kind: 'call', name: 'steer' })
        return completion({ toolCalls: [STEER] })
      }
      req.onStream?.({ kind: 'text', delta: 'The door ' })
      req.onStream?.({ kind: 'text', delta: 'opens.' })
      return completion({ text: 'The door opens.' })
    })
    const stages: string[] = []
    const thinking: string[] = []
    const narration: string[] = []
    const result = await runNarrator(CTX, new AbortController().signal, {
      onPlotterStage: (stage) => stages.push(stage),
      onPlotterThinking: (text) => thinking.push(text),
      onNarration: (text) => narration.push(text),
    })
    expect(stages).toEqual(['planning', 'records', 'recall', 'steer'])
    expect(thinking).toEqual(['Weigh ', 'Weigh the door.'])
    expect(narration).toEqual(['', 'The door ', 'The door opens.'])
    expect(result.text).toBe('The door opens.')
  })

  it('asks for no stream without a listener', async () => {
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [STEER] }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    await runNarrator(CTX, new AbortController().signal)
    expect(requests().map((req) => req.onStream)).toEqual([undefined, undefined])
  })

  it('starts the reply shown again when an empty reply is retried', async () => {
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [STEER] }))
    mockedModel.mockImplementationOnce(async (req) => {
      req.onStream?.({ kind: 'text', delta: '   ' })
      return completion({ text: '' })
    })
    mockedModel.mockImplementationOnce(async (req) => {
      req.onStream?.({ kind: 'text', delta: 'Whole.' })
      return completion({ text: 'Whole.' })
    })
    const narration: string[] = []
    await runNarrator(CTX, new AbortController().signal, { onNarration: (text) => narration.push(text) })
    expect(narration).toEqual(['', '   ', '', 'Whole.'])
  })
})
