import { Fragment, useEffect, useRef, useState } from 'react'
import './App.css'
import { DEFAULT_SYSTEM_PROMPT, buildNewAdventureBootstrap } from './prompts'
import { runNarrator } from './engine/agents/narrator'
import { runPlanner } from './engine/agents/planner'
import {
  chronicleNeedsCompaction,
  compactCascade,
  stripTracesBefore,
  totalChronicleEntries,
} from './engine/chronicle'
import {
  DEFAULT_MODEL,
  DEFAULT_STATE,
  defaultSlots,
} from './engine/config'
import {
  LS_CONTEXT,
  LS_MODEL,
  LS_SAMPLING,
  LS_SYSTEM,
  LS_TURNS,
  LS_XAI_KEY,
  LS_COMPACT_CUTOFF,
  loadStored,
  loadStoredChronicle,
  loadStoredContext,
  loadStoredPlot,
  loadStoredSampling,
  loadStoredSaves,
  loadStoredSlots,
  loadStoredState,
  loadStoredTurnsAndCutoff,
  isSavedGameLike,
  makeSaveId,
  normalizeSavedGame,
  persistChronicle,
  persistPlot,
  persistSaves,
  persistSlots,
  persistState,
} from './engine/persistence'
import { applyTurnReminder, buildApiMessages } from './engine/request'
import { PLOT_UPDATE_TOOL, UPDATE_STATE_TOOL } from './engine/tools'
import {
  CONTINUE_DIRECTIVE,
  type AdventureSlots,
  type Chronicle,
  type ContextConfig,
  type ModelCall,
  type SamplingParams,
  type SaveFile,
  type SaveFileV1,
  type SaveFileV2,
  type SavedGame,
  type SavedGameV1,
  type SavedGameV2,
  type Turn,
  type TurnKind,
  type TurnSnapshot,
  type WorldState,
  SAVE_FILE_MARKER,
} from './engine/types'
import { ContextViewer } from './ui/ContextViewer'
import { NewAdventurePrompt } from './ui/NewAdventurePrompt'
import { SavesPanel } from './ui/SavesPanel'
import { SettingsPanel } from './ui/SettingsPanel'
import { StateViewer } from './ui/StateViewer'
import { TraceView } from './ui/TraceView'

