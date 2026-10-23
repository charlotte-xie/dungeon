import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONTEXT } from './config'
import {
  isSavedGameLike,
  isTurnLike,
  loadStoredContext,
  loadStoredOocBaseline,
  loadStoredRecovery,
  normalizeSavedGame,
} from './persistence'

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

  it('clamps a finite cutoff to the normalised turn list', () => {
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

  it('upgrades the pre-watermark default compaction threshold', () => {
    const stored: Record<string, string> = {
      'dm.context': JSON.stringify({ compactionThreshold: 8, compactionBatch: 4 }),
    }
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored[key] ?? null,
      setItem: () => {},
      removeItem: () => {},
    })
    const ctx = loadStoredContext()
    // Old default 8 with no stored floor = legacy config → new defaults.
    expect(ctx.compactionThreshold).toBe(DEFAULT_CONTEXT.compactionThreshold)
    expect(ctx.compactionFloor).toBe(DEFAULT_CONTEXT.compactionFloor)
  })

  it('keeps a deliberately customised compaction threshold', () => {
    const stored: Record<string, string> = {
      'dm.context': JSON.stringify({ compactionThreshold: 12, compactionBatch: 4 }),
    }
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored[key] ?? null,
      setItem: () => {},
      removeItem: () => {},
    })
    expect(loadStoredContext().compactionThreshold).toBe(12)
  })

  it('rebuilds an old context config with defaults for new fields', () => {
    const stored: Record<string, string> = {
      'dm.context': JSON.stringify({
        compactionThreshold: 24,
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
    expect(ctx.compactionThreshold).toBe(24)
    expect(ctx.includeWorldState).toBe(true)
    // New fields fall back to defaults…
    expect(ctx.includeOoc).toBe(DEFAULT_CONTEXT.includeOoc)
    expect(ctx.apiProtocol).toBe('chat-completions')
    expect(ctx.plotterModel).toBe('')
    expect(ctx.summarizerModel).toBe('')
    expect(ctx.narratorReasoning).toBe('default')
    expect(ctx.plotterReasoning).toBe('default')
    expect(ctx.summarizerReasoning).toBe('default')
    expect(ctx.compactionFloor).toBe(DEFAULT_CONTEXT.compactionFloor)
    // …and removed fields are dropped rather than carried along.
    expect('includeToolCallHistory' in ctx).toBe(false)
  })
})

describe('role settings', () => {
  it('loads the recommended defaults for a new installation', () => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    expect(loadStoredContext()).toMatchObject({
      narratorReasoning: 'none', plotterModel: 'grok-4.3', plotterReasoning: 'low',
      summarizerModel: 'grok-4.3', summarizerReasoning: 'none', apiProtocol: 'responses', useReviser: false,
    })
  })

  it('preserves saved custom model and effort choices', () => {
    const saved = {
      ...DEFAULT_CONTEXT,
      narratorReasoning: 'medium', plotterModel: 'grok-4.7', plotterReasoning: 'high',
      summarizerModel: 'custom-model', summarizerReasoning: 'default',
    }
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(saved) })
    expect(loadStoredContext()).toEqual(saved)
  })

  it('ignores invalid persisted role settings', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({
      plotterModel: 42, narratorReasoning: 'invalid', summarizerReasoning: null,
    }) })
    expect(loadStoredContext()).toMatchObject({
      plotterModel: '', narratorReasoning: 'default', summarizerReasoning: 'default',
    })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('turn validation', () => {
  it('accepts usage trace events and failed-reply markers', () => {
    expect(
      isTurnLike({
        id: 't',
        kind: 'player',
        input: 'x',
        reply: {
          id: 'r',
          model: 'm',
          text: '(The dungeon master falters: boom)',
          error: 'boom',
          trace: [{ kind: 'usage', label: 'narrator:0', promptTokens: 10, cachedTokens: 5 }],
        },
      }),
    ).toBe(true)
  })

  it('accepts a briefing and checks its shape, and the Plotter call’s', () => {
    const turn = {
      id: 't',
      kind: 'player',
      input: 'x',
      reply: { id: 'r', model: 'm', text: 'Prose.' },
      plotter: { id: 'p', model: 'm' },
      briefing: [{ name: 'steer', arguments: '{"text":"Quiet."}', result: 'ok' }],
    }
    expect(isTurnLike(turn)).toBe(true)
    expect(isTurnLike({ ...turn, briefing: [{ name: 'steer', arguments: {}, result: 'ok' }] })).toBe(false)
    expect(isTurnLike({ ...turn, briefing: 'steer' })).toBe(false)
    expect(isTurnLike({ ...turn, plotter: { id: 'p' } })).toBe(false)
  })
})

describe('stored undo and redo', () => {
  const world = { state: {}, plot: ['A beat.'], memory: {}, ooc: [], chronicle: [], compactCutoff: 0 }
  const turn = {
    id: 'turn-2',
    kind: 'player' as const,
    input: 'Enter.',
    reply: { id: 'reply-2', model: 'test', text: 'The door opens.' },
  }

  function stored(value: unknown) {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(value) })
  }

  it('loads a well-formed record, filling missing adventure settings', () => {
    stored({
      before: { turnId: 'turn-1', world, slots: { scenario: 'A vault.', extra: 1 } },
      undone: { afterId: 'turn-1', turn, world },
    })
    const recovery = loadStoredRecovery()
    expect(recovery.before).toEqual({
      turnId: 'turn-1',
      world,
      slots: { scenario: 'A vault.', styleGuide: expect.any(String) },
    })
    expect(recovery.undone).toEqual({ afterId: 'turn-1', turn, world })
  })

  it('drops malformed parts and keeps the rest', () => {
    stored({
      before: { turnId: 'turn-1', world: { ...world, compactCutoff: -1 }, slots: {} },
      undone: { afterId: null, turn, world },
    })
    expect(loadStoredRecovery()).toEqual({ before: null, undone: { afterId: null, turn, world } })

    stored({ before: { turnId: 'turn-1', world, slots: {} }, undone: { afterId: 3, turn, world } })
    expect(loadStoredRecovery().undone).toBeNull()

    stored({ before: { turnId: 'turn-1', world: { ...world, state: [] }, slots: {} }, undone: null })
    expect(loadStoredRecovery()).toEqual({ before: null, undone: null })
  })

  it('treats missing or unreadable storage as nothing to undo', () => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    expect(loadStoredRecovery()).toEqual({ before: null, undone: null })
    vi.stubGlobal('localStorage', { getItem: () => '{not json' })
    expect(loadStoredRecovery()).toEqual({ before: null, undone: null })
  })

  it('loads the OOC baseline only when it is a list of strings', () => {
    stored(['Keep it short.'])
    expect(loadStoredOocBaseline()).toEqual(['Keep it short.'])
    stored([1])
    expect(loadStoredOocBaseline()).toBeNull()
    vi.stubGlobal('localStorage', { getItem: () => null })
    expect(loadStoredOocBaseline()).toBeNull()
  })
})
