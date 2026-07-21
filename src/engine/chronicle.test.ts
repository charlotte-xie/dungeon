import { describe, expect, it } from 'vitest'
import { memoryForCompaction } from './chronicle'

describe('compaction context', () => {
  it('omits persistent memory when the feature is disabled', () => {
    const memory = { hidden_fact: 'The duke is the masked patron.' }

    expect(memoryForCompaction(memory, false)).toEqual({})
    expect(memoryForCompaction(memory, true)).toBe(memory)
  })
})
