import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT, DEFAULT_MODEL, PROVIDER_SETUPS, reasoningOffConflict } from './config'

describe('provider setups', () => {
  it('keeps the xAI setup in step with the new-install defaults', () => {
    const { model, context } = PROVIDER_SETUPS.xai
    expect(model).toBe(DEFAULT_MODEL)
    for (const [key, value] of Object.entries(context)) {
      expect(DEFAULT_CONTEXT[key as keyof typeof DEFAULT_CONTEXT]).toBe(value)
    }
  })

  it.each(['mistral', 'lmstudio'] as const)(
    'switches %s to Chat Completions with roles following the narrator',
    (id) => {
      const { model, context } = PROVIDER_SETUPS[id]
      expect(model).toBeUndefined()
      expect(context).toEqual({
        apiProtocol: 'chat-completions',
        narratorReasoning: 'default',
        plotterModel: '',
        plotterReasoning: 'default',
        summarizerModel: '',
        summarizerReasoning: 'default',
      })
    },
  )
})

describe('Grok 4.7 reasoning check', () => {
  it('accepts the defaults', () => {
    expect(reasoningOffConflict(DEFAULT_MODEL, DEFAULT_CONTEXT)).toBeNull()
  })

  it('flags a role sent reasoning off on Grok 4.7', () => {
    expect(reasoningOffConflict('grok-4.7', { ...DEFAULT_CONTEXT, narratorReasoning: 'none' })).toBe('narrator')
    expect(reasoningOffConflict('grok-4.7-fast', { ...DEFAULT_CONTEXT, narratorReasoning: 'none' })).toBe('narrator')
  })

  it('treats a whitespace-only role model as following the narrator', () => {
    const context = {
      ...DEFAULT_CONTEXT,
      narratorReasoning: 'low' as const,
      plotterModel: '   ',
      plotterReasoning: 'none' as const,
    }
    expect(reasoningOffConflict(' grok-4.7 ', context)).toBe('plotter')
  })
})
