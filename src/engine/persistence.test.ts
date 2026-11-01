import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONTEXT } from './config'
import {
  isSavedGameLike,
  isTurnLike,
  loadStoredChronicle,
  loadStoredContext,
  loadStoredOocBaseline,
  loadStoredPlotBaseline,
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

  it('keeps a chronicle that points at the saved turns and drops one that does not', () => {
    const entry = { id: 'c1', text: 'Earlier.', firstTurnId: 'turn-1', lastTurnId: 'turn-1', createdAt: 1 }
    const raw: unknown = { ...validSave(), chronicle: [[entry]] }
    if (!isSavedGameLike(raw)) throw new Error('fixture unexpectedly invalid')
    expect(normalizeSavedGame(raw).chronicle).toEqual([[entry]])

    const stale: unknown = { ...validSave(), chronicle: [[{ ...entry, lastTurnId: 'turn-9' }]] }
    if (!isSavedGameLike(stale)) throw new Error('fixture unexpectedly invalid')
    expect(normalizeSavedGame(stale).chronicle).toEqual([])
  })

  it('lays a legacy chronicle over the turns, clamping the saved cutoff to the log', () => {
    const raw = {
      ...validSave(),
      chronicle: [[{ id: 'c1', text: 'Earlier.', turnsCovered: 1, createdAt: 1 }]],
      compactCutoff: 999,
    }
    expect(isSavedGameLike(raw)).toBe(true)
    if (!isSavedGameLike(raw)) throw new Error('fixture unexpectedly invalid')
    const normalized = normalizeSavedGame(raw)
    expect(normalized.chronicle).toEqual([
      [{ id: 'c1', text: 'Earlier.', firstTurnId: 'turn-1', lastTurnId: 'turn-1', createdAt: 1 }],
    ])
    expect(normalized).not.toHaveProperty('compactCutoff')
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
      compactCutoff: 1,
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
    expect(normalized.chronicle).toEqual([
      [expect.objectContaining({ text: 'Earlier, things happened.', firstTurnId: 't1', lastTurnId: 't1' })],
    ])
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
    expect(ctx.defaultOoc).toBe(DEFAULT_CONTEXT.defaultOoc)
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
      summarizerModel: 'grok-4.3', summarizerReasoning: 'low', apiProtocol: 'responses', useReviser: false,
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

describe('stored chronicle migration', () => {
  const turns = ['turn-1', 'turn-2'].map((id) => ({
    id,
    kind: 'player' as const,
    input: 'Enter.',
    reply: { id: `${id}-reply`, model: 'test', text: 'The door opens.' },
  }))

  function storage(chronicle: unknown) {
    const items: Record<string, string> = { 'dm.chronicle': JSON.stringify(chronicle), 'dm.compactCutoff': '2' }
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items[key] ?? null,
      setItem: (key: string, value: string) => {
        items[key] = value
      },
      removeItem: (key: string) => {
        delete items[key]
      },
    })
    return items
  }

  it('writes a legacy chronicle back as an index over the turns', () => {
    const items = storage([[{ id: 'c1', text: 'Earlier.', turnsCovered: 2, createdAt: 1 }]])
    const indexed = [[{ id: 'c1', text: 'Earlier.', firstTurnId: 'turn-1', lastTurnId: 'turn-2', createdAt: 1 }]]
    expect(loadStoredChronicle(turns, 2)).toEqual(indexed)
    expect(JSON.parse(items['dm.chronicle'])).toEqual(indexed)
    expect(items['dm.compactCutoff']).toBeUndefined()
  })

  it('leaves a legacy chronicle that does not fit the turns in storage', () => {
    const legacy = [[{ id: 'c1', text: 'Earlier.', turnsCovered: 5, createdAt: 1 }]]
    const items = storage(legacy)
    expect(loadStoredChronicle(turns, 2)).toEqual([])
    expect(JSON.parse(items['dm.chronicle'])).toEqual(legacy)
    expect(items['dm.compactCutoff']).toBe('2')
  })
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

  it('accepts a story update and checks its shape', () => {
    const turn = {
      id: 't',
      kind: 'player',
      input: 'x',
      reply: { id: 'r', model: 'm', text: 'Prose.' },
      storyUpdate: { recalled: { Hesta: { is: 'The baker.' } }, ooc: [] },
    }
    expect(isTurnLike(turn)).toBe(true)
    expect(isTurnLike({ ...turn, storyUpdate: { ooc: [3] } })).toBe(false)
    expect(isTurnLike({ ...turn, storyUpdate: { changed: { Hesta: { wants: { shop: null } } } } })).toBe(true)
    expect(isTurnLike({ ...turn, storyUpdate: { changed: 'Hesta' } })).toBe(false)
    expect(isTurnLike({ ...turn, storyUpdate: { ooc: 'short' } })).toBe(false)
    expect(isTurnLike({ ...turn, storyUpdate: { recalled: [] } })).toBe(false)
  })
})

describe('stored undo and redo', () => {
  const world = { state: {}, plot: ['A beat.'], memory: {}, ooc: [], chronicle: [] }
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
    const recovery = loadStoredRecovery([])
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
    expect(loadStoredRecovery([])).toEqual({ before: null, undone: { afterId: null, turn, world } })

    stored({ before: { turnId: 'turn-1', world, slots: {} }, undone: { afterId: 3, turn, world } })
    expect(loadStoredRecovery([]).undone).toBeNull()

    stored({ before: { turnId: 'turn-1', world: { ...world, state: [] }, slots: {} }, undone: null })
    expect(loadStoredRecovery([])).toEqual({ before: null, undone: null })
  })

  it('lays each snapshot’s legacy chronicle over the log with its cutoff', () => {
    const legacyWorld = {
      ...world,
      chronicle: [[{ id: 'c1', text: 'Earlier.', turnsCovered: 1, createdAt: 1 }]],
      compactCutoff: 1,
    }
    stored({ before: { turnId: 'turn-2', world: legacyWorld, slots: {} }, undone: null })
    const turns = [{ ...turn, id: 'turn-1' }, turn]
    expect(loadStoredRecovery(turns).before?.world).toEqual({
      ...world,
      chronicle: [[{ id: 'c1', text: 'Earlier.', firstTurnId: 'turn-1', lastTurnId: 'turn-1', createdAt: 1 }]],
    })
  })

  it('treats missing or unreadable storage as nothing to undo', () => {
    vi.stubGlobal('localStorage', { getItem: () => null })
    expect(loadStoredRecovery([])).toEqual({ before: null, undone: null })
    vi.stubGlobal('localStorage', { getItem: () => '{not json' })
    expect(loadStoredRecovery([])).toEqual({ before: null, undone: null })
  })

  it('loads the OOC and arc baselines only when they are lists of strings', () => {
    for (const load of [loadStoredOocBaseline, loadStoredPlotBaseline]) {
      stored(['Keep it short.'])
      expect(load()).toEqual(['Keep it short.'])
      stored([1])
      expect(load()).toBeNull()
      vi.stubGlobal('localStorage', { getItem: () => null })
      expect(load()).toBeNull()
    }
  })
})
