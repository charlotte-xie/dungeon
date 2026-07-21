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
      chronicle: [],
      compactCutoff: 0,
    },
    kind,
    input: kind === 'player' ? 'open the door' : 'directive',
    restoreInput: kind === 'player' ? 'open the door' : '',
    slots: defaultSlots(),
  }
}

describe('turnRecoveryReducer', () => {
  it('makes a started action available to both undo and retry', () => {
    const started = action()
    expect(turnRecoveryReducer(INITIAL_TURN_RECOVERY, { type: 'start', action: started })).toEqual({
      undo: started,
      retry: started,
    })
  })

  it('removes undo but keeps retry when the current action is aborted', () => {
    const started = action()
    const recovery = { undo: started, retry: started }
    expect(turnRecoveryReducer(recovery, { type: 'abort', action: started })).toEqual({
      undo: null,
      retry: started,
    })
  })

  it('ignores a late abort from a superseded action', () => {
    const oldAction = action()
    const currentAction = action('continue')
    const recovery = { undo: currentAction, retry: currentAction }
    expect(turnRecoveryReducer(recovery, { type: 'abort', action: oldAction })).toBe(recovery)
  })

  it('keeps retry after undo and clears both on reset', () => {
    const started = action('bootstrap')
    const recovery = { undo: started, retry: started }
    const undone = turnRecoveryReducer(recovery, { type: 'undo' })
    expect(undone).toEqual({ undo: null, retry: started })
    expect(turnRecoveryReducer(undone, { type: 'reset' })).toEqual(INITIAL_TURN_RECOVERY)
  })
})
