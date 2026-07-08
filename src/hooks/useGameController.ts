import { useEffect, useRef, useState } from 'react'
import { buildNewAdventureBootstrap } from '../prompts'
import { EmptyNarrativeError, runNarrator } from '../engine/agents/narrator'
import { runReviser } from '../engine/agents/reviser'
import {
  chronicleNeedsCompaction,
  compactCascade,
  stripTracesBefore,
} from '../engine/chronicle'
import { DEFAULT_STATE, defaultSlots } from '../engine/config'
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
  type SamplingParams,
  type SavedGame,
  type TraceEvent,
  type Turn,
  type TurnKind,
  type TurnSnapshot,
  type WorldState,
} from '../engine/types'

// Everything the turn engine needs from app settings. Owned by useSettings;
// passed in each render so the controller always sees the current values.
export interface GameSettings {
  systemPrompt: string
  model: string
  xaiKey: string
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
// memory, chronicle, turns, snapshot) and the turn engine that mutates it.
// App.tsx is a pure view over what this returns.
export function useGameController(settings: GameSettings) {
  const { systemPrompt, model, xaiKey, baseUrl, sampling, context } = settings

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
  const [snapshot, setSnapshot] = useState<TurnSnapshot | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const canCompact = chronicleNeedsCompaction(turns, compactCutoff, chronicle, {
    compactionThreshold: context.compactionThreshold,
    compactionBatch: context.compactionBatch,
  })

  useEffect(() => {
    try {
      localStorage.setItem(LS_TURNS, JSON.stringify(turns))
    } catch {
      // ignore quota / disabled storage
    }
  }, [turns])

  useEffect(() => () => abortRef.current?.abort(), [])

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
    baseTurns: Turn[]
    baseState: WorldState
    basePlot: string[]
    baseMemory: Memory
    baseChronicle: Chronicle
    baseCutoff: number
    // Slots to narrate with — defaults to current slots; newAdventure passes
    // the freshly-committed ones since React state hasn't re-rendered yet.
    slotsForTurn?: AdventureSlots
    onAbortRestore: () => void
  }) {
    const { pendingTurn, baseTurns, baseState, basePlot, baseMemory, baseChronicle, baseCutoff } =
      args
    const turnSlots = args.slotsForTurn ?? slots
    setThinking(true)
    setStatusText('DM is thinking…')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const settings = {
        compactionThreshold: context.compactionThreshold,
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
          { model, apiKey: xaiKey, baseUrl, slots: turnSlots },
          controller.signal,
          (label) => setStatusText(label),
        )
        workingChronicle = compacted.chronicle
        workingCutoff = compacted.cutoff
        commitChronicle(workingChronicle)
        commitCompactCutoff(workingCutoff)
        setTurns((ts) => stripTracesBefore(ts, workingCutoff))
        setStatusText('DM is thinking…')
      }

      const result = await runNarrator(
        {
          systemPrompt,
          model,
          apiKey: xaiKey,
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
          includeToolCallHistory: context.includeToolCallHistory,
          nsfw: context.nsfw,
        },
        controller.signal,
      )
      commitState(result.state)
      commitPlot(result.plot)
      commitMemory(result.memory)

      const narratorCall: ModelCall = {
        id: crypto.randomUUID(),
        model,
        text: result.text,
        trace: result.trace,
        reasoningTokens: result.reasoningTokens,
      }
      if (context.useReviser) {
        setTurns((ts) =>
          ts.map((t) =>
            t.id === pendingTurn.id
              ? {
                  ...t,
                  narrator: narratorCall,
                }
              : t,
          ),
        )
        setStatusText('Reviser polishing…')
        try {
          const reviserCall = await runReviser(
            {
              model: context.reviserModel,
              apiKey: xaiKey,
              baseUrl,
              slots: turnSlots,
              draft: result.text,
              sampling,
            },
            controller.signal,
          )
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
    } catch (err) {
      if (controller.signal.aborted) {
        if (abortRef.current === controller) args.onAbortRestore()
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
      if (abortRef.current === controller) abortRef.current = null
      setThinking(false)
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || thinking) return
    setInput('')
    const snap: TurnSnapshot = {
      turns,
      state,
      plot,
      memory,
      chronicle,
      compactCutoff,
      input: text,
      kind: 'player',
    }
    setSnapshot(snap)
    const pendingTurn = makePendingTurn('player', text)
    setTurns([...turns, pendingTurn])
    await runTurn({
      pendingTurn,
      baseTurns: turns,
      baseState: state,
      basePlot: plot,
      baseMemory: memory,
      baseChronicle: chronicle,
      baseCutoff: compactCutoff,
      onAbortRestore: () => {
        setTurns((ts) => ts.filter((t) => t.id !== pendingTurn.id))
        setInput((cur) => cur || text)
      },
    })
  }

  async function continueStory() {
    if (thinking || turns.length === 0) return
    const snap: TurnSnapshot = {
      turns,
      state,
      plot,
      memory,
      chronicle,
      compactCutoff,
      input: '',
      kind: 'continue',
    }
    setSnapshot(snap)
    const pendingTurn = makePendingTurn('continue', CONTINUE_DIRECTIVE)
    setTurns([...turns, pendingTurn])
    await runTurn({
      pendingTurn,
      baseTurns: turns,
      baseState: state,
      basePlot: plot,
      baseMemory: memory,
      baseChronicle: chronicle,
      baseCutoff: compactCutoff,
      onAbortRestore: () => {
        setTurns((ts) => ts.filter((t) => t.id !== pendingTurn.id))
      },
    })
  }

  function undo() {
    if (thinking || !snapshot) return
    setTurns(snapshot.turns)
    commitState(snapshot.state)
    commitPlot([...snapshot.plot])
    commitMemory(structuredClone(snapshot.memory))
    commitChronicle(snapshot.chronicle)
    commitCompactCutoff(snapshot.compactCutoff)
    setInput(snapshot.input)
    setSnapshot(null)
  }

  async function retry() {
    if (thinking || !snapshot) return
    const snap = snapshot
    commitState(snap.state)
    commitPlot([...snap.plot])
    commitMemory(structuredClone(snap.memory))
    commitChronicle(snap.chronicle)
    commitCompactCutoff(snap.compactCutoff)
    const isContinue = snap.kind === 'continue'
    const turnInput = isContinue ? CONTINUE_DIRECTIVE : snap.input
    const pendingTurn = makePendingTurn(snap.kind, turnInput)
    setTurns([...snap.turns, pendingTurn])
    const onAbortRestore = isContinue
      ? () => {
          setTurns((ts) => ts.filter((t) => t.id !== pendingTurn.id))
        }
      : () => {
          setTurns((ts) => ts.filter((t) => t.id !== pendingTurn.id))
          setInput((cur) => cur || snap.input)
        }
    await runTurn({
      pendingTurn,
      baseTurns: snap.turns,
      baseState: snap.state,
      basePlot: snap.plot,
      baseMemory: snap.memory,
      baseChronicle: snap.chronicle,
      baseCutoff: snap.compactCutoff,
      onAbortRestore,
    })
  }

  async function compactNow() {
    if (thinking) return
    const settings = {
      compactionThreshold: context.compactionThreshold,
      compactionBatch: context.compactionBatch,
    }
    if (!chronicleNeedsCompaction(turns, compactCutoff, chronicle, settings)) {
      alert('Nothing to compact: chronicle is up to date.')
      return
    }
    setThinking(true)
    setStatusText('Compacting chronicle…')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const compacted = await compactCascade(
        turns,
        compactCutoff,
        chronicle,
        settings,
        { model, apiKey: xaiKey, baseUrl, slots },
        controller.signal,
        (label) => setStatusText(label),
      )
      commitChronicle(compacted.chronicle)
      commitCompactCutoff(compacted.cutoff)
      setTurns((ts) => stripTracesBefore(ts, compacted.cutoff))
    } catch (err) {
      if (!controller.signal.aborted) {
        alert(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setThinking(false)
    }
  }

  async function newAdventure(slotsOverride: AdventureSlots) {
    const nextSlots: AdventureSlots = { ...slots, ...slotsOverride }
    nextSlots.scenario = nextSlots.scenario.trim()
    if (!nextSlots.scenario) return
    commitSlots(nextSlots)
    abortRef.current?.abort()
    setInput('')
    setSnapshot(null)
    const freshState = structuredClone(DEFAULT_STATE)
    commitState(freshState)
    commitPlot([])
    commitMemory({})
    commitChronicle([])
    commitCompactCutoff(0)
    const pendingTurn = makePendingTurn('bootstrap', buildNewAdventureBootstrap(nextSlots.scenario))
    setTurns([pendingTurn])
    await runTurn({
      pendingTurn,
      baseTurns: [],
      baseState: freshState,
      basePlot: [],
      baseMemory: {},
      baseChronicle: [],
      baseCutoff: 0,
      slotsForTurn: nextSlots,
      onAbortRestore: () => setTurns([]),
    })
  }

  // Deep-copy the current adventure for a save slot.
  function captureGame(): GameData {
    return {
      slots: { ...slots },
      state: structuredClone(state),
      plot: [...plot],
      memory: structuredClone(memory),
      chronicle: structuredClone(chronicle),
      turns: structuredClone(turns),
      compactCutoff,
    }
  }

  // Replace the current adventure with a saved one, cancelling any in-flight turn.
  function restoreGame(save: SavedGame) {
    abortRef.current?.abort()
    setThinking(false)
    setSnapshot(null)
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
    snapshot,
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
