import type { Chronicle, Turn, TurnRecovery } from './types'

export type TurnRecoveryEvent =
  | { type: 'start'; before: NonNullable<TurnRecovery['before']> }
  | { type: 'rebase'; turnId: string; chronicle: Chronicle; compactCutoff: number }
  | { type: 'abort'; turnId: string }
  | { type: 'undo'; undone: NonNullable<TurnRecovery['undone']> }
  | { type: 'redo'; before: NonNullable<TurnRecovery['before']> }
  | { type: 'reset' }

export const INITIAL_TURN_RECOVERY: TurnRecovery = { before: null, undone: null }

// The action box may hold a draft or pending one-reply guidance when the
// player undoes, redoes, or cancels. Restored input goes above it rather than
// replacing it, and redo removes only what undo put back.
export function restoreIntoBox(box: string, restored: string): string {
  const text = restored.trim()
  if (!text) return box
  return box.trim() ? `${text}\n\n${box.trim()}` : text
}

export function removeFromBox(box: string, restored: string): string {
  const text = restored.trim()
  const current = box.trim()
  if (!text) return box
  if (current === text) return ''
  if (current.startsWith(`${text}\n\n`)) return current.slice(text.length).trim()
  return box
}

// Whether the player has the DM's reply to a turn in front of them. A turn
// without one either failed (the model call threw) or was interrupted: the app
// reloaded before the reply arrived, so nothing was saved. Either way, the
// world was never changed by it.
export function replyStatus(turn: Turn): 'answered' | 'failed' | 'interrupted' {
  if (turn.reply.error) return 'failed'
  return turn.reply.text ? 'answered' : 'interrupted'
}

// What goes back in the action box when a turn is undone or cancelled: the
// player's own words, never an engine directive.
export function restoreInputFor(turn: Pick<Turn, 'kind' | 'input'>): string {
  return turn.kind === 'player' ? (turn.input ?? '') : ''
}

// Keeps only the recovery that still fits the log: `before` must belong to
// the latest turn, and an undone turn must go back on top of the turn it was
// removed from. Anything else is stale and is dropped.
export function recoveryForLog(recovery: TurnRecovery, turns: Turn[]): TurnRecovery {
  const lastId = turns.length > 0 ? turns[turns.length - 1].id : null
  const { before, undone } = recovery
  const nextBefore = before && before.turnId === lastId ? before : null
  const nextUndone =
    undone && undone.afterId === lastId && !turns.some((t) => t.id === undone.turn.id)
      ? undone
      : null
  if (nextBefore === before && nextUndone === undone) return recovery
  return { before: nextBefore, undone: nextUndone }
}

export function turnRecoveryReducer(
  recovery: TurnRecovery,
  event: TurnRecoveryEvent,
): TurnRecovery {
  switch (event.type) {
    // A new turn can be undone or retried, and nothing undone can come back.
    case 'start':
      return { before: event.before, undone: null }
    // Compaction at the start of a turn is already paid for: undoing the turn
    // keeps the folded chronicle.
    case 'rebase':
      return recovery.before?.turnId === event.turnId
        ? {
            ...recovery,
            before: {
              ...recovery.before,
              world: {
                ...recovery.before.world,
                chronicle: event.chronicle,
                compactCutoff: event.compactCutoff,
              },
            },
          }
        : recovery
    // A cancelled turn leaves nothing to undo or retry: its input is back in
    // the action box, and the reply now shown wasn't made from this world. A
    // late abort from a turn that was replaced changes nothing.
    case 'abort':
      return recovery.before?.turnId === event.turnId ? { ...recovery, before: null } : recovery
    case 'undo':
      return { before: null, undone: event.undone }
    case 'redo':
      return { before: event.before, undone: null }
    case 'reset':
      return INITIAL_TURN_RECOVERY
  }
}
