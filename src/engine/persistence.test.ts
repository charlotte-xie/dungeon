import { describe, expect, it } from 'vitest'
import { isSavedGameLike, normalizeSavedGame } from './persistence'

function validSave() {
  return {
    id: 'save-1',
    name: 'Before the vault',
    savedAt: 1,
    slots: { scenario: 'A vault.', styleGuide: '' },
    state: {},
    plot: [],
    memory: {},
    chronicle: [],
    compactCutoff: 1,
    turns: [
      {
        id: 'turn-1',
        kind: 'player' as const,
        input: 'Enter.',
        reply: { id: 'reply-1', model: 'test', text: 'The door opens.' },
      },
    ],
  }
}

describe('saved-game validation', () => {
  it('rejects malformed nested turns', () => {
    expect(isSavedGameLike({ ...validSave(), turns: [null] })).toBe(false)
  })

  it('clamps a finite cutoff to the normalized turn list', () => {
    const raw = { ...validSave(), compactCutoff: 999 }
    expect(isSavedGameLike(raw)).toBe(true)
    if (!isSavedGameLike(raw)) throw new Error('fixture unexpectedly invalid')

    expect(normalizeSavedGame(raw).compactCutoff).toBe(1)
  })
})
