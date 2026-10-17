import { describe, expect, it } from 'vitest'
import { prepareSteering } from './steering'
import { MAX_OOC_ITEMS, MAX_OOC_ITEM_CHARS } from './tools'

describe('story steering', () => {
  it('keeps the player action and scopes temporary guidance without persisting it', () => {
    const preferences = ['Keep the tone intimate.']
    const result = prepareSteering('I speak to Mara.', ' Skip the arrangements. ', 'once', preferences)
    expect(result.input).toBe('I speak to Mara.\n\n(OOC: NEXT REPLY ONLY — Skip the arrangements.)')
    expect(result.preferences).toEqual(preferences)
    expect(preferences).toEqual(['Keep the tone intimate.'])
  })

  it('supports steering without an in-character action', () => {
    expect(prepareSteering('', 'Surprise me.', 'once', []).input)
      .toBe('(OOC: NEXT REPLY ONLY — Surprise me.)')
  })

  it('saves standing guidance directly without creating a model request or changing the action', () => {
    const result = prepareSteering('I enter.', 'More exploration.', 'standing', ['Keep the tone intimate.'])
    expect(result).toEqual({ input: 'I enter.', preferences: ['Keep the tone intimate.', 'More exploration.'] })
  })

  it('allows editing and clearing preferences without adding new guidance', () => {
    expect(prepareSteering('I enter.', '', 'once', [' Short replies. ', ' ']).preferences).toEqual(['Short replies.'])
    expect(prepareSteering('I enter.', '', 'standing', [])).toEqual({ input: 'I enter.', preferences: [] })
  })

  it('deduplicates a repeated standing preference', () => {
    expect(prepareSteering('', 'Short replies.', 'standing', ['Short replies.']).preferences).toEqual(['Short replies.'])
  })

  it('rejects oversized saved preferences before changing anything', () => {
    expect(() => prepareSteering('', 'x'.repeat(MAX_OOC_ITEM_CHARS + 1), 'standing', [])).toThrow('characters')
    const preferences = Array.from({ length: MAX_OOC_ITEMS }, (_, i) => `Preference ${i}`)
    expect(() => prepareSteering('', 'Another preference', 'standing', preferences)).toThrow('at most')
    expect(preferences).toHaveLength(MAX_OOC_ITEMS)
  })
})
