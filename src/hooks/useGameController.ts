import { useEffect, useReducer, useState } from 'react'
import { buildNewAdventureBootstrap } from '../prompts'
import { EmptyNarrativeError, runNarrator } from '../engine/agents/narrator'
import { runReviser } from '../engine/agents/reviser'
import {
  chronicleNeedsCompaction,
  compactCascade,
  memoryForCompaction,
  stripTracesBefore,
} from '../engine/chronicle'
import { DEFAULT_STATE, defaultSlots } from '../engine/config'
import { OperationCoordinator, type ActiveOperation } from '../engine/operation'
import { INITIAL_TURN_RECOVERY, turnRecoveryReducer } from '../engine/turnRecovery'
import {
  LS_COMPACT_CUTOFF,
  LS_TURNS,
  loadStoredChronicle,
  loadStoredMemory,
  loadStoredPlot,
  loadStoredSlots,
  loadStoredState,
  loadStoredTurnsAndCutoff,
  persistChronicle,
  persistMemory,
  persistPlot,
  persistSlots,
  persistState,
} from '../engine/persistence'
import {
  CONTINUE_DIRECTIVE,
  type AdventureSlots,
  type Chronicle,
  type ContextConfig,
  type Memory,
  type ModelCall,
  type RetryAction,
  type SamplingParams,
  type SavedGame,
  type TraceEvent,
  type Turn,
  type TurnKind,
  type TurnCheckpoint,
  type WorldState,
} from '../engine/types'

// Everything the turn engine needs from app settings. Owned by useSettings;
// passed in each render so the controller always sees the current values.
export interface GameSettings {
  systemPrompt: string
  model: string
  apiKey: string
  baseUrl: string
  sampling: SamplingParams
  context: ContextConfig
}

// The adventure data captured into a save slot (everything but the save's
// own id/name/timestamp).
export type GameData = Omit<SavedGame, 'id' | 'name' | 'savedAt'>

// When the reviser pass fails, fall back to the narrator's draft rather than
// losing an otherwise-good turn. Append a trace note so it's visible that the
// reviser was skipped and the unrevised prose is being shown.
function withReviserFailureNote(trace: TraceEvent[], err: unknown): TraceEvent[] {
  const msg = err instanceof Error ? err.message : String(err)
  return [
    ...trace,
    {
      kind: 'thought',
      text: `(reviser failed: ${msg} — showing the unrevised narrator draft)`,
    },
  ]
}

