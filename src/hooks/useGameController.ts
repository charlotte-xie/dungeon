import { useEffect, useReducer, useRef, useState } from 'react'
import { buildNewAdventureBootstrap, CONTINUE_DIRECTIVE } from '../prompts'
import {
  EmptyNarrativeError,
  runNarrator,
  type NarratorResult,
  type Plotting,
} from '../engine/agents/narrator'
import { runReviser } from '../engine/agents/reviser'
import {
  chronicleNeedsCompaction,
  compactCascade,
  memoryForCompaction,
  stripTracesBefore,
} from '../engine/chronicle'
import { DEFAULT_STATE, defaultSlots } from '../engine/config'
import { OperationCoordinator, type ActiveOperation } from '../engine/operation'
import { carryOocEdits, withRetryGuidance } from '../engine/steering'
import {
  recoveryForLog,
  removeFromBox,
  replyStatus,
  restoreInputFor,
  restoreIntoBox,
  turnRecoveryReducer,
} from '../engine/turnRecovery'
import {
  LS_COMPACT_CUTOFF,
  LS_TURNS,
  loadStoredChronicle,
  loadStoredMemory,
  loadStoredOoc,
  loadStoredOocBaseline,
  loadStoredPlot,
  loadStoredRecovery,
  loadStoredSlots,
  loadStoredState,
  loadStoredTurnsAndCutoff,
  persistChronicle,
  persistMemory,
  persistOoc,
  persistOocBaseline,
  persistPlot,
  persistRecovery,
  persistSlots,
  persistState,
} from '../engine/persistence'
import {
  type AdventureSlots,
  type Chronicle,
  type ContextConfig,
  type Memory,
  type ModelCall,
  type SamplingParams,
  type SavedGame,
  type StoryData,
  type TraceEvent,
  type Turn,
  type TurnKind,
  type WorldSnapshot,
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
  const [ooc, setOoc] = useState<string[]>(() => loadStoredOoc())
  // The OOC list as the engine last set it (turn result, restore, load). Edits
  // made since then are the player's own and survive Retry, Undo and Redo.
  // Stored, so a reload still knows which entries are the player's.
  const [storedOocBaseline] = useState(() => loadStoredOocBaseline() ?? ooc)
  const oocBaseline = useRef<string[]>(storedOocBaseline)
  const [chronicle, setChronicle] = useState<Chronicle>(() => loadStoredChronicle())
  const [{ turns: initialTurns, cutoff: initialCutoff }] = useState(() => loadStoredTurnsAndCutoff())
  const [turns, setTurns] = useState<Turn[]>(initialTurns)
  const [compactCutoff, setCompactCutoff] = useState<number>(initialCutoff)
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  // What the running operation is doing, and since when, so the player can
  // see which phase is taking the time.
  const [status, setStatus] = useState({ text: 'DM is thinking…', since: Date.now() })
  const [compactionError, setCompactionError] = useState<string | null>(null)
  const [recovery, dispatchRecovery] = useReducer(turnRecoveryReducer, initialTurns, (log) =>
    recoveryForLog(loadStoredRecovery(), log),
  )
  // Only moves that still fit the log are offered or carried out.
  const live = recoveryForLog(recovery, turns)
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : undefined
  // The latest turn has no reply in front of the player: the call failed, or
  // the app reloaded before it finished. Act waits until the player continues
  // or undoes it.
  const unanswered = !thinking && !!lastTurn && replyStatus(lastTurn) !== 'answered'
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

  useEffect(() => {
    persistRecovery(recovery)
  }, [recovery])

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

  // A new phase restarts the clock; the same phase keeps counting.
  function setStatusText(text: string) {
    setStatus((current) => (current.text === text ? current : { text, since: Date.now() }))
  }

  function beginOperation(replaceExisting = false, label = 'DM is thinking…'): ActiveOperation | null {
    const operation = operations.start(replaceExisting)
    if (!operation) return null
    setThinking(true)
    setStatus({ text: label, since: Date.now() })
    return operation
  }

  function finishOperation(operation: ActiveOperation) {
    if (operations.finish(operation)) setThinking(false)
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

  function commitOoc(next: string[]) {
    setOoc(next)
    persistOoc(next)
  }

  function setOocBaseline(next: string[]) {
    oocBaseline.current = next
    persistOocBaseline(next)
  }

  function commitEngineOoc(next: string[]) {
    setOocBaseline(next)
    commitOoc(next)
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

  function worldSnapshot(): WorldSnapshot {
    return { state, plot, memory, ooc, chronicle, compactCutoff }
  }

  // Returns the restored OOC list: the snapshot's, plus the player's own
  // edits since the engine last set it.
  function restoreWorld(saved: WorldSnapshot, currentOoc: string[] = ooc): string[] {
    const nextOoc = carryOocEdits(saved.ooc, oocBaseline.current, currentOoc)
    commitState(saved.state)
    commitPlot([...saved.plot])
    commitMemory(structuredClone(saved.memory))
    commitOoc(nextOoc)
    setOocBaseline([...saved.ooc])
    commitChronicle(saved.chronicle)
    commitCompactCutoff(saved.compactCutoff)
    return nextOoc
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

  // Appends a turn to the log and runs it. Its starting world is kept for
  // Undo, Retry and Stop.
  async function runTurn(args: {
    pendingTurn: Turn
    // The log and world the turn starts from.
    baseTurns: Turn[]
    world: WorldSnapshot
    // Slots to narrate with. newAdventure and retry pass the ones they just
    // committed, since React state hasn't re-rendered yet.
    slots: AdventureSlots
    replaceExisting?: boolean
  }) {
    const { pendingTurn, baseTurns, world } = args
    const turnSlots = args.slots
    const baseData: StoryData = {
      state: world.state,
      plot: world.plot,
      memory: world.memory,
      ooc: world.ooc,
    }
    const baseChronicle = world.chronicle
    const baseCutoff = world.compactCutoff
    // The adventure's first turn names its prompt caches: each role's requests
    // go to their own provider cache, under a key derived from this one.
    const cacheKey = baseTurns[0]?.id ?? pendingTurn.id
    // Reassigned if compaction commits at the start of the turn, so Undo,
    // Retry and Stop restore the compacted world: the fold is never reverted
    // or paid for twice.
    let before = { turnId: pendingTurn.id, world, slots: turnSlots }
    setTurns([...baseTurns, pendingTurn])
    dispatchRecovery({ type: 'start', before })
    // A cancelled turn puts back the world it started from, exactly, and the
    // player's action goes back in the box.
    const restoreCancelled = () => {
      restoreWorld(before.world, before.world.ooc)
      setTurns((ts) => ts.filter((t) => t.id !== pendingTurn.id))
      setInput((box) => restoreIntoBox(box, restoreInputFor(pendingTurn)))
      dispatchRecovery({ type: 'abort', turnId: pendingTurn.id })
    }
    // The Plotter plans the turn first, then the narrator writes it; with
    // every record switched off there is nothing to plan.
    const plans =
      context.includeWorldState ||
      context.includePlotOutline ||
      context.includeMemory ||
      context.includeOoc
    const firstStatus = plans ? 'DM is planning…' : 'DM is writing…'
    const operation = beginOperation(args.replaceExisting, firstStatus)
    if (!operation) {
      restoreCancelled()
      return
    }
    const { controller } = operation
    // The turn is the player's once its reply is written, and nothing runs
    // after that. Until then, Stop undoes it.
    const plotterModel = context.plotterModel.trim() || model
    const updateTurn = (patch: Partial<Turn>) => {
      setTurns((ts) => ts.map((t) => (t.id === pendingTurn.id ? { ...t, ...patch } : t)))
    }
    // A response can land just as the player presses Stop. A cancelled turn
    // must still be settled, while a superseded one belongs to its replacement.
    const stopIfCancelled = () => {
      if (isCurrentOperation(operation)) restoreCancelled()
    }
    // The Plotter's work shows on the turn as soon as it's done, while the
    // narrator writes. A plotter error rides on the plotter call, not the
    // reply: the turn itself can still succeed.
    const recordPlotting = (p: Plotting) => {
      updateTurn({
        plotter: {
          id: crypto.randomUUID(),
          model: plotterModel,
          trace: p.trace,
          reasoningTokens: p.reasoningTokens,
          error: p.error,
        },
        briefing: p.briefing.length ? p.briefing : undefined,
      })
    }
    // The reply, polished by the reviser when it's on; a failed polish shows
    // the draft instead.
    const replyFor = async (result: NarratorResult): Promise<Partial<Turn>> => {
      const draft: ModelCall = {
        ...pendingTurn.reply,
        text: result.text,
        trace: result.trace,
        reasoningTokens: result.reasoningTokens,
      }
      if (!context.useReviser) return { narrator: undefined, reply: draft }
      setStatusText('Reviser polishing…')
      try {
        const reviserCall = await runReviser(
          {
            model: context.reviserModel,
            apiKey,
            baseUrl,
            protocol: context.apiProtocol,
            cacheKey,
            slots: turnSlots,
            draft: result.text,
            sampling,
          },
          controller.signal,
        )
        return { narrator: { ...draft, id: crypto.randomUUID(), model }, reply: reviserCall }
      } catch (reviserErr) {
        if (controller.signal.aborted) throw reviserErr
        return {
          narrator: undefined,
          reply: { ...draft, trace: withReviserFailureNote(result.trace, reviserErr) },
        }
      }
    }
    try {
      const settings = {
        compactionThreshold: context.compactionThreshold,
        compactionFloor: context.compactionFloor,
        compactionBatch: context.compactionBatch,
      }
      const allTurns = [...baseTurns, pendingTurn]
      let workingChronicle = baseChronicle
      let workingCutoff = baseCutoff
      // Compact BEFORE the in-flight turn (we don't want to summarise a turn
      // that doesn't have a reply yet). We measure against `baseTurns`.
      if (chronicleNeedsCompaction(baseTurns, workingCutoff, workingChronicle, settings)) {
        let compacted: Awaited<ReturnType<typeof compactCascade>> | null = null
        try {
          compacted = await compactCascade(
            baseTurns,
            workingCutoff,
            workingChronicle,
            settings,
            {
              model: context.summarizerModel.trim() || model,
              reasoningEffort: context.summarizerReasoning,
              apiKey,
              baseUrl,
              protocol: context.apiProtocol,
              cacheKey,
              memory: memoryForCompaction(baseData.memory, context.includeMemory),
            },
            controller.signal,
            (label) => {
              if (operationCanCommit(operation)) setStatusText(label)
            },
          )
        } catch (err) {
          // A failed compaction doesn't sink the turn: the chronicle stays as
          // it was, the turn goes ahead, and the next turn tries again.
          if (controller.signal.aborted || !isCurrentOperation(operation)) throw err
          setCompactionError(err instanceof Error ? err.message : String(err))
        }
        if (!operationCanCommit(operation)) return stopIfCancelled()
        if (compacted) {
          setCompactionError(null)
          workingChronicle = compacted.chronicle
          workingCutoff = compacted.cutoff
          commitChronicle(workingChronicle)
          commitCompactCutoff(workingCutoff)
          setTurns((ts) => stripTracesBefore(ts, workingCutoff))
          // Compaction is story-invariant and already paid for: the turn now
          // starts from the compacted world.
          before = {
            ...before,
            world: { ...before.world, chronicle: workingChronicle, compactCutoff: workingCutoff },
          }
          dispatchRecovery({
            type: 'rebase',
            turnId: pendingTurn.id,
            chronicle: workingChronicle,
            compactCutoff: workingCutoff,
          })
        }
        setStatusText(firstStatus)
      }

      const result = await runNarrator(
        {
          systemPrompt,
          model,
          reasoningEffort: context.narratorReasoning,
          plotterModel: context.plotterModel,
          plotterReasoning: context.plotterReasoning,
          apiKey,
          baseUrl,
          protocol: context.apiProtocol,
          cacheKey,
          slots: turnSlots,
          chronicle: workingChronicle,
          history: allTurns.slice(workingCutoff),
          initialData: baseData,
          sampling,
          stateCleanupThreshold: context.stateCleanupChars,
          includePriorPlayerTurns: context.includePriorPlayerTurns,
          reminderAsSystem: context.reminderAsSystem,
          flags: {
            includeWorldState: context.includeWorldState,
            includePlotOutline: context.includePlotOutline,
            includeMemory: context.includeMemory,
            includeOoc: context.includeOoc,
          },
          nsfw: context.nsfw,
        },
        controller.signal,
        {
          onPlotted: (p) => {
            if (!operationCanCommit(operation)) return
            recordPlotting(p)
            setStatusText('DM is writing…')
          },
        },
      )
      if (!operationCanCommit(operation)) return stopIfCancelled()
      const reply = await replyFor(result)
      if (!operationCanCommit(operation)) return stopIfCancelled()
      updateTurn(reply)
      commitState(result.data.state)
      commitPlot(result.data.plot)
      commitMemory(result.data.memory)
      commitEngineOoc(result.data.ooc)
    } catch (err) {
      if (controller.signal.aborted || !isCurrentOperation(operation)) {
        stopIfCancelled()
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
                  error: err instanceof Error ? err.message : String(err),
                  trace: failureTrace,
                  reasoningTokens: failureReasoningTokens,
                },
              }
            : t,
        ),
      )
    } finally {
      finishOperation(operation)
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || operations.busy || unanswered) return
    setInput('')
    await runTurn({
      pendingTurn: makePendingTurn('player', text),
      baseTurns: turns,
      world: worldSnapshot(),
      slots,
    })
  }

  // Keep the story going. While the latest turn has no reply, that means
  // getting its reply rather than starting a new turn on top of it.
  async function continueStory() {
    if (operations.busy || turns.length === 0) return
    if (unanswered) return retry()
    await runTurn({
      pendingTurn: makePendingTurn('continue', CONTINUE_DIRECTIVE),
      baseTurns: turns,
      world: worldSnapshot(),
      slots,
    })
  }

  // The world the latest turn started from, and the settings it ran with. A
  // turn without a reply never changed the world, so when its stored record is
  // missing (older data, or storage was full) the world as it stands will do.
  function latestTurnStart() {
    if (live.before) return live.before
    if (!unanswered || !lastTurn) return null
    return { turnId: lastTurn.id, world: worldSnapshot(), slots }
  }

  // Remove the latest turn and go back to the world it started from.
  function undo() {
    const before = latestTurnStart()
    const last = turns[turns.length - 1]
    if (operations.busy || !before || !last) return
    // Keep what the turn left so Redo can put it back. The OOC list is
    // recorded as the engine left it; the player's own edits are carried
    // separately, so they survive both directions.
    const after = { ...worldSnapshot(), ooc: oocBaseline.current }
    const afterId = turns.length > 1 ? turns[turns.length - 2].id : null
    restoreWorld(before.world)
    setTurns(turns.slice(0, -1))
    setInput((box) => restoreIntoBox(box, restoreInputFor(last)))
    dispatchRecovery({ type: 'undo', undone: { afterId, turn: last, world: after } })
  }

  // Put the undone turn back, on top of the world as it stands now, so it can
  // be undone again.
  function redo() {
    const { undone } = live
    if (operations.busy || !undone) return
    const before = { turnId: undone.turn.id, world: worldSnapshot(), slots }
    restoreWorld(undone.world)
    setTurns([...turns, undone.turn])
    setInput((box) => removeFromBox(box, restoreInputFor(undone.turn)))
    dispatchRecovery({ type: 'redo', before })
  }

  // Run the latest turn again from the world it started in, leaving the action
  // box alone. Rewrite passes guidance for that one reply.
  async function retry(options: { guidance?: string } = {}) {
    const before = latestTurnStart()
    const last = turns[turns.length - 1]
    if (operations.busy || !before || !last) return
    const restoredOoc = restoreWorld(before.world)
    commitSlots(before.slots)
    const input = withRetryGuidance(last.input ?? '', options.guidance ?? '')
    await runTurn({
      pendingTurn: makePendingTurn(last.kind, input),
      baseTurns: turns.slice(0, -1),
      world: { ...before.world, ooc: restoredOoc },
      slots: before.slots,
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
    if (
      !confirm(
        'Compact the chronicle now? The oldest live turns are condensed into summary entries — the full text stays visible in your log, but the model will only see the summaries from then on. This is lossy, cannot be undone, and runs summariser model calls immediately.',
      )
    ) {
      return
    }
    const operation = beginOperation(false, 'Compacting chronicle…')
    if (!operation) return
    const { controller } = operation
    try {
      const compacted = await compactCascade(
        turns,
        compactCutoff,
        chronicle,
        settings,
        {
          model: context.summarizerModel.trim() || model,
          reasoningEffort: context.summarizerReasoning,
          apiKey,
          baseUrl,
          protocol: context.apiProtocol,
          cacheKey: turns[0]?.id,
          memory: memoryForCompaction(memory, context.includeMemory),
        },
        controller.signal,
        (label) => {
          if (operationCanCommit(operation)) setStatusText(label)
        },
      )
      if (!operationCanCommit(operation)) return
      setCompactionError(null)
      commitChronicle(compacted.chronicle)
      commitCompactCutoff(compacted.cutoff)
      setTurns((ts) => stripTracesBefore(ts, compacted.cutoff))
    } catch (err) {
      if (!controller.signal.aborted && isCurrentOperation(operation)) {
        alert(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      finishOperation(operation)
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
    commitEngineOoc([])
    commitChronicle([])
    commitCompactCutoff(0)
    setCompactionError(null)
    await runTurn({
      pendingTurn: makePendingTurn('bootstrap', buildNewAdventureBootstrap()),
      baseTurns: [],
      world: { state: freshState, plot: [], memory: {}, ooc: [], chronicle: [], compactCutoff: 0 },
      slots: nextSlots,
      replaceExisting: true,
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
      ooc: [...ooc],
      chronicle: structuredClone(chronicle),
      turns: structuredClone(completedTurns),
      compactCutoff: Math.min(compactCutoff, completedTurns.length),
    }
  }

  // Replace the current adventure with a saved one, cancelling any in-flight turn.
  function restoreGame(save: SavedGame) {
    supersedeCurrentOperation()
    dispatchRecovery({ type: 'reset' })
    setCompactionError(null)
    commitSlots({ ...defaultSlots(), ...save.slots })
    commitState(structuredClone(save.state))
    commitPlot([...(save.plot ?? [])])
    commitMemory(structuredClone(save.memory ?? {}))
    commitEngineOoc([...(save.ooc ?? [])])
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
    ooc,
    chronicle,
    turns,
    compactCutoff,
    canUndo: live.before !== null || unanswered,
    canRedo: live.undone !== null,
    canRetry: live.before !== null || unanswered,
    unanswered,
    // engine status
    input,
    setInput,
    thinking,
    statusText: status.text,
    statusSince: status.since,
    canCompact,
    compactionError,
    dismissCompactionError: () => setCompactionError(null),
    // actions
    send,
    continueStory,
    retry,
    undo,
    redo,
    compactNow,
    cancelOperation,
    newAdventure,
    editTurnInput,
    editTurnReply,
    // direct edits (StateViewer, SettingsPanel)
    commitState,
    commitPlot,
    commitOoc,
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
