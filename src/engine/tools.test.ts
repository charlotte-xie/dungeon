import { describe, expect, it } from 'vitest'
import { executeTool } from './tools'

describe('tool execution boundaries', () => {
  it('rejects an unsafe update_state atomically', () => {
    const state = { scene: { location: 'vault' } }
    const result = executeTool(
      'update_state',
      JSON.stringify({ keep: ['scene.location'], set: { '__proto__.polluted': true } }),
      state,
      [],
      {},
    )

    expect(result.state).toBe(state)
    expect(result.result).toMatch(/unsafe state path/)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
