import { Fragment, useEffect, useRef, useState } from 'react'
import './App.css'

type Role = 'dm' | 'player'

interface Message {
  id: string
  role: Role
  text: string
}

interface TurnSnapshot {
  messages: Message[]
  state: WorldState
  summary: string
  compactCutoff: number
  input: string
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }
type WorldState = { [key: string]: JsonValue }

const MAX_STATE_STRING_CHARS = 200

const DEFAULT_SYSTEM_PROMPT = `You are the Dungeon Master — narrator of an immersive,
atmospheric adventure. Write vividly in second person, present tense. 1-5 paragraphs
per reply, never break character.

# Rhythm
Vary paragraph length. Single-sentence beats — a sound, a line of dialogue, a blow
landing — alongside denser 3-4 sentence paragraphs when texture calls for it. Uniform
blocks read as mechanical. Let pacing mirror the scene: short and stabbing when
something jolts, longer when the world unfolds.

# End on a challenge
Every reply MUST end on an unresolved beat that demands the player's next action: a
live situation in motion, an NPC's in-fiction question, a pressing threat, or a
concrete decision. Do not list options for the player.

The final sentence or short paragraph IS the challenge. No coda, atmosphere beat, or
scene-setting flourish after it — mood goes before, never after. Stop on the beat the
player must respond to.

The narrator never addresses the player directly: no "What do you do?" or "What's your
next move?". An NPC asking a question in dialogue is fine.

# Keep moving
React to the player's action, then advance — something happens, someone reacts, a
pressure appears, a door opens or closes. If a beat is quiet, introduce a new element.

Do NOT repeat scenes, beats, NPC entrances, revelations, or lines that have already
played. Check the chronicle, history, and state first. Avoid recycled phrasings and
reused metaphors. Revisit a prior beat only when the plot clearly justifies it (a
callback, a return for story reason, an NPC tracking the player) — and then add
something new.

# Player autonomy
Do NOT narrate the player's choices, speech, or thoughts. They control their
character; you control the world and everyone else. Exception: mechanical
follow-through on a decision they have already stated — "I climb" lets you narrate
handholds or a slip. Substantive choices — fight or flee, what to say, which path,
whether to trust — belong to the player. When in doubt, stop before the choice and
let the situation demand it.

NPCs must never enumerate the player's choices. No "do X or Y?", no "will you help
or run?", no "fight or flee?" — those are the narrator's option list dressed as
dialogue. NPC questions come from the NPC's own perspective and are either
open-ended ("Who sent you?", "What did you see?") or pressing but singular ("Can I
trust you?"). The player picks what to do; the NPC doesn't offer a multiple-choice
menu.

# Continuity
Remember locations, characters, items, injuries, and ongoing threats. When an outcome
depends on chance or skill, resolve it yourself and state the result.

# OOC directives
Player text wrapped in ( ) or [ ] is an out-of-character directive about the story —
not in-world speech. Heed it: introduce a character, shift tone, retcon, skip ahead,
clarify. Acknowledge briefly, weave the change into the next beat, never narrate the
player saying or writing those words in-world.`

const STATE_RULES = `# World state — your bookkeeping responsibility

The JSON below is the live world state: scene, the player's body and possessions, NPCs
present, their goals and attitudes, and the ongoing topics or threads that still shape
the plot. Before producing your narrative reply, call \`update_state\` as many times as
needed (or once with batched fields) to reflect everything that changed this turn —
new NPCs who appear, shifts in relationships or goals, the player's
position/clothing/inventory/injuries, location changes, new threads opening or
resolving. Only after the state matches present reality should you narrate.

## Shape: descriptive strings, maps not arrays
Use keys named for the thing and values that are short descriptive strings capturing
the CURRENT status. Maps let you update or delete a single entry cleanly via
\`update_state\`; arrays force you to rewrite the whole list. Do NOT create boolean
flag keys (\`metJack: true\`, \`foundClue: true\`) — they accumulate and never get
cleaned up. Do NOT use arrays of strings where a map would work: \`clothes: ["dress",
"heels"]\` becomes \`clothes: { "dress": "...", "shoes": "..." }\`. When a thread's
status changes, overwrite its descriptive string; when it resolves, delete the key.

Individual string values are capped at ${MAX_STATE_STRING_CHARS} characters. Longer
strings will fail and DELETE the existing key at that path — keep entries terse, split
long descriptions into multiple short keys.

## Keep it live, not historical
The chronicle summary and conversation history already preserve the past; the state is
for what is LIVE RIGHT NOW and still shaping the plot. As the scenario advances:
  - Drop NPCs who have left the scene and have no ongoing influence.
  - Remove completed or abandoned goals.
  - Close out topics once their thread resolves — delete the key, don't mark "done".
  - Replace the player's previous location when they move — do not stack old locations.
  - Prune items that were used up, given away, lost, or left behind.
  - Consolidate or rename keys if the structure grows messy.
Use \`update_state\` with \`value=null\` (or the \`delete=[...]\` array for bulk
cleanup) to remove keys that no longer belong. Treat the state as a working dashboard,
not an archive.`

