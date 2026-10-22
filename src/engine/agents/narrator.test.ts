import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EmptyNarrativeError,
  MAX_PLOTTER_ITERATIONS,
  buildPlotterInstruction,
  runNarrator,
  type Narration,
  type NarratorContext,
} from './narrator'
import { completeModel } from '../model/client'
import type { ModelCompletion, ModelMessage } from '../model/types'

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

describe('runNarrator two-phase flow', () => {
  beforeEach(() => {
    mockedModel.mockReset()
  })

  it('narrates without tools, then the Plotter records updates in its own request', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'The door creaks open.' }))
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [
          {
            id: 'c1',
            name: 'update_state',
            arguments: '{"keep":[],"set":{"scene.location":"the mill"}}',
          },
        ],
      }),
    )

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('The door creaks open.')
    expect(result.data.state).toEqual({ scene: { location: 'the mill' } })
    // A clean batch of updates ends the phase — no confirmation round-trip.
    expect(mockedModel).toHaveBeenCalledTimes(2)
    // The phases record to separate traces for the UI.
    expect(result.trace.some((e) => e.kind === 'call')).toBe(false)
    expect(
      result.plotterTrace?.some((e) => e.kind === 'call' && e.name === 'update_state'),
    ).toBe(true)

    const narratorReq = mockedModel.mock.calls[0][0]
    const plotterReq = mockedModel.mock.calls[1][0]
    // The narrator is offered no tools and reads no record-keeping rules;
    // the records reach it as plain text.
    expect(narratorReq.tools ?? []).toEqual([])
    expect(narratorReq.messages.some((m) => m.role === 'tool' || m.toolCalls?.length)).toBe(false)
    expect(narratorReq.messages.some((m) => m.content.includes('# Live State'))).toBe(false)
    expect(narratorReq.messages.some((m) => m.content.includes('**Live state**'))).toBe(true)
    // The Plotter gets the tools, the rules, and the records as tool results.
    expect(plotterReq.label).toBe('plotter:0')
    expect(plotterReq.tools?.map((t) => t.name)).toContain('update_state')
    expect(plotterReq.messages.some((m) => m.content.includes('# Live State'))).toBe(true)
    expect(plotterReq.messages.some((m) => m.toolCalls?.some((c) => c.id === 'ctx-check-state'))).toBe(
      true,
    )
    // The prose follows the records and precedes the pivot instruction, and
    // the request carries no narrator turn reminder. (The mock holds the live
    // list, which the loop has since extended with the tool exchange.)
    const proseIdx = plotterReq.messages.findIndex(
      (m) => m.role === 'assistant' && m.content === 'The door creaks open.',
    )
    expect(plotterReq.messages[proseIdx - 1].role).toBe('tool')
    expect(plotterReq.messages[proseIdx + 1].content).toContain('Plotter')
    expect(
      plotterReq.messages.some((m) => m.content.startsWith("Reply to the player's latest input")),
    ).toBe(false)
  })

  it('ends the plotter phase on a DONE reply with no tool calls', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'DONE' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('Prose.')
    expect(result.data.state).toEqual({})
    expect(mockedModel).toHaveBeenCalledTimes(2)
    // The bare DONE acknowledgement is not worth a trace entry; only the
    // request's timing is recorded.
    expect(result.plotterTrace?.map((e) => e.kind)).toEqual(['usage'])
  })

  it('hands over the prose before the plotter phase begins', async () => {
    const order: string[] = []
    mockedModel.mockImplementationOnce(async () => {
      order.push('narrator request')
      return completion({ text: 'The door creaks open.', reasoningTokens: 12 })
    })
    mockedModel.mockImplementationOnce(async () => {
      order.push('plotter request')
      return completion({ text: 'DONE' })
    })

    let narration: Narration | undefined
    await runNarrator(CTX, new AbortController().signal, {
      onNarrated: (n) => {
        order.push('narrated')
        narration = n
      },
    })

    expect(order).toEqual(['narrator request', 'narrated', 'plotter request'])
    expect(narration).toMatchObject({ text: 'The door creaks open.', reasoningTokens: 12 })
    expect(narration?.trace.some((e) => e.kind === 'usage' && e.label === 'narrator:0')).toBe(true)
  })

  it('routes narration and plotting independently and attributes reasoning to each phase', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'The door opens.', reasoningTokens: 12 }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'DONE', reasoningTokens: 5 }))
    const result = await runNarrator({
      ...CTX,
      model: 'grok-4.7',
      reasoningEffort: 'low',
      plotterModel: 'grok-4.3',
      plotterReasoning: 'none',
    }, new AbortController().signal)
    expect(mockedModel.mock.calls[0][0]).toMatchObject({ model: 'grok-4.7', reasoningEffort: 'low' })
    expect(mockedModel.mock.calls[1][0]).toMatchObject({ model: 'grok-4.3', reasoningEffort: 'none' })
    expect(result.reasoningTokens).toBe(12)
    expect(result.plotterReasoningTokens).toBe(5)
  })

  it('uses the narrator model when the plotter model is blank', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'DONE' }))
    await runNarrator({ ...CTX, plotterModel: '  ', plotterReasoning: 'low' }, new AbortController().signal)
    expect(mockedModel.mock.calls[1][0]).toMatchObject({ model: CTX.model, reasoningEffort: 'low' })
  })

  it('iterates after a context read so the model can act on it', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    mockedModel.mockResolvedValueOnce(
      completion({ toolCalls: [{ id: 'r1', name: 'check_state', arguments: '{}' }] }),
    )
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [
          { id: 'c1', name: 'update_state', arguments: '{"keep":[],"set":{"scene.mood":"tense"}}' },
        ],
      }),
    )

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.data.state).toEqual({ scene: { mood: 'tense' } })
    expect(mockedModel).toHaveBeenCalledTimes(3)
  })

  it('nudges a repair iteration when a call is rejected', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [{ id: 'bad', name: 'update_memory', arguments: '{"set":{}}' }],
      }),
    )
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [
          { id: 'ok', name: 'update_memory', arguments: '{"set":{"the_mill":"An old mill."}}' },
        ],
      }),
    )

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.data.memory).toEqual({ the_mill: 'An old mill.' })
    expect(mockedModel).toHaveBeenCalledTimes(3)
    expect(
      result.plotterTrace?.some((e) => e.kind === 'thought' && e.text.includes('rejected')),
    ).toBe(true)
  })

  it('keeps the prose and prior updates when the plotter phase fails', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    mockedModel.mockRejectedValueOnce(new Error('network down'))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('Prose.')
    expect(result.data.state).toEqual({})
    expect(
      result.plotterTrace?.some((e) => e.kind === 'thought' && e.text.includes('plotter failed')),
    ).toBe(true)
    expect(result.plotterError).toBe('network down')
  })

  it('caps the plotter loop even if the model keeps failing', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    mockedModel.mockResolvedValue(
      completion({
        toolCalls: [{ id: 'cX', name: 'update_memory', arguments: '{"set":{}}' }],
      }),
    )

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('Prose.')
    expect(result.data.memory).toEqual({})
    expect(mockedModel).toHaveBeenCalledTimes(1 + MAX_PLOTTER_ITERATIONS)
  })

  it('builds a pivot that names only the enabled subsystems', () => {
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
    expect(memoryOnly).not.toContain('check_state')
    expect(memoryOnly).not.toContain('update_state')
    expect(memoryOnly).not.toContain('future_plot_plan')
    expect(memoryOnly).not.toContain('update_ooc')
    // A single subsystem needs no distinction clause.
    expect(memoryOnly).not.toContain('Keep the subsystems distinct')

    const all = buildPlotterInstruction(CTX.flags, CTX.initialData, 4000)
    expect(all).toContain('check_state')
    expect(all).toContain('`update_state`')
    expect(all).toContain('`update_ooc`')
    expect(all).toContain('Keep the subsystems distinct')
    // The per-subsystem guidance and size status ride in the pivot.
    expect(all).toContain('STATUS: state size')
    expect(all).toContain('Memory: ')
  })

  it('keeps each role’s requests append-only within a turn', async () => {
    const snapshots: ModelMessage[][] = []
    mockedModel.mockImplementation(async (req) => {
      snapshots.push(req.messages.map((m) => ({ ...m })))
      // An empty narrator reply, then prose; a rejected plotter call, then DONE.
      if (snapshots.length === 1) return completion({})
      if (snapshots.length === 2) return completion({ text: 'Prose.' })
      if (snapshots.length === 3) {
        return completion({ toolCalls: [{ id: 'bad', name: 'update_memory', arguments: '{"set":{}}' }] })
      }
      return completion({ text: 'DONE' })
    })

    await runNarrator(CTX, new AbortController().signal)

    expect(snapshots).toHaveLength(4)
    const [narrator0, narrator1, plotter0, plotter1] = snapshots
    expect(narrator1.slice(0, narrator0.length)).toEqual(narrator0)
    expect(plotter1.slice(0, plotter0.length)).toEqual(plotter0)
    // The nudge repeats the turn reminder after the empty reply.
    expect(narrator1).toHaveLength(narrator0.length + 1)
    expect(narrator1[narrator1.length - 1]).toEqual(narrator0[narrator0.length - 1])
  })

  it('never executes a call the narrator returns, and nudges it for prose', async () => {
    mockedModel.mockResolvedValueOnce(
      completion({
        toolCalls: [{ id: 's1', name: 'update_state', arguments: '{"keep":[],"set":{"x":1}}' }],
      }),
    )
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'DONE' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('Prose.')
    expect(result.data.state).toEqual({})
    expect(result.trace.some((e) => e.kind === 'call')).toBe(false)
    expect(result.trace.some((e) => e.kind === 'thought' && e.text.includes('nudge'))).toBe(true)
  })

  it('gives up when the narrator is still empty after one nudge', async () => {
    mockedModel.mockResolvedValue(completion({}))

    await expect(runNarrator(CTX, new AbortController().signal)).rejects.toBeInstanceOf(
      EmptyNarrativeError,
    )
    expect(mockedModel).toHaveBeenCalledTimes(2)
  })

  it('records the provider’s prompt and cached token counts per request', async () => {
    mockedModel.mockResolvedValueOnce(
      completion({ text: 'Prose.', promptTokens: 1000, cachedTokens: 900 }),
    )
    mockedModel.mockResolvedValueOnce(
      completion({ text: 'DONE', promptTokens: 1200, cachedTokens: 1100 }),
    )

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.trace).toContainEqual({
      kind: 'usage',
      label: 'narrator:0',
      promptTokens: 1000,
      cachedTokens: 900,
      durationMs: expect.any(Number),
    })
    expect(result.plotterTrace).toContainEqual({
      kind: 'usage',
      label: 'plotter:0',
      promptTokens: 1200,
      cachedTokens: 1100,
      durationMs: expect.any(Number),
    })
  })

  it('skips the plotter phase when no subsystems are enabled', async () => {
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
    expect(mockedModel).toHaveBeenCalledTimes(1)
  })
})
