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

    // The narrator gets no tools, no rules, and no records — only the
    // briefing, as the DM's own calls after the player's input.
    expect(narratorReq.label).toBe('narrator:0')
    expect(narratorReq.tools ?? []).toEqual([])
    expect(narratorReq.messages.some((m) => m.content.includes('# Live State'))).toBe(false)
    const inputIdx = narratorReq.messages.findIndex((m) => m.role === 'user' && m.content === 'I knock.')
    const briefing = narratorReq.messages[inputIdx + 1]
    expect(briefing.toolCalls?.map((c) => c.name)).toEqual(['update_state', 'steer'])
    expect(narratorReq.messages.slice(inputIdx + 2, inputIdx + 4).map((m) => m.role)).toEqual([
      'tool',
      'tool',
    ])

    expect(result.plotting?.briefing.map((c) => c.name)).toEqual(['update_state', 'steer'])
    expect(result.plotting?.trace.some((e) => e.kind === 'call' && e.name === 'update_state')).toBe(
      true,
    )
    expect(result.trace.some((e) => e.kind === 'call')).toBe(false)
  })

  it('keeps the plan, OOC edits, reads, and rejected calls out of the briefing', async () => {
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [
          { id: 'p1', name: 'future_plot_plan', arguments: '{"op":"append","text":"Next: the miller returns."}' },
          { id: 'o1', name: 'update_ooc', arguments: '{"op":"append","text":"Keep replies short."}' },
          { id: 'r1', name: 'check_state', arguments: '{}' },
          { id: 'bad', name: 'update_memory', arguments: '{"set":{}}' },
        ],
      }),
    )
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [STEER] }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.data.plot).toEqual(['Next: the miller returns.'])
    expect(result.data.ooc).toEqual(['Keep replies short.'])
    expect(result.plotting?.briefing.map((c) => c.name)).toEqual(['steer'])
    const narratorReq = requests()[2]
    const shown = narratorReq.messages.flatMap((m) => m.toolCalls?.map((c) => c.name) ?? [])
    expect(shown).toEqual(['steer'])
    // The OOC list the Plotter left reaches the narrator in its tail.
    expect(narratorReq.messages.some((m) => m.content.includes('1. Keep replies short.'))).toBe(true)
  })

  it('recalls memory entries into the narrator’s view', async () => {
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [{ id: 'm1', name: 'recall_memory', arguments: '{"names":["Hesta","Nobody"]}' }, STEER],
      }),
    )
    mockedModel.mockResolvedValueOnce(completion({ text: 'Hesta looks up.' }))

    await runNarrator(
      { ...CTX, initialData: { ...CTX.initialData, memory: { Hesta: { is: 'The baker.' } } } },
      new AbortController().signal,
    )

    const narratorReq = requests()[1]
    const recalled = narratorReq.messages.find((m) => m.role === 'tool')
    expect(recalled?.content).toContain('The baker.')
    expect(recalled?.content).toContain('(no entries named: Nobody)')
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
    // Only the repaired call reaches the narrator.
    expect(
      result.plotting?.briefing.filter((c) => c.name === 'update_memory').map((c) => c.arguments),
    ).toEqual(['{"set":{"the_mill":"An old mill."}}'])
  })

  it('reminds the Plotter once to steer when it writes prose instead', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Hesta opens the door.' }))
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [STEER] }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(mockedModel).toHaveBeenCalledTimes(3)
    expect(result.plotting?.briefing.map((c) => c.name)).toEqual(['steer'])
    // Its prose stays in its own conversation, ahead of the reminder. (The
    // mock holds the live list, which has grown since.)
    const messages = requests()[1].messages
    const prose = messages.findIndex((m) => m.role === 'assistant' && m.content === 'Hesta opens the door.')
    expect(prose).toBeGreaterThan(0)
    expect(messages[prose + 1].content).toContain('Steer the reply now')
  })

  it('reminds the Plotter once to steer after a batch without one, and only once', async () => {
    const update = { id: 'u', name: 'update_state', arguments: '{"keep":[],"set":{"scene.mood":"still"}}' }
    mockedModel.mockResolvedValueOnce(completion({ toolCalls: [update] }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'DONE' }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(mockedModel).toHaveBeenCalledTimes(3)
    expect(result.text).toBe('Prose.')
    expect(result.plotting?.briefing.map((c) => c.name)).toEqual(['update_state'])
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

  it('replays a turn’s briefing byte for byte in the next turn’s narrator request', async () => {
    const snapshots = recordRequests((req) =>
      isPlotter(req)
        ? completion({
            toolCalls: [
              { id: 'x1', name: 'update_state', arguments: '{"keep":[],"set":{"scene.location":"the mill"}}' },
              { id: 'x2', name: 'steer', arguments: '{"text":"Nobody answers."}' },
            ],
          })
        : completion({ text: 'Nobody answers.' }),
    )
    const first = await runNarrator(CTX, new AbortController().signal)
    const done: Turn = {
      ...CTX.history[0],
      briefing: first.plotting?.briefing,
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

    const firstNarrator = snapshots[1]
    const secondNarrator = snapshots[3]
    // Everything but the first request's tail (OOC list, reminder) is reused.
    const shared = firstNarrator.slice(0, -2)
    expect(shared[shared.length - 1].role).toBe('tool')
    expect(secondNarrator.slice(0, shared.length)).toEqual(shared)
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
    expect(result.trace.some((e) => e.kind === 'call')).toBe(false)
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

  it('offers the briefing tools, calls forbidden, when a provider rejects calls without them', async () => {
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
    expect(narratorReqs[1].tools?.map((t) => t.name)).toEqual([
      'update_memory',
      'recall_memory',
      'steer',
      'update_state',
    ])
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
  it('names only the enabled subsystems and their steps', () => {
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
    expect(memoryOnly).not.toContain('`steer`')
    expect(memoryOnly).not.toContain('check_state')
    expect(memoryOnly).not.toContain('future_plot_plan')
    expect(memoryOnly).not.toContain('update_ooc')
    // Without the plan there is no steer, so doing nothing is allowed.
    expect(memoryOnly).toContain('reply with only the word DONE')

    const all = buildPlotterInstruction(CTX.flags, CTX.initialData, 4000)
    expect(all).toContain('Before the narrator writes the reply')
    expect(all).toContain('`update_ooc`')
    // With the plan on, the Plotter delivers a development and steers every
    // reply, after its updates and recalls.
    expect(all).toContain('Deliver what earlier turns set up')
    expect(all).toContain('Steer every reply')
    expect(all).toContain('then `recall_memory`, then `steer`')
    expect(all).not.toContain('reply with only the word DONE')
    // Choice wording pulls models towards ending on a choice.
    expect(all).not.toMatch(/decision|choice|decide|choose/i)
    // Steers end on an event, not on a cue for the player.
    expect(all).toContain('the moment the reply stops on: a line of dialogue or an action by someone in the world')
    expect(all).not.toMatch(/respond to/i)
    // Size status rides along; memory's only once it grows long.
    expect(all).toContain('STATUS: state size')
    expect(all).not.toContain('Memory: STATUS')
    const bigMemory = { ...CTX.initialData, memory: { notes: { is: 'x'.repeat(9000) } } }
    expect(buildPlotterInstruction(CTX.flags, bigMemory, 4000)).toContain('Memory: STATUS')
  })
})