const DEFAULT_SCENARIO = `A lone adventurer arrives at the threshold of the Mouldering Vaults — an ancient, half-flooded crypt rumoured to hide the relics of a forgotten order. The air is cold, the stones are damp, and something older than death stirs within. The tone is gritty and atmospheric.`

const DEFAULT_STATE: WorldState = {
  scene: { location: '', time: '', mood: '' },
  player: {
    position: 'standing',
    hair: '',
    clothes: {},
    inventory: {},
    status: {},
  },
  npcs: {},
  goals: {},
  topics: {},
}

function buildSummarizerPrompt(targetChars: number): string {
  return `You are an archivist whose sole responsibility is to summarize the early part
of an ongoing roleplaying-game storyline, so the Dungeon Master can keep narrating
without re-reading every prior turn.

You will be given (1) the rules the DM operates under, (2) the scenario brief, (3) any
existing summary of even earlier events, and (4) a chronicle of in-character exchanges
between the DM and the player.

Produce a SINGLE UNIFIED RECAP that merges the existing summary (if any) with the new
chronicle. The existing summary has already been compressed once; you may compress it
further to stay within the target length, but do not drop any material fact — its
characters, items, injuries, promises, and unresolved threads must survive into the new
recap. Together, your output replaces both the old summary and the supplied chronicle.

Preserve everything a future turn might need to stay consistent:
  - Every plot point, decision, action, and consequence, in the order they happened.
  - Every character introduced: their role, motivations, goals, current attitude toward
    the player, and current whereabouts / status.
  - Every location visited, item acquired or lost, injury sustained, promise made,
    secret revealed, clue discovered, unresolved thread, and story flag set.
  - The player character's current condition (position, clothes, inventory, injuries,
    mood) at the end of the summarized period.

Strip anything that does not change the story going forward: repeated atmosphere,
redundant descriptions, flavor-only imagery, unsuccessful attempts that left no trace,
and filler dialogue.

Write in plain past-tense prose, third person, as a chronicler — not in character.
Target total length: roughly ${targetChars.toLocaleString()} characters for the entire
unified recap (not per section). Err on keeping important events. Do not pad, do not
invent, do not foreshadow, do not summarize events that have not happened. Output the
summary text only, with no preamble, headers, or meta commentary.`
}

interface ContextConfig {
  triggerChars: number
  prefixChars: number
  summaryTargetChars: number
  stateCleanupChars: number
}

const DEFAULT_CONTEXT: ContextConfig = {
  triggerChars: 25_000,
  prefixChars: 15_000,
  summaryTargetChars: 5_000,
  stateCleanupChars: 10_000,
}

interface SamplingParams {
  temperature: number
  frequencyPenalty: number
  presencePenalty: number
}

const DEFAULT_SAMPLING: SamplingParams = {
  temperature: 0.75,
  frequencyPenalty: 0,
  presencePenalty: 0,
}

const LS_SYSTEM = 'dm.systemPrompt'
const LS_SCENARIO = 'dm.scenario'
const LS_STATE = 'dm.state'
const LS_SUMMARY = 'dm.summary'
const LS_MESSAGES = 'dm.messages'
const LS_SAMPLING = 'dm.sampling'
const LS_CONTEXT = 'dm.context'
const LS_COMPACT_CUTOFF = 'dm.compactCutoff'

function loadStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function loadStoredState(): WorldState {
  try {
    const raw = localStorage.getItem(LS_STATE)
    if (!raw) return structuredClone(DEFAULT_STATE)
    const parsed = JSON.parse(raw) as WorldState
    return parsed
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

function persistState(state: WorldState) {
  try {
    localStorage.setItem(LS_STATE, JSON.stringify(state))
  } catch {
    // ignore quota / disabled storage
  }
}

function loadStoredMessages(): Message[] {
  try {
    const raw = localStorage.getItem(LS_MESSAGES)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Message[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadStoredSampling(): SamplingParams {
  try {
    const raw = localStorage.getItem(LS_SAMPLING)
    if (!raw) return { ...DEFAULT_SAMPLING }
    const parsed = JSON.parse(raw) as Partial<SamplingParams>
    return { ...DEFAULT_SAMPLING, ...parsed }
  } catch {
    return { ...DEFAULT_SAMPLING }
  }
}

function loadStoredCompactCutoff(): number {
  try {
    const raw = localStorage.getItem(LS_COMPACT_CUTOFF)
    if (!raw) return 0
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

function loadStoredContext(): ContextConfig {
  try {
    const raw = localStorage.getItem(LS_CONTEXT)
    if (!raw) return { ...DEFAULT_CONTEXT }
    const parsed = JSON.parse(raw) as Partial<ContextConfig>
    return { ...DEFAULT_CONTEXT, ...parsed }
  } catch {
    return { ...DEFAULT_CONTEXT }
  }
}

function findOverLongString(value: JsonValue, limit: number): number | null {
  if (typeof value === 'string') {
    return value.length > limit ? value.length : null
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findOverLongString(v, limit)
      if (found !== null) return found
    }
    return null
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) {
      const found = findOverLongString(v, limit)
      if (found !== null) return found
    }
  }
  return null
}

function setByPath(state: WorldState, path: string, value: JsonValue): WorldState {
  const keys = path.split('.').filter(Boolean)
  if (keys.length === 0) return state
  const next: WorldState = structuredClone(state)
  let obj: { [key: string]: JsonValue } = next
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    const existing = obj[k]
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
      obj[k] = {}
    }
    obj = obj[k] as { [key: string]: JsonValue }
  }
  const last = keys[keys.length - 1]
  if (value === null) delete obj[last]
  else obj[last] = value
  return next
}

function App() {
  const [systemPrompt, setSystemPrompt] = useState(() =>
    loadStored(LS_SYSTEM, DEFAULT_SYSTEM_PROMPT),
  )
  const [scenario, setScenario] = useState(() => loadStored(LS_SCENARIO, DEFAULT_SCENARIO))
  const [state, setState] = useState<WorldState>(() => loadStoredState())
  const [summary, setSummary] = useState<string>(() => loadStored(LS_SUMMARY, ''))
  const [messages, setMessages] = useState<Message[]>(() => loadStoredMessages())
  const [compactCutoff, setCompactCutoff] = useState<number>(() => loadStoredCompactCutoff())
  const [sampling, setSampling] = useState<SamplingParams>(() => loadStoredSampling())
  const [context, setContext] = useState<ContextConfig>(() => loadStoredContext())
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [statusText, setStatusText] = useState('DM is thinking…')
  const [showSettings, setShowSettings] = useState(false)
  const [showState, setShowState] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [showNewAdventure, setShowNewAdventure] = useState(false)
  const [snapshot, setSnapshot] = useState<TurnSnapshot | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  useEffect(() => {
    try {
      localStorage.setItem(LS_MESSAGES, JSON.stringify(messages))
    } catch {
      // ignore quota / disabled storage
    }
  }, [messages])

  useEffect(() => () => abortRef.current?.abort(), [])

  function commitState(next: WorldState) {
    setState(next)
    persistState(next)
  }

  function commitSummary(next: string) {
    setSummary(next)
    try {
      if (next) localStorage.setItem(LS_SUMMARY, next)
      else localStorage.removeItem(LS_SUMMARY)
    } catch {
      // ignore
    }
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

  async function runTurn(
    pendingMessages: Message[],
    baseState: WorldState,
    baseSummary: string,
    baseCutoff: number,
    onAbortRestore: () => void,
  ) {
    setThinking(true)
    setStatusText('DM is thinking…')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      let workingSummary = baseSummary
      let workingCutoff = baseCutoff
      if (
        totalChars(
          systemPrompt,
          scenario,
          workingSummary,
          baseState,
          pendingMessages.slice(workingCutoff),
        ) > context.triggerChars
      ) {
        setStatusText('Compacting chronicle…')
        const compacted = await compactHistory(
          systemPrompt,
          scenario,
          workingSummary,
          pendingMessages,
          workingCutoff,
          context.prefixChars,
          context.summaryTargetChars,
          controller.signal,
        )
        workingSummary = compacted.summary
        workingCutoff = compacted.cutoff
        commitSummary(workingSummary)
        commitCompactCutoff(workingCutoff)
        setStatusText('DM is thinking…')
      }

      const { text: reply, state: nextState } = await askDungeonMaster(
        systemPrompt,
        scenario,
        workingSummary,
        pendingMessages.slice(workingCutoff),
        baseState,
        sampling,
        context.stateCleanupChars,
        controller.signal,
      )
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'dm', text: reply }])
      commitState(nextState)
    } catch (err) {
      if (controller.signal.aborted) {
        if (abortRef.current === controller) onAbortRestore()
        return
      }
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: 'dm',
          text: `(The dungeon master falters: ${err instanceof Error ? err.message : String(err)})`,
        },
      ])
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
      messages,
      state,
      summary,
      compactCutoff,
      input: text,
    }
    setSnapshot(snap)
    const playerMsg: Message = { id: crypto.randomUUID(), role: 'player', text }
    const pendingMessages = [...messages, playerMsg]
    setMessages(pendingMessages)
    await runTurn(pendingMessages, state, summary, compactCutoff, () => {
      setMessages((m) => (m[m.length - 1]?.id === playerMsg.id ? m.slice(0, -1) : m))
      setInput((cur) => cur || text)
    })
  }

  function undo() {
    if (thinking || !snapshot) return
    setMessages(snapshot.messages)
    commitState(snapshot.state)
    commitSummary(snapshot.summary)
    commitCompactCutoff(snapshot.compactCutoff)
    setInput(snapshot.input)
    setSnapshot(null)
  }

  async function retry() {
    if (thinking || !snapshot) return
    const snap = snapshot
    commitState(snap.state)
    commitSummary(snap.summary)
    commitCompactCutoff(snap.compactCutoff)
    const playerMsg: Message = { id: crypto.randomUUID(), role: 'player', text: snap.input }
    const pendingMessages = [...snap.messages, playerMsg]
    setMessages(pendingMessages)
    await runTurn(pendingMessages, snap.state, snap.summary, snap.compactCutoff, () => {
      setMessages((m) => (m[m.length - 1]?.id === playerMsg.id ? m.slice(0, -1) : m))
      setInput((cur) => cur || snap.input)
    })
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  function saveSettings(
    nextSystem: string,
    nextScenario: string,
    nextSampling: SamplingParams,
    nextContext: ContextConfig,
  ) {
    setSystemPrompt(nextSystem)
    setScenario(nextScenario)
    setSampling(nextSampling)
    setContext(nextContext)
    try {
      localStorage.setItem(LS_SYSTEM, nextSystem)
      localStorage.setItem(LS_SCENARIO, nextScenario)
      localStorage.setItem(LS_SAMPLING, JSON.stringify(nextSampling))
      localStorage.setItem(LS_CONTEXT, JSON.stringify(nextContext))
    } catch {
      // ignore quota / disabled storage
    }
  }

  async function newAdventure(scenarioOverride: string) {
    const briefRaw = scenarioOverride.trim()
    if (!briefRaw) return
    if (briefRaw !== scenario) {
      setScenario(briefRaw)
      try {
        localStorage.setItem(LS_SCENARIO, briefRaw)
      } catch {
        // ignore quota / disabled storage
      }
    }
    abortRef.current?.abort()
    setInput('')
    setMessages([])
    setSnapshot(null)
    const freshState = structuredClone(DEFAULT_STATE)
    commitState(freshState)
    commitSummary('')
    commitCompactCutoff(0)
    setThinking(true)
    setStatusText('DM is thinking…')
    const controller = new AbortController()
    abortRef.current = controller
    const bootstrap: Message[] = [
      {
        id: 'bootstrap',
        role: 'player',
        text: `(OOC: Begin a new adventure. Scenario brief — ${briefRaw}\n\nPopulate the initial world state with scene/location/mood, the player's starting condition, any NPCs present at the start, and their goals. Then narrate the opening scene in 2-4 short paragraphs, in character as the DM. Do not reference this OOC message; just begin.)`,
      },
    ]
    try {
      const { text: reply, state: nextState } = await askDungeonMaster(
        systemPrompt,
        briefRaw,
        '',
        bootstrap,
        freshState,
        sampling,
        context.stateCleanupChars,
        controller.signal,
      )
      setMessages([{ id: crypto.randomUUID(), role: 'dm', text: reply }])
      commitState(nextState)
    } catch (err) {
      if (controller.signal.aborted) return
      setMessages([
        {
          id: crypto.randomUUID(),
          role: 'dm',
          text: `(The dungeon master falters: ${err instanceof Error ? err.message : String(err)})`,
        },
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
        {messages.length === 0 && !thinking && (
          <div className="empty-log">
            <p>No adventure in progress.</p>
            <button onClick={() => setShowNewAdventure(true)}>Begin Adventure</button>
            <p className="hint">The DM will narrate the opening based on your scenario brief (edit in Settings).</p>
          </div>
        )}
        {messages.map((m, i) => (
          <Fragment key={m.id}>
            {i === compactCutoff && compactCutoff > 0 && (
              <div className="compact-divider">
                <span>earlier turns folded into chronicle — still shown, but model sees summary</span>
              </div>
            )}
            <div className={`msg msg-${m.role} ${i < compactCutoff ? 'msg-folded' : ''}`}>
              <span className="who">{m.role === 'dm' ? 'DM' : 'You'}</span>
              <p>{m.text}</p>
            </div>
          </Fragment>
        ))}
        {thinking && <div className="msg msg-dm thinking">{statusText}</div>}
      </div>
      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe your action…"
          rows={2}
        />
        <div className="composer-buttons">
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
          <button onClick={() => void send()} disabled={thinking || !input.trim()}>
            Act
          </button>
        </div>
      </div>
      {showSettings && (
        <SettingsPanel
          systemPrompt={systemPrompt}
          scenario={scenario}
          sampling={sampling}
          context={context}
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
        />
      )}
      {showState && (
        <StateViewer
          state={state}
          summary={summary}
          context={context}
          onClose={() => setShowState(false)}
          onResetState={() => commitState(structuredClone(DEFAULT_STATE))}
          onClearSummary={() => {
            commitSummary('')
            commitCompactCutoff(0)
          }}
        />
      )}
      {showContext && (
        <ContextViewer
          apiMessages={buildApiMessages(
            systemPrompt,
            scenario,
            summary,
            messages.slice(compactCutoff),
            state,
            context.stateCleanupChars,
          )}
          tools={[UPDATE_STATE_TOOL]}
          sampling={sampling}
          onClose={() => setShowContext(false)}
        />
      )}
      {showNewAdventure && (
        <NewAdventurePrompt
          scenario={scenario}
          inProgress={messages.length > 0}
          onCancel={() => setShowNewAdventure(false)}
          onBegin={(brief) => {
            setShowNewAdventure(false)
            void newAdventure(brief)
          }}
        />
      )}
    </main>
  )
}

interface SettingsPanelProps {
  systemPrompt: string
  scenario: string
  sampling: SamplingParams
  context: ContextConfig
  onClose: () => void
  onSave: (
    systemPrompt: string,
    scenario: string,
    sampling: SamplingParams,
    context: ContextConfig,
  ) => void
}

function SettingsPanel({
  systemPrompt,
  scenario,
  sampling,
  context,
  onClose,
  onSave,
}: SettingsPanelProps) {
  const [draftSystem, setDraftSystem] = useState(systemPrompt)
  const [draftScenario, setDraftScenario] = useState(scenario)
  const [draftSampling, setDraftSampling] = useState<SamplingParams>(sampling)
  const [draftContext, setDraftContext] = useState<ContextConfig>(context)

  function setSamplingField<K extends keyof SamplingParams>(key: K, value: number) {
    setDraftSampling((s) => ({ ...s, [key]: value }))
  }

  function setContextField<K extends keyof ContextConfig>(key: K, value: number) {
    setDraftContext((c) => ({ ...c, [key]: value }))
  }

  function save() {
    onSave(draftSystem.trim(), draftScenario.trim(), draftSampling, draftContext)
    onClose()
  }

  function resetDefaults() {
    setDraftSystem(DEFAULT_SYSTEM_PROMPT)
    setDraftScenario(DEFAULT_SCENARIO)
    setDraftSampling({ ...DEFAULT_SAMPLING })
    setDraftContext({ ...DEFAULT_CONTEXT })
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <label>
          <span>System prompt</span>
          <textarea
            value={draftSystem}
            onChange={(e) => setDraftSystem(e.target.value)}
            rows={10}
          />
        </label>
        <label>
          <span>Scenario brief</span>
          <textarea
            value={draftScenario}
            onChange={(e) => setDraftScenario(e.target.value)}
            rows={5}
            placeholder="Setting, tone, and premise — the DM will narrate the opening scene from this."
          />
        </label>

        <div className="sampling-grid">
          <label className="sampling-field">
            <span>Temperature</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={draftSampling.temperature}
              onChange={(e) => setSamplingField('temperature', Number(e.target.value))}
            />
            <small>Higher = more varied prose and rhythm. Default {DEFAULT_SAMPLING.temperature}. Ignored on reasoning models.</small>
          </label>
          <label className="sampling-field">
            <span>Frequency penalty</span>
            <input
              type="number"
              min={-2}
              max={2}
              step={0.05}
              value={draftSampling.frequencyPenalty}
              onChange={(e) => setSamplingField('frequencyPenalty', Number(e.target.value))}
            />
            <small>Discourages repeated phrases and sentence shapes. Default {DEFAULT_SAMPLING.frequencyPenalty}.</small>
          </label>
          <label className="sampling-field">
            <span>Presence penalty</span>
            <input
              type="number"
              min={-2}
              max={2}
              step={0.05}
              value={draftSampling.presencePenalty}
              onChange={(e) => setSamplingField('presencePenalty', Number(e.target.value))}
            />
            <small>Pushes toward new topics / fresh turns. Default {DEFAULT_SAMPLING.presencePenalty}.</small>
          </label>
        </div>

        <div className="sampling-grid">
          <label className="sampling-field">
            <span>Compact trigger (chars)</span>
            <input
              type="number"
              min={5000}
              step={1000}
              value={draftContext.triggerChars}
              onChange={(e) => setContextField('triggerChars', Number(e.target.value))}
            />
            <small>
              Compaction fires when summary + history exceeds this. Default{' '}
              {DEFAULT_CONTEXT.triggerChars.toLocaleString()}.
            </small>
          </label>
          <label className="sampling-field">
            <span>Prefix to compress (chars)</span>
            <input
              type="number"
              min={1000}
              step={1000}
              value={draftContext.prefixChars}
              onChange={(e) => setContextField('prefixChars', Number(e.target.value))}
            />
            <small>
              Upper bound on chars folded into the summary per compaction — never
              more than half the remaining messages by count. Default{' '}
              {DEFAULT_CONTEXT.prefixChars.toLocaleString()}.
            </small>
          </label>
          <label className="sampling-field">
            <span>Summary target (chars)</span>
            <input
              type="number"
              min={500}
              step={500}
              value={draftContext.summaryTargetChars}
              onChange={(e) => setContextField('summaryTargetChars', Number(e.target.value))}
            />
            <small>
              Target length for the unified recap. Default{' '}
              {DEFAULT_CONTEXT.summaryTargetChars.toLocaleString()}.
            </small>
          </label>
          <label className="sampling-field">
            <span>State cleanup nudge (chars)</span>
            <input
              type="number"
              min={1000}
              step={500}
              value={draftContext.stateCleanupChars}
              onChange={(e) => setContextField('stateCleanupChars', Number(e.target.value))}
            />
            <small>
              When the state JSON exceeds this, a cleanup reminder is appended to the
              state system message. Default {DEFAULT_CONTEXT.stateCleanupChars.toLocaleString()}.
            </small>
          </label>
        </div>

        <p className="hint">
          Saving persists to this browser. The system prompt and sampling take effect on
          the next turn. Click <em>New Adventure</em> in the header to restart — the DM
          will generate a fresh opening from the brief above.
        </p>
        <div className="modal-actions">
          <button className="ghost" onClick={resetDefaults}>
            Reset to defaults
          </button>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}

interface NewAdventurePromptProps {
  scenario: string
  inProgress: boolean
  onCancel: () => void
  onBegin: (scenario: string) => void
}

function NewAdventurePrompt({ scenario, inProgress, onCancel, onBegin }: NewAdventurePromptProps) {
  const [draft, setDraft] = useState(scenario)
  const trimmed = draft.trim()

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>New adventure</h2>
          <button className="modal-close" aria-label="Close" onClick={onCancel}>×</button>
        </div>
        <p className="hint">
          {inProgress
            ? 'This will end the current adventure and start a fresh one. The DM will narrate the opening from the brief below.'
            : 'The DM will narrate the opening from the brief below.'}
        </p>
        <label>
          <span>Scenario brief</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            placeholder="Setting, tone, and premise."
            autoFocus
          />
        </label>
        <div className="modal-actions">
          <span className="spacer" />
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button onClick={() => onBegin(trimmed)} disabled={!trimmed}>
            Begin Adventure
          </button>
        </div>
      </div>
    </div>
  )
}

interface StateViewerProps {
  state: WorldState
  summary: string
  context: ContextConfig
  onClose: () => void
  onResetState: () => void
  onClearSummary: () => void
}

function StateViewer({
  state,
  summary,
  context,
  onClose,
  onResetState,
  onClearSummary,
}: StateViewerProps) {
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>World State</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="hint">
          The DM maintains this JSON via an <code>update_state</code> tool after each turn.
          It's sent to the model as a system message after the conversation history.
        </p>
        <pre className="state-json">{JSON.stringify(state, null, 2)}</pre>

        <h2>Chronicle summary</h2>
        <p className="hint">
          Auto-generated when history exceeds {context.triggerChars.toLocaleString()} chars;
          the oldest ~{context.prefixChars.toLocaleString()} chars are folded into this recap
          (target ~{context.summaryTargetChars.toLocaleString()} chars).
          Current length: {summary.length.toLocaleString()} chars.
        </p>
        <pre className="state-json">{summary || '(no summary yet)'}</pre>

        <div className="modal-actions">
          <button
            className="ghost"
            onClick={() => {
              if (confirm('Reset world state to empty defaults?')) onResetState()
            }}
          >
            Reset state
          </button>
          <button
            className="ghost"
            onClick={() => {
              if (summary && confirm('Clear the chronicle summary?')) onClearSummary()
            }}
            disabled={!summary}
          >
            Clear summary
          </button>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

interface ContextViewerProps {
  apiMessages: ApiMessage[]
  tools: unknown[]
  sampling: SamplingParams
  onClose: () => void
}

function ContextViewer({ apiMessages, tools, sampling, onClose }: ContextViewerProps) {
  const totalBytes = apiMessages.reduce((n, m) => n + (m.content?.length ?? 0), 0)
  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <div className="modal-header">
          <h2>Next DM request</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="hint">
          This is the exact <code>messages</code> array (plus tool schema and sampling params)
          that will be sent to the model on your next turn. Total content:{' '}
          {totalBytes.toLocaleString()} chars across {apiMessages.length} messages.
        </p>
        <h2>Sampling</h2>
        <pre className="state-json">{JSON.stringify(
          {
            temperature: sampling.temperature,
            frequency_penalty: sampling.frequencyPenalty,
            presence_penalty: sampling.presencePenalty,
          },
          null,
          2,
        )}</pre>
        <div className="context-list">
          {apiMessages.map((m, i) => (
            <div key={i} className={`context-item ctx-${m.role}`}>
              <div className="ctx-head">
                <span className="ctx-role">{m.role}</span>
                {m.tool_call_id && <span className="ctx-tag">tool_call_id: {m.tool_call_id}</span>}
                {m.tool_calls?.length ? <span className="ctx-tag">{m.tool_calls.length} tool_call(s)</span> : null}
                <span className="ctx-len">{m.content.length.toLocaleString()} chars</span>
              </div>
              <pre className="state-json">{m.content || '(empty)'}</pre>
              {m.tool_calls?.length ? (
                <pre className="state-json">{JSON.stringify(m.tool_calls, null, 2)}</pre>
              ) : null}
            </div>
          ))}
        </div>
        <h2>Tools</h2>
        <pre className="state-json">{JSON.stringify(tools, null, 2)}</pre>
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

interface ToolCall {
  id: string
  type?: string
  function: { name: string; arguments: string }
}

interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

const UPDATE_STATE_TOOL = {
  type: 'function',
  function: {
    name: 'update_state',
    description:
      `Update the world state JSON. Provide one or both of: (a) path+value to set a value at a dotted path (intermediate objects are auto-created); (b) delete=[array of dotted paths] to remove multiple stale keys in a single call (efficient for bulk cleanup). Examples: set one key — {path:"npcs.jack.attitude", value:"possessive"}; delete several keys — {delete:["npcs.oldNpc", "topics.resolvedThread", "flags"]}; set and delete together — {path:"scene.location", value:"the docks", delete:["scene.previousLocation"]}. HARD LIMIT: any individual string value (including nested strings inside objects/arrays) must be <= ${MAX_STATE_STRING_CHARS} characters. Setting a longer string will fail AND the existing value at that path will be deleted — keep entries terse and split long descriptions into multiple short keys.`,
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional dotted path into the state JSON to set, e.g. "player.position". Must be paired with value.',
        },
        value: {
          description: `Optional JSON value to set at path. Any JSON type is allowed. null deletes that key. String values must be <= ${MAX_STATE_STRING_CHARS} chars (including nested strings). Must be paired with path.`,
        },
        delete: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of dotted paths to delete in one call. Prefer this over many single-delete calls when cleaning up multiple stale keys.',
        },
      },
    },
  },
}

function totalChars(
  systemPrompt: string,
  scenario: string,
  summary: string,
  state: WorldState,
  messages: Message[],
): number {
  return (
    systemPrompt.length +
    scenario.length +
    summary.length +
    STATE_RULES.length +
    JSON.stringify(state).length +
    messages.reduce((n, m) => n + m.text.length, 0)
  )
}

function findCompactionCutoff(
  messages: Message[],
  startIndex: number,
  targetChars: number,
): number {
  const remaining = messages.length - startIndex
  if (remaining <= 1) return startIndex
  const halfCount = Math.max(1, Math.floor(remaining / 2))
  let acc = 0
  let cut = startIndex
  for (let i = startIndex; i < startIndex + halfCount; i++) {
    acc += messages[i].text.length
    cut = i + 1
    if (acc >= targetChars) break
  }
  return cut
}

function buildStateSystemMessage(
  currentState: WorldState,
  stateCleanupThreshold: number,
): ApiMessage {
  const stateJson = JSON.stringify(currentState, null, 2)
  const cleanupStatus =
    stateJson.length > stateCleanupThreshold
      ? `STATUS: state size is ${stateJson.length.toLocaleString()} chars — OVER the ${stateCleanupThreshold.toLocaleString()} cleanup threshold. Drop or condense stale keys this turn. Use \`update_state\` with \`delete=[...]\` for bulk cleanup.`
      : `STATUS: state size is ${stateJson.length.toLocaleString()} chars — within budget (threshold ${stateCleanupThreshold.toLocaleString()}).`
  return {
    role: 'system',
    content: `${STATE_RULES}\n\n## Current state JSON\n\n\`\`\`json\n${stateJson}\n\`\`\`\n\n${cleanupStatus}`,
  }
}

function buildApiMessagesIndexed(
  systemPrompt: string,
  scenario: string,
  summary: string,
  history: Message[],
  currentState: WorldState,
  stateCleanupThreshold: number,
): { messages: ApiMessage[]; stateIndex: number } {
  const scenarioTrimmed = scenario.trim()
  const messages: ApiMessage[] = [{ role: 'system', content: systemPrompt }]
  if (scenarioTrimmed) {
    messages.push({
      role: 'system',
      content: `# Scenario brief\n\nThe premise, setting, and tone for this adventure — the foundational frame for everything you narrate.\n\n${scenarioTrimmed}`,
    })
  }
  if (summary) {
    messages.push({
      role: 'system',
      content: `# Story so far\n\nChronicle of earlier turns, condensed by the archivist. Treat as canon.\n\n${summary}`,
    })
  }
  const stateIndex = messages.length
  messages.push(buildStateSystemMessage(currentState, stateCleanupThreshold))
  for (const m of history) {
    messages.push({ role: m.role === 'dm' ? 'assistant' : 'user', content: m.text })
  }
  return { messages, stateIndex }
}

function buildApiMessages(
  systemPrompt: string,
  scenario: string,
  summary: string,
  history: Message[],
  currentState: WorldState,
  stateCleanupThreshold: number,
): ApiMessage[] {
  return buildApiMessagesIndexed(
    systemPrompt,
    scenario,
    summary,
    history,
    currentState,
    stateCleanupThreshold,
  ).messages
}

async function compactHistory(
  systemPrompt: string,
  scenario: string,
  priorSummary: string,
  messages: Message[],
  priorCutoff: number,
  prefixChars: number,
  summaryTargetChars: number,
  signal: AbortSignal,
): Promise<{ summary: string; cutoff: number }> {
  const newCutoff = findCompactionCutoff(messages, priorCutoff, prefixChars)
  if (newCutoff <= priorCutoff) return { summary: priorSummary, cutoff: priorCutoff }
  const toSummarize = messages.slice(priorCutoff, newCutoff)

  const chronicle = toSummarize
    .map((m) => `${m.role === 'dm' ? 'DM' : 'PLAYER'}: ${m.text}`)
    .join('\n\n')

  const userContent =
    `DM system prompt (rules the narrator follows):\n\n${systemPrompt}\n\n` +
    `Scenario brief:\n\n${scenario}\n\n` +
    (priorSummary
      ? `Existing summary of even earlier events (merge and further compress as needed):\n\n${priorSummary}\n\n`
      : '') +
    `Chronicle to fold in (in order):\n\n${chronicle}\n\n` +
    `Now write the unified recap.`

  const apiMessages: ApiMessage[] = [
    { role: 'system', content: buildSummarizerPrompt(summaryTargetChars) },
    { role: 'user', content: userContent },
  ]

  const res = await fetch('/api/xai/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: __XAI_MODEL__,
      messages: apiMessages,
      stream: false,
    }),
    signal,
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`summarizer ${res.status}: ${body.slice(0, 200) || res.statusText}`)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('Summarizer returned empty recap')
  return { summary: content, cutoff: newCutoff }
}

