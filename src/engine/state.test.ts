import { describe, expect, it } from 'vitest'
import { deleteByPath, getByPath, isSafeStatePath, setByPath } from './state'

describe('world-state paths', () => {
  it('rejects prototype-polluting path segments', () => {
    const original = { scene: { location: 'vault' } }

    expect(isSafeStatePath('__proto__.dm_review_probe')).toBe(false)
    expect(isSafeStatePath('constructor.prototype.dm_review_probe')).toBe(false)
    expect(setByPath(original, '__proto__.dm_review_probe', true)).toBe(original)
    expect(getByPath(original, '__proto__.dm_review_probe')).toBeUndefined()
    expect(deleteByPath(original, '__proto__.dm_review_probe')).toBe(original)
    expect(({} as Record<string, unknown>).dm_review_probe).toBeUndefined()
  })

  it('does not follow inherited properties for otherwise-safe keys', () => {
    const next = setByPath({}, 'toString.note', 'owned state value')

    expect(getByPath(next, 'toString.note')).toBe('owned state value')
    expect(Object.prototype).not.toHaveProperty('note')
  })
})
