import { describe, expect, it } from 'vitest'
import { executeTool, UPDATE_OOC_TOOL } from './tools'

describe('tool execution boundaries', () => {
  it('rejects an unsafe update_state atomically', () => {
    const data = { state: { scene: { location: 'vault' } }, plot: [], memory: {}, ooc: [] }
    const result = executeTool(
      'update_state',
      JSON.stringify({ keep: ['scene.location'], set: { '__proto__.polluted': true } }),
      data,
    )

    expect(result.data).toBe(data)
    expect(result.result).toMatch(/unsafe state path/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('edits the OOC list through the shared numbered-list editor', () => {
    const data = { state: {}, plot: [], memory: {}, ooc: ['Keep replies short.'] }
    const appended = executeTool(
      'update_ooc',
      JSON.stringify({ op: 'append', text: 'No character death without consent.' }),
      data,
    )
    expect(appended.data.ooc).toEqual([
      'Keep replies short.',
      'No character death without consent.',
    ])
    expect(appended.result).toBe('ok — appended as entry 2.')
    // The other stores ride along untouched.
    expect(appended.data.plot).toBe(data.plot)

    const deleted = executeTool(
      'update_ooc',
      JSON.stringify({ op: 'delete', position: 1 }),
      appended.data,
    )
    expect(deleted.data.ooc).toEqual(['No character death without consent.'])
    expect(deleted.result).toContain('OOC list now has 1 entry')
    // The list is the player's own direction; a length example on the tool
    // got the brief's own guidance recorded as a preference.
    expect(UPDATE_OOC_TOOL.description).not.toMatch(/paragraph|shorter/i)
  })

  it('edits memory facets surgically by dotted path', () => {
    const data = {
      state: {},
      plot: [],
      memory: { the_baker: { is: 'Hesta the baker', bond: 'wary of the player' } },
      ooc: [],
    }
    const result = executeTool(
      'update_memory',
      JSON.stringify({ set: { 'the_baker.bond': 'blames the player for the raid' } }),
      data,
    )
    expect(result.data.memory).toEqual({
      the_baker: { is: 'Hesta the baker', bond: 'blames the player for the raid' },
    })
    expect(result.result).toBe('ok — memory: set the_baker.bond')
  })

  it('replaces the entire value at a path with set, and keeps what merge does not name', () => {
    const thread = { is: 'the drowning', status: 'the families not speaking', truth: 'the rail was cut' }
    const data = { state: {}, plot: [], memory: { drowning: thread }, ooc: [] }
    const set = executeTool('update_memory', JSON.stringify({ set: { drowning: { status: 'asked about' } } }), data)
    expect(set.data.memory).toEqual({ drowning: { status: 'asked about' } })

    const merged = executeTool(
      'update_memory',
      JSON.stringify({ merge: { drowning: { status: 'a witness named', clues: { jacket: 'never found' }, truth: null } } }),
      data,
    )
    expect(merged.data.memory).toEqual({
      drowning: { is: 'the drowning', status: 'a witness named', clues: { jacket: 'never found' } },
    })
    expect(merged.result).toBe('ok — memory: merged drowning: status, clues.jacket, truth')

    // Merging into a map adds to it; a merge with no object is refused.
    const more = executeTool(
      'update_memory',
      JSON.stringify({ merge: { 'drowning.clues': { rail: 'freshly cut' }, 'drowning.is': 'x' } }),
      merged.data,
    )
    expect(more.data.memory.drowning).toMatchObject({ is: 'the drowning', clues: { jacket: 'never found', rail: 'freshly cut' } })
    expect(more.result).toMatch(/^partial/)
    expect(more.result).toContain('REJECTED merge drowning.is')
  })

  it('rejects an unsafe key anywhere inside a merge, without partial writes', () => {
    const data = { state: {}, plot: [], memory: { hesta: { is: 'the baker' } }, ooc: [] }
    const unsafe = executeTool(
      'update_memory',
      '{"merge": {"hesta": {"is": "changed", "__proto__": {"polluted": "yes"}}}}',
      data,
    )
    expect(unsafe.data).toBe(data)
    expect(unsafe.result).toMatch(/unsafe memory path/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('renames an entity with move and merges when the target already exists', () => {
    const data = {
      state: {},
      plot: [],
      memory: {
        dark_haired_boy: { is: 'dark-haired sixth-former, easy charm' },
        chloe: { is: 'blonde student' },
      },
      ooc: [],
    }
    const renamed = executeTool(
      'update_memory',
      JSON.stringify({
        move: { dark_haired_boy: 'daniel' },
        set: { 'daniel.bond': 'walked the player to the common room' },
      }),
      data,
    )
    expect(Object.keys(renamed.data.memory).sort()).toEqual(['chloe', 'daniel'])
    expect(renamed.data.memory['daniel']).toEqual({
      is: 'dark-haired sixth-former, easy charm',
      bond: 'walked the player to the common room',
    })

    // Moving onto an existing slug merges with mv semantics: the moved
    // facets replace the target's on conflict, target-only facets survive,
    // and the source entry is removed.
    const merged = executeTool(
      'update_memory',
      JSON.stringify({ move: { daniel: 'chloe' } }),
      renamed.data,
    )
    expect(Object.keys(merged.data.memory)).toEqual(['chloe'])
    expect(merged.data.memory['chloe']).toEqual({
      is: 'dark-haired sixth-former, easy charm',
      bond: 'walked the player to the common room',
    })
    expect(merged.result).toContain('merged daniel into chloe')
    expect(merged.result).toContain('replaced is')
  })

  it('deletes facets and drops an entry when its last facet goes', () => {
    const data = {
      state: {},
      plot: [],
      memory: { the_baker: { is: 'Hesta', secret: 'hiding her son' }, stub: { is: 'stub' } },
      ooc: [],
    }
    const result = executeTool(
      'update_memory',
      JSON.stringify({ delete: ['the_baker.secret', 'stub.is'] }),
      data,
    )
    // Emptied parents are pruned: stub loses its last value and disappears.
    expect(result.data.memory).toEqual({ the_baker: { is: 'Hesta' } })
    expect(result.result).toContain('deleted stub.is')
  })

  it('edits single possessions by item path', () => {
    const data = {
      state: {},
      plot: [],
      memory: {
        player: { is: 'a drifter', possessions: { money: '30 pounds', sabre: 'chipped' } },
      },
      ooc: [],
    }
    const spent = executeTool(
      'update_memory',
      JSON.stringify({ set: { 'player.possessions.money': '12 pounds' } }),
      data,
    )
    expect(spent.data.memory.player).toEqual({
      is: 'a drifter',
      possessions: { money: '12 pounds', sabre: 'chipped' },
    })

    const dropped = executeTool(
      'update_memory',
      JSON.stringify({ delete: ['player.possessions.sabre'] }),
      spent.data,
    )
    expect(dropped.data.memory.player).toEqual({
      is: 'a drifter',
      possessions: { money: '12 pounds' },
    })
  })

  it('transfers a possession between entities with move', () => {
    const data = {
      state: {},
      plot: [],
      memory: {
        player: { is: 'a drifter', possessions: { ring: "mother's silver ring" } },
        hesta: { is: 'the baker' },
      },
      ooc: [],
    }
    const result = executeTool(
      'update_memory',
      JSON.stringify({ move: { 'player.possessions.ring': 'hesta.possessions.ring' } }),
      data,
    )
    expect(result.data.memory).toEqual({
      player: { is: 'a drifter' },
      hesta: { is: 'the baker', possessions: { ring: "mother's silver ring" } },
    })
    expect(result.result).toContain('moved player.possessions.ring → hesta.possessions.ring')
  })

  it('nests to any depth at the model’s discretion, and null deletes', () => {
    const data = { state: {}, plot: [], memory: {}, ooc: [] }
    const deep = executeTool(
      'update_memory',
      JSON.stringify({
        set: {
          'mark.relationships.phil': 'foreman he quietly funds',
          'mark.relationships.len.standing': 'wary courtesy',
        },
      }),
      data,
    )
    expect(deep.data.memory['mark']).toEqual({
      relationships: { phil: 'foreman he quietly funds', len: { standing: 'wary courtesy' } },
    })

    const nulled = executeTool(
      'update_memory',
      JSON.stringify({ set: { 'mark.relationships.len.standing': null } }),
      deep.data,
    )
    // Null deletes the path; emptied ancestors are pruned.
    expect(nulled.data.memory['mark']).toEqual({
      relationships: { phil: 'foreman he quietly funds' },
    })
  })

  it('rejects unsafe memory paths without partial writes', () => {
    const data = { state: {}, plot: [], memory: {}, ooc: [] }
    const unsafe = executeTool(
      'update_memory',
      JSON.stringify({ set: { '__proto__.polluted': 'yes' } }),
      data,
    )
    expect(unsafe.data).toBe(data)
    expect(unsafe.result).toMatch(/unsafe memory path/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('changes the arcs by insert, update and remove', () => {
    const data = { state: {}, plot: ['The flood rises.'], memory: {}, ooc: [] }
    // Without a position, the arc goes at the end.
    const added = executeTool(
      'update_arcs',
      JSON.stringify({ op: 'insert', text: 'The order returns.' }),
      data,
    )
    expect(added.data.plot).toEqual(['The flood rises.', 'The order returns.'])
    expect(added.result).toBe('ok — inserted at position 2. Arc list now has 2 entries.')
    const first = executeTool(
      'update_arcs',
      JSON.stringify({ op: 'insert', position: 1, text: 'A rival arrives.' }),
      added.data,
    )
    expect(first.data.plot[0]).toBe('A rival arrives.')
    // An arc is revised in place when the story turns. On the old plan,
    // rewriting in place turned directions into notes on the current scene.
    const revised = executeTool(
      'update_arcs',
      JSON.stringify({ op: 'update', position: 2, text: 'The flood rises past the mill.' }),
      first.data,
    )
    expect(revised.data.plot[1]).toBe('The flood rises past the mill.')
    const removed = executeTool('update_arcs', JSON.stringify({ op: 'remove', position: 2 }), revised.data)
    expect(removed.data.plot).toEqual(['A rival arrives.', 'The order returns.'])
    expect(removed.result).toContain('removed entry 2')
    for (const op of ['append', 'delete']) {
      const refused = executeTool(
        'update_arcs',
        JSON.stringify({ op, position: 1, text: 'The knight attacks.' }),
        data,
      )
      expect(refused.data).toBe(data)
      expect(refused.result).toContain('requires `op` to be one of "insert","update","remove"')
    }
  })

  it('reports list-editor errors with the OOC noun', () => {
    const data = { state: {}, plot: [], memory: {}, ooc: [] }
    const result = executeTool('update_ooc', JSON.stringify({ op: 'delete', position: 3 }), data)
    expect(result.data).toBe(data)
    expect(result.result).toContain('out of range')
    expect(result.result).toContain('OOC list unchanged')
  })
})

describe('briefing tools', () => {
  const data = {
    state: {},
    plot: [],
    memory: { Hesta: { is: 'The baker.' }, Tam: { is: 'Her son.' } },
    ooc: [],
  }

  it('recalls the named memory entries without changing anything', () => {
    const result = executeTool('recall_memory', JSON.stringify({ names: ['Hesta', 'Nobody'] }), data)
    expect(result.data).toBe(data)
    expect(result.result).toContain('"Hesta"')
    expect(result.result).toContain('The baker.')
    expect(result.result).not.toContain('Her son.')
    expect(result.result).toContain('(no entries named: Nobody)')
  })

  it('rejects a recall that finds nothing, or has no names', () => {
    expect(executeTool('recall_memory', JSON.stringify({ names: ['Nobody'] }), data).result).toMatch(/^error/)
    expect(executeTool('recall_memory', JSON.stringify({ names: 'Hesta' }), data).result).toMatch(/^error/)
    // A name can never reach the object prototype.
    expect(executeTool('recall_memory', JSON.stringify({ names: ['__proto__'] }), data).result).toMatch(/^error/)
  })

  it('accepts a steer without changing anything, and rejects an empty one', () => {
    const steer = executeTool('steer', JSON.stringify({ text: 'The miller returns.' }), data)
    expect(steer).toEqual({ data, result: 'ok' })
    expect(executeTool('steer', JSON.stringify({ text: '  ' }), data).result).toMatch(/^error/)
  })
})
