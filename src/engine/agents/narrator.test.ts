import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PLOTTER_ITERATIONS, runNarrator, type NarratorContext } from './narrator'
import { completeModel } from '../model/client'
import type { ModelCompletion } from '../model/types'

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
  initialState: {},
  initialPlot: [],
  initialMemory: {},
  sampling: { temperature: 0.7 },
  stateCleanupThreshold: 4000,
  includePriorPlayerTurns: true,
  reminderAsSystem: true,
  includeWorldState: true,
  includePlotOutline: true,
  includeMemory: true,
  nsfw: false,
}

describe('runNarrator two-phase flow', () => {
  beforeEach(() => {
    mockedModel.mockReset()
  })

  it('narrates first, then the plotter phase records updates on the same conversation', async () => {
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
    mockedModel.mockResolvedValueOnce(completion({}))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('The door creaks open.')
    expect(result.state).toEqual({ scene: { location: 'the mill' } })
    expect(mockedModel).toHaveBeenCalledTimes(3)
    // The phases record to separate traces for the UI.
    expect(result.trace.some((e) => e.kind === 'call')).toBe(false)
    expect(
      result.plotterTrace?.some((e) => e.kind === 'call' && e.name === 'update_state'),
    ).toBe(true)

    const narratorReq = mockedModel.mock.calls[0][0]
    const plotterReq = mockedModel.mock.calls[1][0]
    // Same tool set both phases — required for provider prefix-cache sharing.
    expect(plotterReq.tools).toEqual(narratorReq.tools)
    expect(plotterReq.label).toBe('plotter:0')
    // The plotter request extends the narrator conversation: the prose is
    // committed as an assistant message before the pivot instruction.
    const proseIdx = plotterReq.messages.findIndex(
      (m) => m.role === 'assistant' && m.content === 'The door creaks open.',
    )
    expect(proseIdx).toBeGreaterThanOrEqual(0)
    expect(plotterReq.messages[proseIdx + 1].content).toContain('Plotter')
  })

  it('ends the plotter phase on the first response with no tool calls', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    mockedModel.mockResolvedValueOnce(completion({ text: 'Nothing material changed.' }))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('Prose.')
    expect(result.state).toEqual({})
    expect(mockedModel).toHaveBeenCalledTimes(2)
  })

  it('keeps the prose and prior updates when the plotter phase fails', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    mockedModel.mockRejectedValueOnce(new Error('network down'))

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('Prose.')
    expect(result.state).toEqual({})
    expect(
      result.plotterTrace?.some((e) => e.kind === 'thought' && e.text.includes('plotter failed')),
    ).toBe(true)
  })

  it('caps the plotter loop even if the model keeps calling tools', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))
    mockedModel.mockResolvedValue(
      completion({
        toolCalls: [
          { id: 'cX', name: 'update_memory', arguments: '{"set":{"the_mill":"An old mill."}}' },
        ],
      }),
    )

    const result = await runNarrator(CTX, new AbortController().signal)

    expect(result.text).toBe('Prose.')
    expect(result.memory).toEqual({ the_mill: 'An old mill.' })
    expect(mockedModel).toHaveBeenCalledTimes(1 + MAX_PLOTTER_ITERATIONS)
  })

  it('skips the plotter phase when no subsystems are enabled', async () => {
    mockedModel.mockResolvedValueOnce(completion({ text: 'Prose.' }))

    const result = await runNarrator(
      { ...CTX, includeWorldState: false, includePlotOutline: false, includeMemory: false },
      new AbortController().signal,
    )

    expect(result.text).toBe('Prose.')
    expect(mockedModel).toHaveBeenCalledTimes(1)
  })
})
