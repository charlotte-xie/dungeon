export interface ActiveOperation {
  id: number
  controller: AbortController
}

// Coordinates one foreground engine operation while allowing an explicit
// replacement (new adventure / load save). Identity checks ensure a stale
// promise cannot commit or clear the busy state owned by its replacement.
export class OperationCoordinator {
  private serial = 0
  private current: ActiveOperation | null = null

  get busy(): boolean {
    return this.current !== null
  }

  start(replaceExisting = false): ActiveOperation | null {
    if (this.current && !replaceExisting) return null
    if (replaceExisting) this.current?.controller.abort()
    const operation: ActiveOperation = {
      id: ++this.serial,
      controller: new AbortController(),
    }
    this.current = operation
    return operation
  }

  isCurrent(operation: ActiveOperation): boolean {
    return this.current?.id === operation.id && this.current.controller === operation.controller
  }

  canCommit(operation: ActiveOperation): boolean {
    return this.isCurrent(operation) && !operation.controller.signal.aborted
  }

  cancel(): boolean {
    if (!this.current || this.current.controller.signal.aborted) return false
    this.current.controller.abort()
    return true
  }

  supersede() {
    this.serial += 1
    this.current?.controller.abort()
    this.current = null
  }

  finish(operation: ActiveOperation): boolean {
    if (!this.isCurrent(operation)) return false
    this.current = null
    return true
  }
}
