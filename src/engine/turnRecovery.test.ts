import { describe, expect, it } from 'vitest'
import { DEFAULT_STATE, defaultSlots } from './config'
import type { RetryAction } from './types'
import { INITIAL_TURN_RECOVERY, turnRecoveryReducer } from './turnRecovery'

function action(kind: RetryAction['kind'] = 'player'): RetryAction {
  return {
    checkpoint: {
      turns: [],
      state: DEFAULT_STATE,
      plot: [],
      memory: {},
      ooc: [],
      chronicle: [],
      compactCutoff: 0,
    },
    kind,
    input: kind === 'player' ? 'open the door' : 'directive',
    restoreInput: kind === 'player' ? 'open the door' : '',
    slots: defaultSlots(),
  }
}

function snapshot() {
  return {
    turns: [],
    state: DEFAULT_STATE,
    plot: ['a beat'],
    memory: {},
    ooc: [],
    chronicle: [],
    compactCutoff: 0,
  }
}

describe('turnRecoveryReducer', () => {
  it('makes a started action available to both undo and retry', () => {
    const started = action()
    expect(turnRecoveryReducer(INITIAL_TURN_RECOVERY, { type: 'start', action: started })).toEqual({
      undo: started,
      retry: started,
      redo: null,
    })
  })

  it('removes undo but keeps retry when the current action is aborted', () => {
    const started = action()
    const recovery = { undo: started, retry: started, redo: null }
    expect(turnRecoveryReducer(recovery, { type: 'abort', action: started })).toEqual({
      undo: null,
      retry: started,
      redo: null,
    })
  })

  it('ignores a late abort from a superseded action', () => {
    const oldAction = action()
    const currentAction = action('continue')
    const recovery = { undo: currentAction, retry: currentAction, redo: null }
    expect(turnRecoveryReducer(recovery, { type: 'abort', action: oldAction })).toBe(recovery)
  })

  it('undo captures a redo snapshot; redo inverts back to undo', () => {
    const started = action()
    const recovery = { undo: started, retry: started, redo: null }
    const current = snapshot()
    const undone = turnRecoveryReducer(recovery, { type: 'undo', current })
    expect(undone).toEqual({
      undo: null,
      retry: started,
      redo: { checkpoint: current, action: started },
    })

    const redone = turnRecoveryReducer(undone, { type: 'redo' })
    expect(redone).toEqual({ undo: started, retry: started, redo: null })
  })

  it('a new turn clears any pending redo', () => {
    const previous = action()
    const undone = turnRecoveryReducer(
      { undo: previous, retry: previous, redo: null },
      { type: 'undo', current: snapshot() },
    )
    const next = action('continue')
    expect(turnRecoveryReducer(undone, { type: 'start', action: next })).toEqual({
      undo: next,
      retry: next,
      redo: null,
    })
  })

  it('keeps retry after undo and clears everything on reset', () => {
    const started = action('bootstrap')
    const recovery = { undo: started, retry: started, redo: null }
    const undone = turnRecoveryReducer(recovery, { type: 'undo', current: snapshot() })
    expect(undone.retry).toBe(started)
    expect(turnRecoveryReducer(undone, { type: 'reset' })).toEqual(INITIAL_TURN_RECOVERY)
  })
})
