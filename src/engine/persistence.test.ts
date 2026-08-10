import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONTEXT } from './config'
import { isSavedGameLike, loadStoredContext, normalizeSavedGame } from './persistence'

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

// Old persisted data must load without breaking — losing detail is fine,
// crashing or rejecting is not.
describe('legacy data tolerance', () => {
  it('accepts a pre-OOC save with legacy string memory entries', () => {
    const legacy = {
      ...validSave(),
      memory: { the_baker: 'Hesta the baker; hiding her son upstairs.' },
      // no `ooc` field at all
    }
    expect(isSavedGameLike(legacy)).toBe(true)
    const normalized = normalizeSavedGame(
      legacy as unknown as Parameters<typeof normalizeSavedGame>[0],
    )
    expect(normalized.ooc).toEqual([])
    // Legacy string entries survive as-is under the free-JSON memory shape.
    expect(normalized.memory).toEqual({
      the_baker: 'Hesta the baker; hiding her son upstairs.',
    })
  })

  it('migrates a v2 summary save with old trace tool names', () => {
    const legacy = {
      id: 's',
      name: 'old save',
      savedAt: 1,
      slots: { scenario: 'x', styleGuide: '' },
      state: {},
      memory: { note: 'a plain string entry' },
      summary: 'Earlier, things happened.',
      compactCutoff: 0,
      turns: [
        {
          id: 't1',
          kind: 'player' as const,
          input: 'go',
          reply: {
            id: 'r1',
            model: 'm',
            text: 'ok',
            trace: [{ kind: 'call' as const, name: 'get_state', arguments: '{}', result: '(stale)' }],
          },
        },
      ],
    }
    expect(isSavedGameLike(legacy)).toBe(true)
    const normalized = normalizeSavedGame(
      legacy as unknown as Parameters<typeof normalizeSavedGame>[0],
    )
    expect(normalized.chronicle.length).toBeGreaterThan(0)
    expect(normalized.plot).toEqual([])
    expect(normalized.ooc).toEqual([])
    expect(normalized.turns).toHaveLength(1)
  })

  it('rebuilds an old context config with defaults for new fields', () => {
    const stored: Record<string, string> = {
      'dm.context': JSON.stringify({
        compactionThreshold: 8,
        compactionBatch: 4,
        includeWorldState: true,
        includeToolCallHistory: true,
      }),
    }
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored[key] ?? null,
      setItem: () => {},
      removeItem: () => {},
    })
    const ctx = loadStoredContext()
    expect(ctx.compactionThreshold).toBe(8)
    expect(ctx.includeWorldState).toBe(true)
    // New fields fall back to defaults…
    expect(ctx.includeOoc).toBe(DEFAULT_CONTEXT.includeOoc)
    expect(ctx.apiProtocol).toBe(DEFAULT_CONTEXT.apiProtocol)
    expect(ctx.compactionFloor).toBe(DEFAULT_CONTEXT.compactionFloor)
    // …and removed fields are dropped rather than carried along.
    expect('includeToolCallHistory' in ctx).toBe(false)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})
