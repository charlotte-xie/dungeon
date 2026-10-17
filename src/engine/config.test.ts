import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTEXT, DEFAULT_MODEL, PROVIDER_SETUPS } from './config'

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
