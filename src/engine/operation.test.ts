import { describe, expect, it } from 'vitest'
import { OperationCoordinator } from './operation'

describe('OperationCoordinator', () => {
  it('rejects overlapping work immediately', () => {
    const operations = new OperationCoordinator()
    const first = operations.start()

    expect(first).not.toBeNull()
    expect(operations.start()).toBeNull()
    expect(operations.busy).toBe(true)
  })

  it('prevents a replaced operation from committing or finishing its replacement', () => {
    const operations = new OperationCoordinator()
    const first = operations.start()!
    const second = operations.start(true)!

    expect(first.controller.signal.aborted).toBe(true)
    expect(operations.canCommit(first)).toBe(false)
    expect(operations.finish(first)).toBe(false)
    expect(operations.busy).toBe(true)
    expect(operations.canCommit(second)).toBe(true)
  })

  it('keeps a cancelled operation current until its promise settles', () => {
    const operations = new OperationCoordinator()
    const operation = operations.start()!

    expect(operations.cancel()).toBe(true)
    expect(operation.controller.signal.aborted).toBe(true)
    expect(operations.busy).toBe(true)
    expect(operations.finish(operation)).toBe(true)
    expect(operations.busy).toBe(false)
  })
})