function modelSupportsSampling(model: string): boolean {
  // Reasoning models (e.g. grok-4-1-fast-reasoning) reject temperature and penalty params.
  return !/reasoning/i.test(model)
}

async function askDungeonMaster(
  systemPrompt: string,
  scenario: string,
  summary: string,
  history: Message[],
  initialState: WorldState,
  sampling: SamplingParams,
  stateCleanupThreshold: number,
  signal: AbortSignal,
): Promise<{ text: string; state: WorldState }> {
  let currentState = initialState
  const { messages: apiMessages, stateIndex } = buildApiMessagesIndexed(
    systemPrompt,
    scenario,
    summary,
    history,
    currentState,
    stateCleanupThreshold,
  )

  let nudged = false
  for (let iter = 0; iter < 8; iter++) {
    // __XAI_MODEL__ is injected by Vite `define` — see vite.config.ts.
    const body: Record<string, unknown> = {
      model: __XAI_MODEL__,
      messages: apiMessages,
      tools: [UPDATE_STATE_TOOL],
      stream: false,
    }
    if (modelSupportsSampling(__XAI_MODEL__)) {
      body.temperature = sampling.temperature
      body.frequency_penalty = sampling.frequencyPenalty
      body.presence_penalty = sampling.presencePenalty
    }
    const res = await fetch('/api/xai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`xAI ${res.status}: ${body.slice(0, 200) || res.statusText}`)
    }

    const data = (await res.json()) as {
      choices?: {
        finish_reason?: string
        message?: { content?: string; tool_calls?: ToolCall[] }
      }[]
    }
    const choice = data.choices?.[0]
    const msg = choice?.message
    const finishReason = choice?.finish_reason
    if (!msg) throw new Error('Empty response from xAI (no message)')

    if (msg.tool_calls?.length) {
      apiMessages.push({
        role: 'assistant',
        content: msg.content ?? '',
        tool_calls: msg.tool_calls,
      })
      for (const call of msg.tool_calls) {
        if (call.function?.name === 'update_state') {
          try {
            const args = JSON.parse(call.function.arguments) as {
              path?: string
              value?: JsonValue
              delete?: string[]
            }
            const hasSet = typeof args.path === 'string' && args.path.length > 0
            const deletePaths = Array.isArray(args.delete)
              ? args.delete.filter((p): p is string => typeof p === 'string' && p.length > 0)
              : []

            if (!hasSet && deletePaths.length === 0) {
              apiMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content:
                  'error: update_state requires either path+value, a non-empty delete array, or both.',
              })
            } else if (hasSet && args.value === undefined) {
              apiMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: `error: path "${args.path}" provided without a value. Pair path with value, or omit both and use delete.`,
              })
            } else {
              const notes: string[] = []
              let failed = false
              if (hasSet) {
                const overLong = findOverLongString(
                  args.value as JsonValue,
                  MAX_STATE_STRING_CHARS,
                )
                if (overLong !== null) {
                  currentState = setByPath(currentState, args.path as string, null)
                  notes.push(
                    `FAILED set ${args.path}: string value too long (${overLong} chars, max ${MAX_STATE_STRING_CHARS}). Existing key DELETED. Rewrite shorter.`,
                  )
                  failed = true
                } else {
                  currentState = setByPath(
                    currentState,
                    args.path as string,
                    args.value as JsonValue,
                  )
                  notes.push(`set ${args.path}`)
                }
              }
              for (const p of deletePaths) {
                currentState = setByPath(currentState, p, null)
                notes.push(`deleted ${p}`)
              }
              apiMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: `${failed ? 'partial' : 'ok'} — ${notes.join('; ')}`,
              })
            }
          } catch (err) {
            apiMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: `error: ${err instanceof Error ? err.message : String(err)}`,
            })
          }
        } else {
          apiMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: `error: unknown tool ${call.function?.name ?? '(anonymous)'}`,
          })
        }
      }
      apiMessages[stateIndex] = buildStateSystemMessage(currentState, stateCleanupThreshold)
      continue
    }

    const content = msg.content?.trim()
    if (content) return { text: content, state: currentState }

    console.warn('[dm] empty xAI message', { iter, finishReason, data })
    if (!nudged) {
      nudged = true
      apiMessages.push({
        role: 'user',
        content:
          '(OOC: State updates recorded. Now provide the narrative reply in character — 2-4 short paragraphs.)',
      })
      continue
    }
    throw new Error(`Empty narrative reply (finish_reason=${finishReason ?? 'unknown'})`)
  }
  throw new Error('Tool-call loop exceeded max iterations')
}

export default App
