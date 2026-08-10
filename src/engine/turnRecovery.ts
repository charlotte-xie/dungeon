import type { RetryAction, TurnCheckpoint } from './types'

export interface TurnRecovery {
  undo: RetryAction | null
  retry: RetryAction | null
  // Snapshot captured at undo time so the undo can be inverted. Cleared by
  // any new turn and by reset — redo is only valid immediately after an undo.
  redo: { checkpoint: TurnCheckpoint; action: RetryAction } | null
}

export type TurnRecoveryEvent =
  | { type: 'start'; action: RetryAction }
  | { type: 'abort'; action: RetryAction }
  | { type: 'undo'; current: TurnCheckpoint }
  | { type: 'redo' }
  | { type: 'reset' }

export const INITIAL_TURN_RECOVERY: TurnRecovery = { undo: null, retry: null, redo: null }

export function turnRecoveryReducer(
  recovery: TurnRecovery,
  event: TurnRecoveryEvent,
): TurnRecovery {
  switch (event.type) {
    case 'start':
      return { undo: event.action, retry: event.action, redo: null }
    case 'abort':
      return recovery.undo === event.action ? { ...recovery, undo: null } : recovery
    case 'undo':
      return recovery.undo
        ? {
            undo: null,
            retry: recovery.retry,
            redo: { checkpoint: event.current, action: recovery.undo },
          }
        : recovery
    case 'redo':
      return recovery.redo
        ? { undo: recovery.redo.action, retry: recovery.retry, redo: null }
        : recovery
    case 'reset':
      return INITIAL_TURN_RECOVERY
  }
}
