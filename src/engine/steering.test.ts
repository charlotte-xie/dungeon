import { describe, expect, it } from 'vitest'
import { carryOocEdits, withRetryGuidance } from './steering'

describe('rewrite guidance', () => {
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

  it('restores the checkpoint exactly when the current list is the checkpoint', () => {
    const target = ['A', 'P']
    expect(carryOocEdits(target, ['A', 'X'], target)).toEqual(target)
    expect(carryOocEdits(target, [], target)).toEqual(target)
  })

  it('does not duplicate an entry the checkpoint already has', () => {
    expect(carryOocEdits(['A', 'P'], ['A'], ['A', 'P'])).toEqual(['A', 'P'])
  })
})
