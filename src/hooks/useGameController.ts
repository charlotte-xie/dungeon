import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { buildNewAdventureBootstrap, continueDirective, promptOverrides } from '../prompts'
import { applyPromptOverrides } from './usePromptOverrides'
import {
  EmptyNarrativeError,
  nextTurnRequests,
  runNarrator,
  type NarratorContext,
  type NarratorResult,
  type PlotterStage,
  type Plotting,
} from '../engine/agents/narrator'
import { reviserRequest, runReviser } from '../engine/agents/reviser'
import { summarizerRequest } from '../engine/agents/summarizer'
import { wireRequest } from '../engine/model/client'
import type { WireRequest } from '../engine/model/types'
import {
  canCompact,
  chronicleCutoff,
  chronicleNeedsCompaction,
  chronicleRanges,
  compactChronicle,
  nextFold,
  rebuildCallCount,
  rebuildChronicle,
  sameChronicle,
  stripTracesBefore,
  totalChronicleEntries,
  type ChronicleAgentArgs,
  type NextFold,
} from '../engine/chronicle'
import { DEFAULT_STATE, defaultSlots } from '../engine/config'
import { OperationCoordinator, type ActiveOperation } from '../engine/operation'
import { carryPlayerEdits, oocListFromText, withRetryGuidance } from '../engine/steering'
import {
  recoveryForLog,
  removeFromBox,
  replyStatus,
  restoreInputFor,
  restoreIntoBox,
  turnRecoveryReducer,
} from '../engine/turnRecovery'
import {
  LS_TURNS,
  loadStoredChronicle,
  loadStoredMemory,
  loadStoredOoc,
  loadStoredOocBaseline,
  loadStoredPlot,
  loadStoredPlotBaseline,
  loadStoredRecovery,
  loadStoredSlots,
  loadStoredState,
  loadStoredTurnsAndCutoff,
  persistChronicle,
  persistMemory,
  persistOoc,
  persistOocBaseline,
  persistPlot,
  persistPlotBaseline,
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

// The turn in hand as it streams: the reply so far, and the Plotter's
// thinking so far, which only the trace shows.
export interface StreamedTurn {
  narration?: string
  plotterThinking?: string
}

// One of the next requests, as it will be posted, for the Context view.
export interface NextRequest {
  role: 'plotter' | 'narrator' | 'reviser' | 'summarizer'
  wire: WireRequest
  // Not sent while its stage is switched off.
  off: boolean
  // The summariser's: which turns its next fold reads, and when it runs.
  fold?: Omit<NextFold, 'input'>
}

// The status line while the Plotter works. Generic, so it gives nothing of
// the story away.
const PLOTTER_STATUS: Record<PlotterStage, string> = {
  planning: 'DM is planning…',
  records: 'DM is updating the records…',
  recall: 'DM is recalling…',
  steer: 'DM is steering…',
}

// The game controller: owns all adventure state (slots, world state, plot,
// memory, chronicle, turns, recovery state) and the turn engine that mutates it.
// App.tsx is a pure view over what this returns.
export function useGameController(settings: GameSettings) {
  const { model, apiKey, baseUrl, sampling, context } = settings

  const [slots, setSlots] = useState<AdventureSlots>(() => loadStoredSlots())
  const [state, setState] = useState<WorldState>(() => loadStoredState())
  const [plot, setPlot] = useState<string[]>(() => loadStoredPlot())
  const [memory, setMemory] = useState<Memory>(() => loadStoredMemory())
  const [ooc, setOoc] = useState<string[]>(() => loadStoredOoc())
  // The OOC list and the arcs as the engine last set them (turn result,
  // restore, load). Edits made since then are the player's own and survive
  // Retry, Undo and Redo. Stored, so a reload still knows which entries are
  // the player's.
  const [storedOocBaseline] = useState(() => loadStoredOocBaseline() ?? ooc)
  const oocBaseline = useRef<string[]>(storedOocBaseline)
  const [storedPlotBaseline] = useState(() => loadStoredPlotBaseline() ?? plot)
  const plotBaseline = useRef<string[]>(storedPlotBaseline)
  const [{ turns: initialTurns, cutoff: legacyCutoff }] = useState(() => loadStoredTurnsAndCutoff())
  const [turns, setTurns] = useState<Turn[]>(initialTurns)
  // An index over the complete log: the turns after its last entry are live.
  const [chronicle, setChronicle] = useState<Chronicle>(() => loadStoredChronicle(initialTurns, legacyCutoff))
  const compactCutoff = useMemo(() => chronicleCutoff(chronicle, turns), [chronicle, turns])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  // What the running operation is doing, and since when, so the player can
  // see which phase is taking the time.
  const [status, setStatus] = useState({ text: 'DM is thinking…', since: Date.now() })
  // What the DM has written and thought so far on the turn in hand: shown as
  // it streams and never saved, since the turn takes its reply once written.
  const [streamed, setStreamed] = useState<StreamedTurn>({})
  const streamedRef = useRef<StreamedTurn>({})
  const streamedFlush = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [compactionError, setCompactionError] = useState<string | null>(null)
  // Compaction runs in the background after a turn, so no turn waits on the
  // summariser. The chronicle it started from is known by its version, which
  // moves whenever the chronicle's contents change; its result goes in only
  // between operations, and only if the version hasn't moved and the turns it
  // points at are still in the log. Otherwise it is dropped, and the next
  // turn starts a fresh one.
  const chronicleNow = useRef<Chronicle>(chronicle)
  const chronicleVersion = useRef(0)
  const latestTurns = useRef<Turn[]>(turns)
  const backgroundCompaction = useRef<AbortController | null>(null)
  const queuedCompaction = useRef<{ version: number; from: Chronicle; chronicle: Chronicle } | null>(null)
  const [compacting, setCompacting] = useState(false)
  // Whether the summariser is on as the settings now stand, for a turn that
  // finishes after they changed.
  const summarizerOn = useRef(context.useSummarizer)
  const [recovery, dispatchRecovery] = useReducer(turnRecoveryReducer, initialTurns, (log) =>
    recoveryForLog(loadStoredRecovery(log), log),
  )
  // Only moves that still fit the log are offered or carried out.
  const live = recoveryForLog(recovery, turns)
  const lastTurn = turns.length > 0 ? turns[turns.length - 1] : undefined
  // The latest turn has no reply in front of the player: the call failed, or
  // the app reloaded before it finished. Act waits until the player continues
  // or undoes it.
  const unanswered = !thinking && !!lastTurn && replyStatus(lastTurn) !== 'answered'
  const [operations] = useState(() => new OperationCoordinator())

  const compactionSettings = {
    compactionThreshold: context.compactionThreshold,
    compactionFloor: context.compactionFloor,
    summaryTargetChars: context.summaryTargetChars,
  }
  const compactable = canCompact(turns, chronicle)

  useEffect(() => {
    latestTurns.current = turns
    try {
      localStorage.setItem(LS_TURNS, JSON.stringify(turns))
    } catch {
      // ignore quota / disabled storage
    }
  }, [turns])

  useEffect(() => {
    persistRecovery(recovery)
  }, [recovery])

  // Switching the summariser off stops a fold that is running and drops one
  // waiting to go in.
  useEffect(() => {
    summarizerOn.current = context.useSummarizer
    if (context.useSummarizer) return
    backgroundCompaction.current?.abort()
    queuedCompaction.current = null
  }, [context.useSummarizer])

  useEffect(
    () => () => {
      operations.supersede()
      backgroundCompaction.current?.abort()
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

  // A stream arrives a few words at a time; the screen catches up at most
  // every 50 ms.
  function showStreamed(patch: StreamedTurn) {
    streamedRef.current = { ...streamedRef.current, ...patch }
    if (streamedFlush.current) return
    streamedFlush.current = setTimeout(() => {
      streamedFlush.current = null
      setStreamed(streamedRef.current)
    }, 50)
  }

  function clearStreamed() {
    if (streamedFlush.current) clearTimeout(streamedFlush.current)
    streamedFlush.current = null
    streamedRef.current = {}
    setStreamed({})
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
    if (!operations.busy) applyQueuedCompaction()
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

  function setPlotBaseline(next: string[]) {
    plotBaseline.current = next
    persistPlotBaseline(next)
  }

  function commitEnginePlot(next: string[]) {
    setPlotBaseline(next)
    commitPlot(next)
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
    if (!sameChronicle(chronicleNow.current, next)) chronicleVersion.current += 1
    chronicleNow.current = next
    setChronicle(next)
    persistChronicle(next)
  }

  // Starts compacting in the background when the chronicle is due, unless the
  // summariser is off or a compaction is already running or waiting to go in.
  // The latest turn stays live, so Undo and Retry never take back a turn the
  // result points at.
  function startBackgroundCompaction(log: Turn[]) {
    if (!summarizerOn.current || backgroundCompaction.current || queuedCompaction.current) return
    const from = chronicleNow.current
    const settings = compactionSettings
    const folding = log.slice(0, -1)
    if (!chronicleNeedsCompaction(folding, from, settings)) return
    const controller = new AbortController()
    const version = chronicleVersion.current
    backgroundCompaction.current = controller
    setCompacting(true)
    compactChronicle(folding, from, settings, summariserArgs(log[0]?.id), controller.signal)
      .then((compacted) => {
        if (controller.signal.aborted) return
        setCompactionError(null)
        queuedCompaction.current = { version, from, chronicle: compacted }
        if (!operations.busy) applyQueuedCompaction()
      })
      .catch((err) => {
        // A failed compaction loses nothing: the turns stay live, and the
        // next turn tries again.
        if (!controller.signal.aborted) setCompactionError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (backgroundCompaction.current !== controller) return
        backgroundCompaction.current = null
        setCompacting(false)
      })
  }

  function applyQueuedCompaction() {
    const queued = queuedCompaction.current
    queuedCompaction.current = null
    if (!queued || queued.version !== chronicleVersion.current) return
    if (!chronicleRanges(queued.chronicle, latestTurns.current)) return
    commitFold(queued.from, queued.chronicle)
  }

  // A summariser's result goes in, replacing `from`: the folded turns' traces
  // are dropped, and Undo and Redo keep the new chronicle rather than put the
  // old one back.
  function commitFold(from: Chronicle, next: Chronicle) {
    const log = latestTurns.current
    commitChronicle(next)
    setTurns((ts) => stripTracesBefore(ts, chronicleCutoff(next, ts)))
    dispatchRecovery({
      type: 'rebase',
      from,
      chronicle: next,
      beforeFits: !!chronicleRanges(next, log.slice(0, -1)),
    })
  }

  // Something else is about to change the chronicle: a compaction in the
  // background would only be dropped, so stop paying for it.
  function cancelBackgroundCompaction() {
    backgroundCompaction.current?.abort()
    backgroundCompaction.current = null
    queuedCompaction.current = null
    setCompacting(false)
  }

  // The player's own edit to the chronicle, or clearing it. Undo and Redo keep
  // it, as they keep the player's edits to the OOC list and the arcs.
  function editChronicle(next: Chronicle) {
    if (sameChronicle(chronicleNow.current, next)) return
    cancelBackgroundCompaction()
    dispatchRecovery({
      type: 'rebase',
      from: chronicleNow.current,
      chronicle: next,
      beforeFits: !!chronicleRanges(next, latestTurns.current.slice(0, -1)),
    })
    commitChronicle(next)
  }


  function worldSnapshot(): WorldSnapshot {
    return { state, plot, memory, ooc, chronicle }
  }

  // Returns the restored OOC list and arcs: the snapshot's, plus the
  // player's own edits since the engine last set them. A cancelled turn
  // passes the snapshot's own lists, so it is put back exactly.
  function restoreWorld(
    saved: WorldSnapshot,
    current: { ooc: string[]; plot: string[] } = { ooc, plot },
  ): { ooc: string[]; plot: string[] } {
    const nextOoc = carryPlayerEdits(saved.ooc, oocBaseline.current, current.ooc)
    const nextPlot = carryPlayerEdits(saved.plot, plotBaseline.current, current.plot)
    commitState(saved.state)
    commitPlot(nextPlot)
    setPlotBaseline([...saved.plot])
    commitMemory(structuredClone(saved.memory))
    commitOoc(nextOoc)
    setOocBaseline([...saved.ooc])
    commitChronicle(saved.chronicle)
    return { ooc: nextOoc, plot: nextPlot }
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

  // The summariser's model and connection.
  function summariserArgs(cacheKey: string | undefined): ChronicleAgentArgs {
    return {
      model: context.summarizerModel.trim() || model,
      reasoningEffort: context.summarizerReasoning,
      apiKey,
      baseUrl,
      protocol: context.apiProtocol,
      cacheKey,
      scenario: slots.scenario,
    }
  }

  // The context a turn is played in, from the settings and the world it
  // starts from. runTurn plays it, and nextRequests previews the next one.
  function narratorContext(turn: {
    cacheKey: string
    slots: AdventureSlots
    chronicle: Chronicle
    // The whole log, ending with the turn being played.
    log: Turn[]
    data: StoryData
  }): NarratorContext {
    // The chronicle covers the turns up to its cutoff; the rest are in view.
    const cutoff = chronicleCutoff(turn.chronicle, turn.log)
    return {
      model,
      reasoningEffort: context.narratorReasoning,
      plotterModel: context.plotterModel,
      plotterReasoning: context.plotterReasoning,
      apiKey,
      baseUrl,
      protocol: context.apiProtocol,
      cacheKey: turn.cacheKey,
      slots: turn.slots,
      chronicle: turn.chronicle,
      folded: turn.log.slice(0, cutoff),
      history: turn.log.slice(cutoff),
      initialData: turn.data,
      sampling,
      stateCleanupThreshold: context.stateCleanupChars,
      includePriorPlayerTurns: context.includePriorPlayerTurns,
      reminderAsSystem: context.reminderAsSystem,
      usePlotter: context.usePlotter,
      flags: {
        includeWorldState: context.includeWorldState,
        includePlotOutline: context.includePlotOutline,
        includeMemory: context.includeMemory,
        includeOoc: context.includeOoc,
      },
      nsfw: context.nsfw,
    }
  }
  // The reviser replaces the draft, so a draft shown as it streams would
  // change under the player at the end: with it on, the reply doesn't stream.
  const narratorStreams = !context.useReviser

  // The next requests, exactly as they will be posted: the Plotter's first
  // and the narrator's (before the Plotter's briefing), the reviser's for the
  // last reply's draft, and the summariser's first at the next fold. A stage
  // that is switched off still shows its request, marked off. The input box's
  // text stands in for the player's input, or a placeholder while it's empty.
  function nextRequests(): NextRequest[] {
    const pendingTurn = makePendingTurn('player', input.trim() || '(the player’s next input)')
    const cacheKey = turns[0]?.id ?? pendingTurn.id
    const ctx = narratorContext({
      cacheKey,
      slots,
      chronicle,
      log: [...turns, pendingTurn],
      data: { state, plot, memory, ooc },
    })
    // runTurn always listens to the Plotter's stage and thinking.
    const turnRequests: NextRequest[] = nextTurnRequests(ctx, { plotter: true, narrator: narratorStreams }).map(
      ({ role, request, connection, sent }) => ({ role, wire: wireRequest(request, connection), off: !sent }),
    )
    const lastReply = [...turns].reverse().find((t) => t.reply.text || t.narrator?.text)
    const reviser = reviserRequest({
      model: context.reviserModel,
      apiKey,
      baseUrl,
      protocol: context.apiProtocol,
      cacheKey,
      slots,
      draft: lastReply?.narrator?.text ?? lastReply?.reply.text ?? '(the narrator’s next draft)',
      sampling,
    })
    const { input: foldInput, ...fold } = nextFold(turns, chronicle, compactionSettings, summariserArgs(turns[0]?.id))
    const summariser = summarizerRequest(foldInput)
    return [
      ...turnRequests,
      { role: 'reviser', wire: wireRequest(reviser.request, reviser.connection), off: !context.useReviser },
      {
        role: 'summarizer',
        wire: wireRequest(summariser.request, summariser.connection),
        off: !context.useSummarizer,
        fold,
      },
    ]
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
    // The adventure's first turn names its prompt caches: each role's requests
    // go to their own provider cache, under a key derived from this one.
    const cacheKey = baseTurns[0]?.id ?? pendingTurn.id
    const before = { turnId: pendingTurn.id, world, slots: turnSlots }
    setTurns([...baseTurns, pendingTurn])
    dispatchRecovery({ type: 'start', before })
    // A cancelled turn puts back the world it started from, exactly, and the
    // player's action goes back in the box.
    const restoreCancelled = () => {
      restoreWorld(before.world, before.world)
      setTurns((ts) => ts.filter((t) => t.id !== pendingTurn.id))
      setInput((box) => restoreIntoBox(box, restoreInputFor(pendingTurn)))
      dispatchRecovery({ type: 'abort', turnId: pendingTurn.id })
    }
    // The Plotter plans the turn first, then the narrator writes it; with the
    // Plotter or every record switched off there is nothing to plan.
    const plans =
      context.usePlotter &&
      (context.includeWorldState ||
        context.includePlotOutline ||
        context.includeMemory ||
        context.includeOoc)
    const firstStatus = plans ? 'DM is planning…' : 'DM is writing…'
    const operation = beginOperation(args.replaceExisting, firstStatus)
    if (!operation) {
      restoreCancelled()
      return
    }
    clearStreamed()
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
        storyUpdate: p.storyUpdate,
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
      const allTurns = [...baseTurns, pendingTurn]
      const result = await runNarrator(
        narratorContext({
          cacheKey,
          slots: turnSlots,
          chronicle: baseChronicle,
          log: allTurns,
          data: baseData,
        }),
        controller.signal,
        {
          onPlotted: (p) => {
            if (!operationCanCommit(operation)) return
            recordPlotting(p)
            showStreamed({ plotterThinking: undefined })
            setStatusText('DM is writing…')
          },
          onPlotterStage: (stage) => {
            if (operationCanCommit(operation)) setStatusText(PLOTTER_STATUS[stage])
          },
          onPlotterThinking: (text) => {
            if (operationCanCommit(operation)) showStreamed({ plotterThinking: text })
          },
          ...(narratorStreams
            ? {
                onNarration: (text: string) => {
                  if (operationCanCommit(operation)) showStreamed({ narration: text })
                },
              }
            : {}),
        },
      )
      if (!operationCanCommit(operation)) return stopIfCancelled()
      const reply = await replyFor(result)
      if (!operationCanCommit(operation)) return stopIfCancelled()
      // With the Plotter off, the story update is saved here, so the next
      // turn's request still extends this one's.
      updateTurn({ ...reply, storyUpdate: result.storyUpdate })
      commitState(result.data.state)
      commitEnginePlot(result.data.plot)
      commitMemory(result.data.memory)
      commitEngineOoc(result.data.ooc)
      startBackgroundCompaction([...baseTurns, { ...pendingTurn, ...reply }])
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
      // A superseded turn leaves its replacement's streamed text alone.
      if (isCurrentOperation(operation)) clearStreamed()
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
      pendingTurn: makePendingTurn('continue', continueDirective()),
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
    // Keep what the turn left so Redo can put it back. The OOC list and the
    // arcs are recorded as the engine left them; the player's own edits are
    // carried separately, so they survive both directions.
    const after = { ...worldSnapshot(), ooc: oocBaseline.current, plot: plotBaseline.current }
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
    const restored = restoreWorld(before.world)
    commitSlots(before.slots)
    const input = withRetryGuidance(last.input ?? '', options.guidance ?? '')
    await runTurn({
      pendingTurn: makePendingTurn(last.kind, input),
      baseTurns: turns.slice(0, -1),
      world: { ...before.world, ...restored },
      slots: before.slots,
    })
  }

  // Compact the chronicle now, whether or not a fold is due: fold every live
  // turn but the latest `keep`, or with none to fold, write the summary again
  // from itself.
  async function compactNow(keep: number) {
    if (operations.busy) return
    const settings = compactionSettings
    const kept = Math.max(1, keep)
    const cutoff = chronicleCutoff(chronicle, turns)
    const live = turns.length - cutoff
    if (live <= kept && !cutoff) {
      alert(`Nothing to compact: keeping the latest ${kept} live leaves no turn to fold, and there is no summary yet.`)
      return
    }
    const what =
      live > kept
        ? `Compact now? Every live turn but the latest ${kept} is folded into the summary. The full text stays in your log, but the model sees only the summary from then on. This runs summariser calls now`
        : 'Rewrite the summary now? No turns are left to fold, so the summary is written again from itself, replacing its text, including any edits you made. This runs one summariser call now'
    if (!confirm(`${what}.`)) return
    cancelBackgroundCompaction()
    const operation = beginOperation(false, 'Compacting chronicle…')
    if (!operation) return
    const { controller } = operation
    try {
      const compacted = await compactChronicle(
        turns,
        chronicle,
        settings,
        summariserArgs(turns[0]?.id),
        controller.signal,
        {
          keep,
          onProgress: (label) => {
            if (operationCanCommit(operation)) setStatusText(label)
          },
        },
      )
      if (!operationCanCommit(operation)) return
      setCompactionError(null)
      commitFold(chronicle, compacted)
    } catch (err) {
      if (!controller.signal.aborted && isCurrentOperation(operation)) {
        alert(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      finishOperation(operation)
    }
  }

  // Write the summary afresh from the turns it covers.
  async function rebuildChronicleNow() {
    if (operations.busy) return
    if (!totalChronicleEntries(chronicle)) return
    const settings = compactionSettings
    const calls = rebuildCallCount(turns, chronicle, settings)
    if (
      !confirm(
        `Rebuild the chronicle? The summary is written afresh from the turns it covers, replacing its current text, including any edits you made. This runs up to ${calls} summariser model call${calls === 1 ? '' : 's'} now.`,
      )
    ) {
      return
    }
    cancelBackgroundCompaction()
    const operation = beginOperation(false, 'Rebuilding chronicle…')
    if (!operation) return
    const { controller } = operation
    try {
      const rebuilt = await rebuildChronicle(
        turns,
        chronicle,
        settings,
        summariserArgs(turns[0]?.id),
        controller.signal,
        (writing, total) => {
          if (operationCanCommit(operation)) setStatusText(`Rebuilding chronicle… ${writing} of ${total}`)
        },
      )
      if (!operationCanCommit(operation)) return
      commitFold(chronicle, rebuilt)
    } catch (err) {
      if (!controller.signal.aborted && isCurrentOperation(operation)) {
        alert(`Rebuild failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      finishOperation(operation)
    }
  }

  async function newAdventure(slotsOverride: AdventureSlots) {
    const nextSlots: AdventureSlots = { ...slots, ...slotsOverride }
    nextSlots.scenario = nextSlots.scenario.trim()
    if (!nextSlots.scenario) return
    cancelBackgroundCompaction()
    commitSlots(nextSlots)
    setInput('')
    const freshState = structuredClone(DEFAULT_STATE)
    // The adventure starts with the standing instructions from the settings.
    const startOoc = context.includeOoc ? oocListFromText(context.defaultOoc) : []
    commitState(freshState)
    commitEnginePlot([])
    commitMemory({})
    commitEngineOoc(startOoc)
    commitChronicle([])
    setCompactionError(null)
    await runTurn({
      pendingTurn: makePendingTurn('bootstrap', buildNewAdventureBootstrap()),
      baseTurns: [],
      world: { state: freshState, plot: [], memory: {}, ooc: [...startOoc], chronicle: [] },
      slots: nextSlots,
      replaceExisting: true,
    })
  }

  // Deep-copy the current adventure for a save slot. Live turns without a
  // reply are left out; folded turns all stay, since the chronicle points at
  // them. The prompt edits go along when there are any; the key is always
  // there, so overwriting a save never keeps its old edits.
  function captureGame(): GameData {
    const savedTurns = turns.filter((turn, i) => i < compactCutoff || !!turn.reply.text)
    const edits = promptOverrides()
    return {
      promptOverrides: Object.keys(edits).length ? edits : undefined,
      slots: { ...slots },
      state: structuredClone(state),
      plot: [...plot],
      memory: structuredClone(memory),
      ooc: [...ooc],
      chronicle: structuredClone(chronicle),
      turns: structuredClone(savedTurns),
    }
  }

  // Replace the current adventure with a saved one, cancelling any in-flight
  // turn. A save carrying prompt edits puts them in place; one without leaves
  // the player's own edits as they are.
  function restoreGame(save: SavedGame) {
    if (save.promptOverrides && Object.keys(save.promptOverrides).length) applyPromptOverrides(save.promptOverrides)
    supersedeCurrentOperation()
    cancelBackgroundCompaction()
    dispatchRecovery({ type: 'reset' })
    setCompactionError(null)
    commitSlots({ ...defaultSlots(), ...save.slots })
    commitState(structuredClone(save.state))
    commitEnginePlot([...(save.plot ?? [])])
    commitMemory(structuredClone(save.memory ?? {}))
    commitEngineOoc([...(save.ooc ?? [])])
    commitChronicle(save.chronicle ?? [])
    setTurns(save.turns)
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
    streamed,
    canCompact: compactable,
    compactionError,
    // Whether older turns are being folded into the chronicle in the background.
    compacting,
    dismissCompactionError: () => setCompactionError(null),
    // actions
    send,
    continueStory,
    retry,
    undo,
    redo,
    compactNow,
    rebuildChronicleNow,
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
    editChronicle,
    // saves
    captureGame,
    restoreGame,
    // the Context view
    nextRequests,
  }
}

export type GameController = ReturnType<typeof useGameController>
