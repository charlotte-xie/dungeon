import { describe, expect, it } from 'vitest'
import { executeTool } from './tools'

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
  })

  it('reports list-editor errors with the OOC noun', () => {
    const data = { state: {}, plot: [], memory: {}, ooc: [] }
    const result = executeTool('update_ooc', JSON.stringify({ op: 'delete', position: 3 }), data)
    expect(result.data).toBe(data)
    expect(result.result).toContain('out of range')
    expect(result.result).toContain('OOC list unchanged')
  })
})
