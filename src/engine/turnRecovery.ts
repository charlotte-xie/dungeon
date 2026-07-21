import type { RetryAction } from './types'

export interface TurnRecovery {
  undo: RetryAction | null
  retry: RetryAction | null
}

export type TurnRecoveryEvent =
  | { type: 'start'; action: RetryAction }
  | { type: 'abort'; action: RetryAction }
  | { type: 'undo' }
  | { type: 'reset' }

export const INITIAL_TURN_RECOVERY: TurnRecovery = { undo: null, retry: null }

export function turnRecoveryReducer(
  recovery: TurnRecovery,
  event: TurnRecoveryEvent,
): TurnRecovery {
  switch (event.type) {
    case 'start':
      return { undo: event.action, retry: event.action }
    case 'abort':
      return recovery.undo === event.action ? { ...recovery, undo: null } : recovery
    case 'undo':
      return recovery.undo ? { ...recovery, undo: null } : recovery
    case 'reset':
      return INITIAL_TURN_RECOVERY
  }
}
