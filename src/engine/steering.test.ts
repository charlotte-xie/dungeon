import { describe, expect, it } from 'vitest'
import { carryOocEdits, prepareSteering, withRetryGuidance } from './steering'
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

describe('retry with guidance', () => {
  it('keeps the action and attaches one-reply guidance', () => {
    expect(withRetryGuidance('I draw my sword.', ' Make the guard back down. '))
      .toBe('I draw my sword.\n\n(OOC: NEXT REPLY ONLY — Make the guard back down.)')
  })

  it('replaces one-reply guidance already ending the input', () => {
    expect(withRetryGuidance('I draw my sword.\n\n(OOC: NEXT REPLY ONLY — Old.)', 'New.'))
      .toBe('I draw my sword.\n\n(OOC: NEXT REPLY ONLY — New.)')
    expect(withRetryGuidance('(OOC: NEXT REPLY ONLY — Old.)', 'New.'))
      .toBe('(OOC: NEXT REPLY ONLY — New.)')
  })

  it("keeps the player's own OOC text", () => {
    expect(withRetryGuidance('I wait. (OOC: keep it short)', 'New.'))
      .toBe('I wait. (OOC: keep it short)\n\n(OOC: NEXT REPLY ONLY — New.)')
  })

  it('leaves the input unchanged without guidance', () => {
    expect(withRetryGuidance('I wait.', '  ')).toBe('I wait.')
  })
})

describe('carrying OOC edits across a restored checkpoint', () => {
  it("keeps a preference saved after the reply and rolls back the plotter's entry", () => {
    const target = ['Keep it intimate.']
    const baseline = ['Keep it intimate.', 'Recorded by the plotter.']
    const current = [...baseline, 'Shorter replies.']
    expect(carryOocEdits(target, baseline, current)).toEqual(['Keep it intimate.', 'Shorter replies.'])
  })

  it('keeps a removal made after the reply', () => {
    expect(carryOocEdits(['A', 'B'], ['A', 'B'], ['A'])).toEqual(['A'])
  })

  it('carries an edited entry as its new wording', () => {
    expect(carryOocEdits(['Short replies.'], ['Short replies.'], ['Shorter replies.'])).toEqual(['Shorter replies.'])
  })

  it('restores the checkpoint exactly when the player changed nothing', () => {
    const target = ['A']
    expect(carryOocEdits(target, ['A', 'X'], ['A', 'X'])).toEqual(['A'])
    expect(target).toEqual(['A'])
  })

  it('does not duplicate an entry the checkpoint already has', () => {
    expect(carryOocEdits(['A', 'P'], ['A'], ['A', 'P'])).toEqual(['A', 'P'])
  })
})