// The game controller: owns all adventure state (slots, world state, plot,
// memory, chronicle, turns, recovery state) and the turn engine that mutates it.
// App.tsx is a pure view over what this returns.
export function useGameController(settings: GameSettings) {
  const { systemPrompt, model, apiKey, baseUrl, sampling, context } = settings

  const [slots, setSlots] = useState<AdventureSlots>(() => loadStoredSlots())
  const [state, setState] = useState<WorldState>(() => loadStoredState())
  const [plot, setPlot] = useState<string[]>(() => loadStoredPlot())
  const [memory, setMemory] = useState<Memory>(() => loadStoredMemory())
  const [chronicle, setChronicle] = useState<Chronicle>(() => loadStoredChronicle())
  const [{ turns: initialTurns, cutoff: initialCutoff }] = useState(() => loadStoredTurnsAndCutoff())
  const [turns, setTurns] = useState<Turn[]>(initialTurns)
  const [compactCutoff, setCompactCutoff] = useState<number>(initialCutoff)
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [statusText, setStatusText] = useState('DM is thinking…')
  const [recovery, dispatchRecovery] = useReducer(turnRecoveryReducer, INITIAL_TURN_RECOVERY)
  const [operations] = useState(() => new OperationCoordinator())

  const canCompact = chronicleNeedsCompaction(turns, compactCutoff, chronicle, {
    compactionThreshold: context.compactionThreshold,
    compactionFloor: context.compactionFloor,
    compactionBatch: context.compactionBatch,
  })

  useEffect(() => {
    try {
      localStorage.setItem(LS_TURNS, JSON.stringify(turns))
    } catch {
      // ignore quota / disabled storage
    }
  }, [turns])

  useEffect(
    () => () => {
      operations.supersede()
    },
    [operations],
  )

  function isCurrentOperation(operation: ActiveOperation): boolean {
    return operations.isCurrent(operation)
  }

  function operationCanCommit(operation: ActiveOperation): boolean {
    return operations.canCommit(operation)
  }

  function beginOperation(replaceExisting = false): ActiveOperation | null {
    const operation = operations.start(replaceExisting)
    if (!operation) return null
    setThinking(true)
    return operation
  }

  function supersedeCurrentOperation() {
    operations.supersede()
    setThinking(false)
  }

  function cancelOperation() {
    if (!operations.cancel()) return
    setStatusText('Cancelling…')
  }

  function commitState(next: WorldState) {
    setState(next)
    persistState(next)
  }

  function commitPlot(next: string[]) {
    setPlot(next)
    persistPlot(next)
  }

  function commitMemory(next: Memory) {
    setMemory(next)
    persistMemory(next)
  }

  function commitSlots(next: AdventureSlots) {
    setSlots(next)
    persistSlots(next)
  }

  function commitChronicle(next: Chronicle) {
    setChronicle(next)
    persistChronicle(next)
  }

  function commitCompactCutoff(next: number) {
    setCompactCutoff(next)
    try {
      if (next > 0) localStorage.setItem(LS_COMPACT_CUTOFF, String(next))
      else localStorage.removeItem(LS_COMPACT_CUTOFF)
    } catch {
      // ignore
    }
  }

  function checkpoint(): TurnCheckpoint {
    return { turns, state, plot, memory, chronicle, compactCutoff }
  }

  function restoreCheckpoint(saved: TurnCheckpoint) {
    setTurns(saved.turns)
    commitState(saved.state)
    commitPlot([...saved.plot])
    commitMemory(structuredClone(saved.memory))
    commitChronicle(saved.chronicle)
    commitCompactCutoff(saved.compactCutoff)
  }

  function restoreAbortedAction(action: RetryAction) {
    restoreCheckpoint(action.checkpoint)
    setInput(action.restoreInput)
    dispatchRecovery({ type: 'abort', action })
  }

  function editTurnInput(id: string, next: string) {
    setTurns((cur) => cur.map((t) => (t.id === id ? { ...t, input: next } : t)))
  }

  function editTurnReply(id: string, next: string) {
    setTurns((cur) =>
      cur.map((t) => (t.id === id ? { ...t, reply: { ...t.reply, text: next } } : t)),
    )
  }

  function makePendingTurn(kind: TurnKind, turnInput: string): Turn {
    const reply: ModelCall = { id: crypto.randomUUID(), model, text: '' }
    return { id: crypto.randomUUID(), kind, input: turnInput, reply }
  }

  async function runTurn(args: {
    pendingTurn: Turn
    // The recovery action for this turn. Its checkpoint is rebased in place
    // when compaction commits mid-turn, so undo/retry/abort restore to the
    // post-compaction world — the fold itself is never reverted or re-paid.
    // (In-place mutation keeps the object identity the recovery reducer and
    // abort closures rely on.)
    action: RetryAction
    baseTurns: Turn[]
    baseState: WorldState
    basePlot: string[]
    baseMemory: Memory
    baseChronicle: Chronicle
    baseCutoff: number
    // Slots to narrate with — defaults to current slots; newAdventure passes
    // the freshly-committed ones since React state hasn't re-rendered yet.
    slotsForTurn?: AdventureSlots
    replaceExisting?: boolean
    onAbortRestore: () => void
  }) {
    const { pendingTurn, baseTurns, baseState, basePlot, baseMemory, baseChronicle, baseCutoff } =
      args
    const turnSlots = args.slotsForTurn ?? slots
    const operation = beginOperation(args.replaceExisting)
    if (!operation) {
      args.onAbortRestore()
      return
    }
    setStatusText('DM is thinking…')
    const { controller } = operation
    try {
      const settings = {
        compactionThreshold: context.compactionThreshold,
        compactionFloor: context.compactionFloor,
        compactionBatch: context.compactionBatch,
      }
      const allTurns = [...baseTurns, pendingTurn]
      let workingChronicle = baseChronicle
      let workingCutoff = baseCutoff
      // Compact BEFORE the in-flight turn (we don't want to summarize a turn
      // that doesn't have a reply yet). We measure against `baseTurns`.
      if (chronicleNeedsCompaction(baseTurns, workingCutoff, workingChronicle, settings)) {
        const compacted = await compactCascade(
          baseTurns,
          workingCutoff,
          workingChronicle,
          settings,
          {
            model,
            apiKey,
            baseUrl,
            memory: memoryForCompaction(baseMemory, context.includeMemory),
          },
          controller.signal,
          (label) => {
            if (operationCanCommit(operation)) setStatusText(label)
          },
        )
        if (!operationCanCommit(operation)) return
        workingChronicle = compacted.chronicle
        workingCutoff = compacted.cutoff
        commitChronicle(workingChronicle)
        commitCompactCutoff(workingCutoff)
        setTurns((ts) => stripTracesBefore(ts, workingCutoff))
        // Compaction is story-invariant and already paid for: rebase the
        // recovery checkpoint on the compacted world so undo reverts the
        // in-flight turn but never the fold.
        args.action.checkpoint = {
          turns: stripTracesBefore(baseTurns, workingCutoff),
          state: baseState,
          plot: basePlot,
          memory: baseMemory,
          chronicle: workingChronicle,
          compactCutoff: workingCutoff,
        }
        setStatusText('DM is thinking…')
      }

      const result = await runNarrator(
        {
          systemPrompt,
          model,
          apiKey,
          baseUrl,
          slots: turnSlots,
          chronicle: workingChronicle,
          history: allTurns.slice(workingCutoff),
          initialState: baseState,
          initialPlot: basePlot,
          initialMemory: baseMemory,
          sampling,
          stateCleanupThreshold: context.stateCleanupChars,
          includePriorPlayerTurns: context.includePriorPlayerTurns,
          reminderAsSystem: context.reminderAsSystem,
          includeWorldState: context.includeWorldState,
          includePlotOutline: context.includePlotOutline,
          includeMemory: context.includeMemory,
          nsfw: context.nsfw,
        },
        controller.signal,
      )
      if (!operationCanCommit(operation)) return

      const narratorCall: ModelCall = {
        id: crypto.randomUUID(),
        model,
        text: result.text,
        trace: result.trace,
        reasoningTokens: result.reasoningTokens,
      }
      const plotterCall: ModelCall | undefined = result.plotterTrace
        ? { id: crypto.randomUUID(), model, trace: result.plotterTrace }
        : undefined
      if (context.useReviser) {
        setTurns((ts) =>
          ts.map((t) =>
            t.id === pendingTurn.id
              ? {
                  ...t,
                  narrator: narratorCall,
                  plotter: plotterCall,
                }
              : t,
          ),
        )
        setStatusText('Reviser polishing…')
        try {
          const reviserCall = await runReviser(
            {
              model: context.reviserModel,
              apiKey,
              baseUrl,
              slots: turnSlots,
              draft: result.text,
              sampling,
            },
            controller.signal,
          )
          if (!operationCanCommit(operation)) return
          setTurns((ts) =>
            ts.map((t) =>
              t.id === pendingTurn.id
                ? { ...t, reply: reviserCall }
                : t,
            ),
          )
        } catch (reviserErr) {
          if (controller.signal.aborted) throw reviserErr
          // Reviser failed — show the narrator's draft instead of losing the turn.
          setTurns((ts) =>
            ts.map((t) =>
              t.id === pendingTurn.id
                ? {
                    ...t,
                    narrator: undefined,
                    reply: {
                      ...t.reply,
                      text: result.text,
                      trace: withReviserFailureNote(result.trace, reviserErr),
                      reasoningTokens: result.reasoningTokens,
                    },
                  }
                : t,
            ),
          )
        }
      } else {
        setTurns((ts) =>
          ts.map((t) =>
            t.id === pendingTurn.id
              ? {
                  ...t,
                  narrator: undefined,
                  plotter: plotterCall,
                  reply: {
                    ...t.reply,
                    text: result.text,
                    trace: result.trace,
                    reasoningTokens: result.reasoningTokens,
                  },
                }
              : t,
          ),
        )
      }
      if (!operationCanCommit(operation)) return
      commitState(result.state)
      commitPlot(result.plot)
      commitMemory(result.memory)
    } catch (err) {
      if (controller.signal.aborted || !isCurrentOperation(operation)) {
        if (isCurrentOperation(operation)) args.onAbortRestore()
        return
      }
      const failureText = `(The dungeon master falters: ${err instanceof Error ? err.message : String(err)})`
      // If the model thought but never produced prose, keep its trace so the
      // player can still see what the DM was reasoning about.
      const failureTrace = err instanceof EmptyNarrativeError ? err.trace : undefined
      const failureReasoningTokens =
        err instanceof EmptyNarrativeError ? err.reasoningTokens : undefined
      setTurns((ts) =>
        ts.map((t) =>
          t.id === pendingTurn.id
            ? {
                ...t,
                reply: {
                  ...t.reply,
                  text: failureText,
                  trace: failureTrace,
                  reasoningTokens: failureReasoningTokens,
                },
              }
            : t,
        ),
      )
    } finally {
      if (operations.finish(operation)) {
        setThinking(false)
      }
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || operations.busy) return
    setInput('')
    const action: RetryAction = {
      checkpoint: checkpoint(),
      input: text,
      restoreInput: text,
      kind: 'player',
      slots,
    }
    dispatchRecovery({ type: 'start', action })
    const pendingTurn = makePendingTurn('player', text)
    setTurns([...turns, pendingTurn])
    await runTurn({
      pendingTurn,
      action,
      baseTurns: turns,
      baseState: state,
      basePlot: plot,
      baseMemory: memory,
      baseChronicle: chronicle,
      baseCutoff: compactCutoff,
      onAbortRestore: () => restoreAbortedAction(action),
    })
  }

  async function continueStory() {
    if (operations.busy || turns.length === 0) return
    const action: RetryAction = {
      checkpoint: checkpoint(),
      input: CONTINUE_DIRECTIVE,
      restoreInput: '',
      kind: 'continue',
      slots,
    }
    dispatchRecovery({ type: 'start', action })
    const pendingTurn = makePendingTurn('continue', CONTINUE_DIRECTIVE)
    setTurns([...turns, pendingTurn])
    await runTurn({
      pendingTurn,
      action,
      baseTurns: turns,
      baseState: state,
      basePlot: plot,
      baseMemory: memory,
      baseChronicle: chronicle,
      baseCutoff: compactCutoff,
      onAbortRestore: () => restoreAbortedAction(action),
    })
  }

  function undo() {
    if (operations.busy || !recovery.undo) return
    restoreCheckpoint(recovery.undo.checkpoint)
    setInput(recovery.undo.restoreInput)
    dispatchRecovery({ type: 'undo' })
  }

  async function retry() {
    if (operations.busy || !recovery.retry) return
    const action = recovery.retry
    const base = action.checkpoint
    restoreCheckpoint(base)
    commitSlots(action.slots)
    setInput('')
    dispatchRecovery({ type: 'start', action })
    const pendingTurn = makePendingTurn(action.kind, action.input)
    setTurns([...base.turns, pendingTurn])
    await runTurn({
      pendingTurn,
      action,
      baseTurns: base.turns,
      baseState: base.state,
      basePlot: base.plot,
      baseMemory: base.memory,
      baseChronicle: base.chronicle,
      baseCutoff: base.compactCutoff,
      slotsForTurn: action.slots,
      onAbortRestore: () => restoreAbortedAction(action),
    })
  }

  async function compactNow() {
    if (operations.busy) return
    const settings = {
      compactionThreshold: context.compactionThreshold,
      compactionFloor: context.compactionFloor,
      compactionBatch: context.compactionBatch,
    }
    if (!chronicleNeedsCompaction(turns, compactCutoff, chronicle, settings)) {
      alert('Nothing to compact: chronicle is up to date.')
      return
    }
    setStatusText('Compacting chronicle…')
    const operation = beginOperation()
    if (!operation) return
    const { controller } = operation
    try {
      const compacted = await compactCascade(
        turns,
        compactCutoff,
        chronicle,
        settings,
        {
          model,
          apiKey,
          baseUrl,
          memory: memoryForCompaction(memory, context.includeMemory),
        },
        controller.signal,
        (label) => {
          if (operationCanCommit(operation)) setStatusText(label)
        },
      )
      if (!operationCanCommit(operation)) return
      commitChronicle(compacted.chronicle)
      commitCompactCutoff(compacted.cutoff)
      setTurns((ts) => stripTracesBefore(ts, compacted.cutoff))
    } catch (err) {
      if (!controller.signal.aborted && isCurrentOperation(operation)) {
        alert(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      if (operations.finish(operation)) {
        setThinking(false)
      }
    }
  }

  async function newAdventure(slotsOverride: AdventureSlots) {
    const nextSlots: AdventureSlots = { ...slots, ...slotsOverride }
    nextSlots.scenario = nextSlots.scenario.trim()
    if (!nextSlots.scenario) return
    commitSlots(nextSlots)
    setInput('')
    const freshState = structuredClone(DEFAULT_STATE)
    commitState(freshState)
    commitPlot([])
    commitMemory({})
    commitChronicle([])
    commitCompactCutoff(0)
    const action: RetryAction = {
      checkpoint: {
        turns: [],
        state: freshState,
        plot: [],
        memory: {},
        chronicle: [],
        compactCutoff: 0,
      },
      input: buildNewAdventureBootstrap(),
      restoreInput: '',
      kind: 'bootstrap',
      slots: nextSlots,
    }
    dispatchRecovery({ type: 'start', action })
    const pendingTurn = makePendingTurn(action.kind, action.input)
    setTurns([pendingTurn])
    await runTurn({
      pendingTurn,
      action,
      baseTurns: [],
      baseState: freshState,
      basePlot: [],
      baseMemory: {},
      baseChronicle: [],
      baseCutoff: 0,
      slotsForTurn: nextSlots,
      replaceExisting: true,
      onAbortRestore: () => restoreAbortedAction(action),
    })
  }

  // Deep-copy the current adventure for a save slot.
  function captureGame(): GameData {
    const completedTurns = turns.filter((turn) => !!turn.reply.text)
    return {
      slots: { ...slots },
      state: structuredClone(state),
      plot: [...plot],
      memory: structuredClone(memory),
      chronicle: structuredClone(chronicle),
      turns: structuredClone(completedTurns),
      compactCutoff: Math.min(compactCutoff, completedTurns.length),
    }
  }

  // Replace the current adventure with a saved one, cancelling any in-flight turn.
  function restoreGame(save: SavedGame) {
    supersedeCurrentOperation()
    dispatchRecovery({ type: 'reset' })
    commitSlots({ ...defaultSlots(), ...save.slots })
    commitState(structuredClone(save.state))
    commitPlot([...(save.plot ?? [])])
    commitMemory(structuredClone(save.memory ?? {}))
    commitChronicle(save.chronicle ?? [])
    setTurns(save.turns)
    commitCompactCutoff(save.compactCutoff)
  }

  return {
    // adventure state
    slots,
    state,
    plot,
    memory,
    chronicle,
    turns,
    compactCutoff,
    canUndo: recovery.undo !== null,
    canRetry: recovery.retry !== null,
    // engine status
    input,
    setInput,
    thinking,
    statusText,
    canCompact,
    // actions
    send,
    continueStory,
    retry,
    undo,
    compactNow,
    cancelOperation,
    newAdventure,
    editTurnInput,
    editTurnReply,
    // direct edits (StateViewer, SettingsPanel)
    commitState,
    commitPlot,
    commitMemory,
    commitSlots,
    commitChronicle,
    commitCompactCutoff,
    // saves
    captureGame,
    restoreGame,
  }
}

export type GameController = ReturnType<typeof useGameController>
