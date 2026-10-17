import { describe, expect, it } from 'vitest'
import { DEFAULT_STATE, defaultSlots } from './config'
import type { Turn, TurnRecovery, WorldSnapshot } from './types'
import {
  INITIAL_TURN_RECOVERY,
  recoveryForLog,
  removeFromBox,
  replyStatus,
  restoreInputFor,
  restoreIntoBox,
  turnRecoveryReducer,
} from './turnRecovery'

function world(plot: string[] = []): WorldSnapshot {
  return { state: DEFAULT_STATE, plot, memory: {}, ooc: [], chronicle: [], compactCutoff: 0 }
}

function turn(id: string, kind: Turn['kind'] = 'player', input = 'open the door'): Turn {
  return { id, kind, input, reply: { id: `${id}-reply`, model: 'test', text: 'It opens.' } }
}

function before(turnId: string) {
  return { turnId, world: world(['before']), slots: defaultSlots() }
}

function undone(id: string, afterId: string | null) {
  return { afterId, turn: turn(id), world: world(['after']) }
}

describe('turnRecoveryReducer', () => {
  it('starting a turn makes it undoable and drops anything undone', () => {
    const recovery: TurnRecovery = { before: null, undone: undone('t2', 't1') }
    expect(turnRecoveryReducer(recovery, { type: 'start', before: before('t3') })).toEqual({
      before: before('t3'),
      undone: null,
    })
  })

  it('cancelling the current turn leaves nothing to undo or retry', () => {
    const recovery: TurnRecovery = { before: before('t1'), undone: null }
    expect(turnRecoveryReducer(recovery, { type: 'abort', turnId: 't1' })).toEqual(INITIAL_TURN_RECOVERY)
  })

  it('ignores a late cancel from a turn that was replaced', () => {
    const recovery: TurnRecovery = { before: before('t2'), undone: null }
    expect(turnRecoveryReducer(recovery, { type: 'abort', turnId: 't1' })).toBe(recovery)
  })

  it('undo keeps the removed turn for redo, and redo makes it undoable again', () => {
    const recovery: TurnRecovery = { before: before('t2'), undone: null }
    const undoneTurn = undone('t2', 't1')
    const afterUndo = turnRecoveryReducer(recovery, { type: 'undo', undone: undoneTurn })
    expect(afterUndo).toEqual({ before: null, undone: undoneTurn })

    const afterRedo = turnRecoveryReducer(afterUndo, { type: 'redo', before: before('t2') })
    expect(afterRedo).toEqual({ before: before('t2'), undone: null })
  })

  it('compaction at the start of a turn changes only the chronicle and cutoff it restores', () => {
    const chronicle = [[{ id: 'c1', text: 'Earlier.', turnsCovered: 2, createdAt: 1 }]]
    const recovery: TurnRecovery = { before: before('t3'), undone: null }
    const rebased = turnRecoveryReducer(recovery, {
      type: 'rebase',
      turnId: 't3',
      chronicle,
      compactCutoff: 2,
    })
    expect(rebased.before?.world).toEqual({ ...world(['before']), chronicle, compactCutoff: 2 })
    expect(rebased.before?.turnId).toBe('t3')
    expect(
      turnRecoveryReducer(recovery, { type: 'rebase', turnId: 'other', chronicle, compactCutoff: 2 }),
    ).toBe(recovery)
  })

  it('clears everything on reset', () => {
    const recovery: TurnRecovery = { before: before('t1'), undone: undone('t2', 't1') }
    expect(turnRecoveryReducer(recovery, { type: 'reset' })).toEqual(INITIAL_TURN_RECOVERY)
  })
})

describe('recoveryForLog', () => {
  const log = [turn('t1', 'bootstrap', 'begin'), turn('t2')]

  it('keeps recovery that belongs to the end of the log', () => {
    const recovery: TurnRecovery = { before: before('t2'), undone: null }
    expect(recoveryForLog(recovery, log)).toBe(recovery)
    const afterUndo: TurnRecovery = { before: null, undone: undone('t3', 't2') }
    expect(recoveryForLog(afterUndo, log)).toBe(afterUndo)
  })

  it('drops undo for a turn that is no longer the latest', () => {
    expect(recoveryForLog({ before: before('t1'), undone: null }, log)).toEqual(INITIAL_TURN_RECOVERY)
    expect(recoveryForLog({ before: before('t1'), undone: null }, [])).toEqual(INITIAL_TURN_RECOVERY)
  })

  it('drops a redo that would not go back in the same place', () => {
    expect(recoveryForLog({ before: null, undone: undone('t3', 't1') }, log)).toEqual(INITIAL_TURN_RECOVERY)
    expect(recoveryForLog({ before: null, undone: undone('t2', 't2') }, log)).toEqual(INITIAL_TURN_RECOVERY)
  })

  it('lets the opening turn be redone onto an empty log', () => {
    const recovery: TurnRecovery = { before: null, undone: undone('t1', null) }
    expect(recoveryForLog(recovery, [])).toBe(recovery)
  })
})

describe('action box across undo and redo', () => {
  it('puts undone input above a draft instead of replacing it', () => {
    const guidance = '(OOC: NEXT REPLY ONLY — Slow down.)'
    expect(restoreIntoBox('', 'I open the door.')).toBe('I open the door.')
    expect(restoreIntoBox(guidance, 'I open the door.')).toBe(`I open the door.\n\n${guidance}`)
    expect(restoreIntoBox('Draft', '')).toBe('Draft')
  })

  it('removes only what undo put back', () => {
    const guidance = '(OOC: NEXT REPLY ONLY — Slow down.)'
    expect(removeFromBox('I open the door.', 'I open the door.')).toBe('')
    expect(removeFromBox(`I open the door.\n\n${guidance}`, 'I open the door.')).toBe(guidance)
    expect(removeFromBox('Something else', 'I open the door.')).toBe('Something else')
  })

  it("puts back the player's words, never an engine directive", () => {
    expect(restoreInputFor({ kind: 'player', input: 'I open the door.' })).toBe('I open the door.')
    expect(restoreInputFor({ kind: 'continue', input: 'Continue the story.' })).toBe('')
    expect(restoreInputFor({ kind: 'bootstrap', input: 'Begin.' })).toBe('')
  })
})

describe('replyStatus', () => {
  it('tells an answered turn from a failed or interrupted one', () => {
    expect(replyStatus(turn('t1'))).toBe('answered')
    const failed = turn('t2')
    failed.reply = { ...failed.reply, text: '(The dungeon master falters: boom)', error: 'boom' }
    expect(replyStatus(failed)).toBe('failed')
    const interrupted = turn('t3')
    interrupted.reply = { id: 'r3', model: 'test', text: '' }
    expect(replyStatus(interrupted)).toBe('interrupted')
  })
})