function App() {
  const [systemPrompt, setSystemPrompt] = useState(() =>
    loadStored(LS_SYSTEM, DEFAULT_SYSTEM_PROMPT),
  )
  const [model, setModel] = useState(() => loadStored(LS_MODEL, DEFAULT_MODEL))
  const [xaiKey, setXaiKey] = useState(() => loadStored(LS_XAI_KEY, ''))
  const [slots, setSlots] = useState<AdventureSlots>(() => loadStoredSlots())
  const [state, setState] = useState<WorldState>(() => loadStoredState())
  const [plot, setPlot] = useState<string[]>(() => loadStoredPlot())
  const [chronicle, setChronicle] = useState<Chronicle>(() => loadStoredChronicle())
  const [{ turns: initialTurns, cutoff: initialCutoff }] = useState(() => loadStoredTurnsAndCutoff())
  const [turns, setTurns] = useState<Turn[]>(initialTurns)
  const [compactCutoff, setCompactCutoff] = useState<number>(initialCutoff)
  const [sampling, setSampling] = useState<SamplingParams>(() => loadStoredSampling())
  const [context, setContext] = useState<ContextConfig>(() => loadStoredContext())
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [statusText, setStatusText] = useState('DM is thinking…')
  const [showSettings, setShowSettings] = useState(false)
  const [showState, setShowState] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [showNewAdventure, setShowNewAdventure] = useState(false)
  const [showSaves, setShowSaves] = useState(false)
  const [saves, setSaves] = useState<SavedGame[]>(() => loadStoredSaves())
  const [snapshot, setSnapshot] = useState<TurnSnapshot | null>(null)
  const [expandedTraces, setExpandedTraces] = useState<Set<string>>(() => new Set())

  function toggleTrace(id: string) {
    setExpandedTraces((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const logRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const canCompact = chronicleNeedsCompaction(turns, compactCutoff, chronicle, {
    compactionThreshold: context.compactionThreshold,
    compactionBatch: context.compactionBatch,
  })

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, thinking])

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

  function commitSaves(next: SavedGame[]) {
    setSaves(next)
    persistSaves(next)
  }

  function saveCurrentGame(name: string) {
    const entry: SavedGame = {
      id: makeSaveId(),
      name: name.trim() || 'Untitled save',
      savedAt: Date.now(),
      slots: { ...slots },
      state: structuredClone(state),
      plot: [...plot],
      chronicle: structuredClone(chronicle),
      turns: structuredClone(turns),
      compactCutoff,
    }
    commitSaves([entry, ...saves])
  }

  function loadSavedGame(id: string) {
    const target = saves.find((s) => s.id === id)
    if (!target) return
    if (
      (turns.length > 0 || totalChronicleEntries(chronicle) > 0) &&
      !confirm('Load this save? Your current adventure will be replaced.')
    ) {
      return
    }
    abortRef.current?.abort()
    setThinking(false)
    setSnapshot(null)
    commitSlots({ ...defaultSlots(), ...target.slots })
    commitState(structuredClone(target.state))
    commitPlot([...(target.plot ?? [])])
    commitChronicle(target.chronicle ?? [])
    setTurns(target.turns)
    commitCompactCutoff(target.compactCutoff)
    setShowSaves(false)
  }

  function deleteSavedGame(id: string) {
    const target = saves.find((s) => s.id === id)
    if (!target) return
    if (!confirm(`Delete "${target.name}"? This cannot be undone.`)) return
    commitSaves(saves.filter((s) => s.id !== id))
  }

  function exportSavedGame(id: string) {
    const target = saves.find((s) => s.id === id)
    if (!target) return
    const payload: SaveFile = { marker: SAVE_FILE_MARKER, version: 3, save: target }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const slug = target.name.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40) || 'save'
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}.dm-save.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function importSavedGame(file: File) {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      let raw: SavedGame | SavedGameV1 | SavedGameV2 | null = null
      if (
        parsed &&
        typeof parsed === 'object' &&
        (parsed as { marker?: unknown }).marker === SAVE_FILE_MARKER &&
        isSavedGameLike((parsed as { save?: unknown }).save)
      ) {
        raw = (parsed as SaveFile | SaveFileV1 | SaveFileV2).save
      } else if (isSavedGameLike(parsed)) {
        raw = parsed
      }
      if (!raw) {
        alert('That file is not a valid Dungeon Master save.')
        return
      }
      const normalized = normalizeSavedGame(raw)
      const entry: SavedGame = { ...normalized, id: makeSaveId(), savedAt: Date.now() }
      commitSaves([entry, ...saves])
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function runTurn(
    pendingTurn: Turn,
    baseTurns: Turn[],
    baseState: WorldState,
    basePlot: string[],
    baseChronicle: Chronicle,
    baseCutoff: number,
    onAbortRestore: () => void,
  ) {
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
          { systemPrompt, model, apiKey: xaiKey, slots },
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

      let plannerCall: ModelCall | undefined
      let workingState = baseState
      let workingPlot = basePlot
      if (context.usePlanner) {
        setStatusText('Planner thinking…')
        const plannerResult = await runPlanner(
          {
            model,
            apiKey: xaiKey,
            slots,
            chronicle: workingChronicle,
            history: allTurns.slice(workingCutoff),
            state: workingState,
            plot: workingPlot,
            sampling,
            stateCleanupThreshold: context.stateCleanupChars,
            includeWorldState: context.includeWorldState,
            includePlotOutline: context.includePlotOutline,
            nsfw: context.nsfw,
          },
          controller.signal,
        )
        plannerCall = plannerResult.call
        workingState = plannerResult.state
        workingPlot = plannerResult.plot
        // Reflect planner's tool-driven state/plot updates immediately so the
        // user can see them in the State viewer mid-turn, and so the narrator
        // sees the post-planner world below.
        commitState(workingState)
        commitPlot(workingPlot)
        setTurns((ts) =>
          ts.map((t) =>
            t.id === pendingTurn.id ? { ...t, planner: plannerCall } : t,
          ),
        )
        setStatusText('DM is thinking…')
      }

      const result = await runNarrator(
        {
          systemPrompt,
          model,
          apiKey: xaiKey,
          slots,
          chronicle: workingChronicle,
          history: allTurns.slice(workingCutoff),
          initialState: workingState,
          initialPlot: workingPlot,
          sampling,
          stateCleanupThreshold: context.stateCleanupChars,
          includePriorPlayerTurns: context.includePriorPlayerTurns,
          appendReminderToUser: context.appendReminderToUser,
          includeWorldState: context.includeWorldState,
          includePlotOutline: context.includePlotOutline,
          nsfw: context.nsfw,
          disableMutationTools: context.usePlanner,
          plannerInstruction: plannerCall?.text,
        },
        controller.signal,
      )
      setTurns((ts) =>
        ts.map((t) =>
          t.id === pendingTurn.id
            ? {
                ...t,
                planner: plannerCall ?? t.planner,
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
      commitState(result.state)
      commitPlot(result.plot)
    } catch (err) {
      if (controller.signal.aborted) {
        if (abortRef.current === controller) onAbortRestore()
        return
      }
      const failureText = `(The dungeon master falters: ${err instanceof Error ? err.message : String(err)})`
      setTurns((ts) =>
        ts.map((t) =>
          t.id === pendingTurn.id
            ? { ...t, reply: { ...t.reply, text: failureText } }
            : t,
        ),
      )
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setThinking(false)
    }
  }

  function makePendingTurn(kind: TurnKind, turnInput: string): Turn {
    const reply: ModelCall = { id: crypto.randomUUID(), model, text: '' }
    return { id: crypto.randomUUID(), kind, input: turnInput, reply }
  }

  async function send() {
    const text = input.trim()
    if (!text || thinking) return
    setInput('')
    const snap: TurnSnapshot = {
      turns,
      state,
      plot,
      chronicle,
      compactCutoff,
      input: text,
      kind: 'player',
    }
    setSnapshot(snap)
    const pendingTurn = makePendingTurn('player', text)
    setTurns([...turns, pendingTurn])
    await runTurn(pendingTurn, turns, state, plot, chronicle, compactCutoff, () => {
      setTurns((ts) => ts.filter((t) => t.id !== pendingTurn.id))
      setInput((cur) => cur || text)
    })
  }

  async function continueStory() {
    if (thinking || turns.length === 0) return
    const snap: TurnSnapshot = {
      turns,
      state,
      plot,
      chronicle,
      compactCutoff,
      input: '',
      kind: 'continue',
    }
    setSnapshot(snap)
    const pendingTurn = makePendingTurn('continue', CONTINUE_DIRECTIVE)
    setTurns([...turns, pendingTurn])
    await runTurn(pendingTurn, turns, state, plot, chronicle, compactCutoff, () => {
      setTurns((ts) => ts.filter((t) => t.id !== pendingTurn.id))
    })
  }

  function undo() {
    if (thinking || !snapshot) return
    setTurns(snapshot.turns)
    commitState(snapshot.state)
    commitPlot([...snapshot.plot])
    commitChronicle(snapshot.chronicle)
    commitCompactCutoff(snapshot.compactCutoff)
    setInput(snapshot.input)
    setSnapshot(null)
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
        { systemPrompt, model, apiKey: xaiKey, slots },
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

  async function retry() {
    if (thinking || !snapshot) return
    const snap = snapshot
    commitState(snap.state)
    commitPlot([...snap.plot])
    commitChronicle(snap.chronicle)
    commitCompactCutoff(snap.compactCutoff)
    const isContinue = snap.kind === 'continue'
    const turnInput = isContinue ? CONTINUE_DIRECTIVE : snap.input
    const pendingTurn = makePendingTurn(snap.kind, turnInput)
    setTurns([...snap.turns, pendingTurn])
    const onAbort = isContinue
      ? () => {
          setTurns((ts) => ts.filter((t) => t.id !== pendingTurn.id))
        }
      : () => {
          setTurns((ts) => ts.filter((t) => t.id !== pendingTurn.id))
          setInput((cur) => cur || snap.input)
        }
    await runTurn(pendingTurn, snap.turns, snap.state, snap.plot, snap.chronicle, snap.compactCutoff, onAbort)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  function saveSettings(
    nextSystem: string,
    nextModel: string,
    nextXaiKey: string,
    nextSlots: AdventureSlots,
    nextSampling: SamplingParams,
    nextContext: ContextConfig,
  ) {
    setSystemPrompt(nextSystem)
    setModel(nextModel)
    setXaiKey(nextXaiKey)
    commitSlots(nextSlots)
    setSampling(nextSampling)
    setContext(nextContext)
    try {
      localStorage.setItem(LS_SYSTEM, nextSystem)
      if (nextXaiKey) localStorage.setItem(LS_XAI_KEY, nextXaiKey)
      else localStorage.removeItem(LS_XAI_KEY)
      if (nextModel) localStorage.setItem(LS_MODEL, nextModel)
      else localStorage.removeItem(LS_MODEL)
      localStorage.setItem(LS_SAMPLING, JSON.stringify(nextSampling))
      localStorage.setItem(LS_CONTEXT, JSON.stringify(nextContext))
    } catch {
      // ignore quota / disabled storage
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
    commitChronicle([])
    commitCompactCutoff(0)
    setThinking(true)
    setStatusText('DM is thinking…')
    const controller = new AbortController()
    abortRef.current = controller
    const pendingTurn = makePendingTurn('bootstrap', buildNewAdventureBootstrap(nextSlots.scenario))
    setTurns([pendingTurn])
    try {
      const result = await runNarrator(
        {
          systemPrompt,
          model,
          apiKey: xaiKey,
          slots: nextSlots,
          chronicle: [],
          history: [pendingTurn],
          initialState: freshState,
          initialPlot: [],
          sampling,
          stateCleanupThreshold: context.stateCleanupChars,
          includePriorPlayerTurns: context.includePriorPlayerTurns,
          appendReminderToUser: context.appendReminderToUser,
          includeWorldState: context.includeWorldState,
          includePlotOutline: context.includePlotOutline,
          nsfw: context.nsfw,
        },
        controller.signal,
      )
      setTurns([
        {
          ...pendingTurn,
          reply: {
            ...pendingTurn.reply,
            text: result.text,
            trace: result.trace,
            reasoningTokens: result.reasoningTokens,
          },
        },
      ])
      commitState(result.state)
      commitPlot(result.plot)
    } catch (err) {
      if (controller.signal.aborted) {
        setTurns([])
        return
      }
      const failureText = `(The dungeon master falters: ${err instanceof Error ? err.message : String(err)})`
      setTurns([
        { ...pendingTurn, reply: { ...pendingTurn.reply, text: failureText } },
      ])
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setThinking(false)
    }
  }

  return (
    <main className="app">
      <header>
        <h1>AI Dungeon Master</h1>
        <div className="header-actions">
          <button
            className="ghost"
            onClick={() => setShowNewAdventure(true)}
            disabled={thinking}
            title="Start a new adventure — confirm or edit the scenario brief"
          >
            New Adventure
          </button>
          <button
            className="ghost"
            onClick={() => void compactNow()}
            disabled={thinking || !canCompact}
            title="Fold older turns into the chronicle now"
          >
            Compact
          </button>
          <button className="ghost" onClick={() => setShowSaves(true)}>
            Saves
          </button>
          <button className="ghost" onClick={() => setShowContext(true)}>
            Context
          </button>
          <button className="ghost" onClick={() => setShowState(true)}>
            State
          </button>
          <button className="ghost" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </header>
      <div className="log" ref={logRef}>
        {turns.length === 0 && !thinking && (
          <div className="empty-log">
            <p>No adventure in progress.</p>
            <button onClick={() => setShowNewAdventure(true)}>Begin Adventure</button>
            <p className="hint">The DM will narrate the opening based on your scenario brief (edit in Settings).</p>
          </div>
        )}
        {turns.map((t, i) => {
          const folded = i < compactCutoff
          const showInput = t.kind === 'player' && t.input !== undefined
          const showReply = !!t.reply.text
          return (
            <Fragment key={t.id}>
              {i === compactCutoff && compactCutoff > 0 && (
                <div className="compact-divider">
                  <span>earlier turns folded into chronicle — still shown, but model sees summary</span>
                </div>
              )}
              {showInput && (
                <div className={`msg msg-player ${folded ? 'msg-folded' : ''}`}>
                  <span className="who">You</span>
                  <p>{t.input}</p>
                </div>
              )}
              {showReply && (
                <div className={`msg msg-dm ${folded ? 'msg-folded' : ''}`}>
                  <span className="who">DM</span>
                  <p>{t.reply.text}</p>
                  {(t.reply.trace !== undefined || t.planner) && (
                    <TraceView
                      calls={[
                        ...(t.planner ? [{ label: 'planner', call: t.planner }] : []),
                        { label: 'narrator', call: t.reply, hideText: true },
                      ]}
                      expanded={expandedTraces.has(t.id)}
                      onToggle={() => toggleTrace(t.id)}
                    />
                  )}
                </div>
              )}
            </Fragment>
          )
        })}
        {thinking && <div className="msg msg-dm thinking">{statusText}</div>}
      </div>
      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe your action…"
          rows={1}
        />
        <div className="composer-buttons">
          <button
            className="primary"
            onClick={() => void send()}
            disabled={thinking || !input.trim()}
          >
            Act
          </button>
          <button
            className="ghost"
            onClick={undo}
            disabled={thinking || !snapshot}
            title="Roll back the last turn — restore state and put your input back in the box"
          >
            Undo
          </button>
          <button
            className="ghost"
            onClick={() => void retry()}
            disabled={thinking || !snapshot}
            title="Discard the DM's last reply and re-roll with the same action"
          >
            Retry
          </button>
          <button
            className="ghost"
            onClick={() => void continueStory()}
            disabled={thinking || turns.length === 0}
            title="Have the DM keep narrating — time passes, NPCs act — until the player faces a concrete decision"
          >
            Continue
          </button>
        </div>
      </div>
      {showSettings && (
        <SettingsPanel
          systemPrompt={systemPrompt}
          model={model}
          xaiKey={xaiKey}
          slots={slots}
          sampling={sampling}
          context={context}
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
        />
      )}
      {showState && (
        <StateViewer
          state={state}
          plot={plot}
          chronicle={chronicle}
          context={context}
          onClose={() => setShowState(false)}
          onResetState={() => commitState(structuredClone(DEFAULT_STATE))}
          onSaveState={commitState}
          onSavePlot={commitPlot}
          onClearPlot={() => commitPlot([])}
          onClearChronicle={() => {
            commitChronicle([])
            commitCompactCutoff(0)
          }}
        />
      )}
      {showContext && (
        <ContextViewer
          apiMessages={applyTurnReminder(
            buildApiMessages(
              systemPrompt,
              slots,
              chronicle,
              turns.slice(compactCutoff),
              state,
              plot,
              context.stateCleanupChars,
              context.includePriorPlayerTurns,
              context.includeWorldState,
              context.includePlotOutline,
              context.nsfw,
            ),
            context.appendReminderToUser,
          )}
          tools={
            context.usePlanner
              ? []
              : [
                  ...(context.includeWorldState ? [UPDATE_STATE_TOOL] : []),
                  ...(context.includePlotOutline ? [PLOT_UPDATE_TOOL] : []),
                ]
          }
          sampling={sampling}
          onClose={() => setShowContext(false)}
        />
      )}
      {showNewAdventure && (
        <NewAdventurePrompt
          slots={slots}
          inProgress={turns.length > 0}
          onCancel={() => setShowNewAdventure(false)}
          onBegin={(nextSlots) => {
            setShowNewAdventure(false)
            void newAdventure(nextSlots)
          }}
        />
      )}
      {showSaves && (
        <SavesPanel
          saves={saves}
          canSave={turns.length > 0}
          turnCount={turns.length}
          onClose={() => setShowSaves(false)}
          onSave={saveCurrentGame}
          onLoad={loadSavedGame}
          onDelete={deleteSavedGame}
          onExport={exportSavedGame}
          onImport={importSavedGame}
        />
      )}
    </main>
  )
}

export default App
