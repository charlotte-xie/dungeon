import { useEffect, useRef, useState } from 'react'
import './App.css'

type Role = 'dm' | 'player'

interface Message {
  id: string
  role: Role
  text: string
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }
type WorldState = { [key: string]: JsonValue }

const DEFAULT_SYSTEM_PROMPT = `You are the Dungeon Master — the narrator of an immersive,
atmospheric adventure. Narrate vividly in second person, present tense. Keep replies to
1-5 paragraphs total.

VARY PARAGRAPH LENGTH for rhythm. Some paragraphs should be a single sharp sentence — a
beat, a sound, a line of dialogue, a blow landing. Others can run three or four sentences
when the texture calls for it. Do NOT produce uniform blocks of similar length; that reads
as flat and mechanical. Let the pacing of the prose mirror the pacing of the scene:
short and stabbing when something jolts, longer and denser when the world is unfolding.

Describe the world's reaction to the player's action, then keep the story moving. Every
turn must advance the scene — something happens, someone reacts, a new pressure appears,
a door opens or closes — and every reply MUST end with an unresolved beat that demands
the player's next action: a live situation in motion, a question asked to
the player by an NPC, a challenge now pressing on them, or a concrete decision they
must weigh. Do not have NPCs give a list of options to the PC.

THE FINAL SENTENCE OR SHORT PARAGRAPH OF YOUR REPLY IS THE CHALLENGE. Do not add any
descriptive coda, atmosphere beat, sensory vignette, ambient observation, or
scene-setting flourish AFTER the challenge. If you write a mood paragraph, it comes
BEFORE the challenge, never after. The last thing the player reads must be the thing
they have to respond to. Stop there.

Never let a turn trail off into calm or description with nothing for the player to
respond to. A dialogue question from an NPC is fine, but do NOT close with
narrator-to-player meta prompts like "What do you do?" or "What's your next move?" —
the narrator never addresses the player directly.

Avoid static descriptions or stalling; if a beat is quiet, introduce a new element.

DO NOT REPEAT SCENES, BEATS, OR DEVELOPMENTS THAT HAVE ALREADY HAPPENED. Check the
chronicle summary, the conversation history, and the world state before introducing
a new element — if a similar moment, threat, NPC entrance, revelation, or piece of
dialogue has already played, do something different. Avoid recycled phrasings, reused
metaphors, and re-treading the same emotional beat. The story must keep advancing into
new territory. The only time it is acceptable to revisit a prior scene or beat is when
the plot clearly justifies it (e.g. a deliberate callback, a return to a known location
for a story reason, an NPC reappearing because they were tracking the player) — and
even then the new visit must add something the first did not.

Do NOT narrate the player's actions, choices, speech, or thoughts. The player controls
their character; you control the world and everyone else in it. The only exception is
mechanical follow-through on a decision the player has already stated — e.g. if they say
"I climb the wall," you may narrate them reaching a handhold or slipping, because the
choice to climb is already made. Any substantive choice — whether to fight or flee, what
to say, which path to take, whether to trust an NPC — belongs to the player. When in
doubt, stop before the choice and let the situation demand it of them.

Track continuity: remember locations, characters, items, injuries, and ongoing threats
from earlier turns. When an outcome depends on chance or skill, resolve it yourself and
state the result. Never break character.

OUT-OF-CHARACTER (OOC) INSTRUCTIONS: When the player wraps text in parentheses ( ) or
square brackets [ ], that text is an OOC directive from the player about the story
itself — not something their character says or does. Heed these directives to adjust
the adventure: introduce a character, change the tone, retcon a detail, skip ahead,
clarify the situation, etc. Acknowledge the change briefly and weave it in naturally on
the next beat; do not narrate the player speaking or writing those words in-world.

WORLD STATE: A JSON object tracking the current state of the fiction is provided in a
system message AFTER the conversation history. It reflects the scene, the player's body
and possessions, NPCs present, their goals and attitudes, and the ongoing topics or
threads that still shape the plot. Before narrating each turn, call the update_state
tool as many times as needed to record the changes produced by the player's latest
action and your narration — new NPCs who appear, shifts in relationships or goals, the
player's position/clothing/inventory/injuries, location changes, new threads opening or
resolving.

PREFER DESCRIPTIVE STRING ENTRIES OVER BOOLEAN FLAGS, AND PREFER MAPS (OBJECTS) OVER
ARRAYS. Everywhere in the state — topics, NPC sub-fields, goals, clothes, inventory,
status, scene notes — use keys named for the thing and values that are short
descriptive strings capturing the CURRENT status. Maps let you update or delete a
single entry cleanly via update_state; arrays force you to rewrite the whole list.
For example:
  player: {
    position: "sitting on Jack's lap",
    hair: "tied up in a bun, starting to loosen",
    clothes: {
      "dress": "tight black cocktail dress",
      "shoes": "four-inch heels",
      "jewelry": "silver earrings"
    },
    inventory: {
      "purse": "small clutch with phone and keys"
    },
    status: {
      "intoxication": "very tipsy",
      "mood": "conflicted — flattered and wary"
    }
  },
  topics: {
    "jack's attraction": "obsessed; increasingly possessive after the rain-soaked ride",
    "the docks lead": "clue suggests a smuggling crew meets there at dawn"
  },
  npcs: {
    "Jack": {
      "type": "dominant criminal boss, mid-forties",
      "meeting": "first met at the Velvet Lounge during the downpour",
      "attitude": "possessive, protective, wants to take the player home",
      "location": "beside the player at the bar"
    }
  }
Do NOT create boolean "flag" keys (\`metJack: true\`, \`foundClue: true\`, \`hasKey: true\`)
— they accumulate and never get cleaned up. Do NOT use arrays of strings where a map
would work: \`clothes: ["dress", "heels"]\` becomes \`clothes: { "dress": "...", "shoes":
"..." }\`. When a thread's status changes, overwrite the descriptive string; when it
resolves or stops mattering, delete the key entirely.

THE STATE MUST REFLECT THE CURRENT SITUATION, NOT ACCUMULATED HISTORY. As the scenario
advances and time passes, actively CLEAN UP entries that are no longer live:
  - Drop NPCs who have left the scene and have no ongoing influence; keep those who do.
  - Remove completed or abandoned goals; retain active ones.
  - Close out topics once their thread resolves — delete the key, don't mark "done".
  - Replace the player's previous location when they move — do not stack old locations.
  - Prune items that were used up, given away, lost, or left behind.
  - Consolidate or rename keys if the structure grows messy.
Use update_state with value=null to delete keys that no longer belong. The chronicle
summary and the conversation history already preserve the past; the state is for what
is LIVE RIGHT NOW and still shaping the plot. Keep it accurate, current, and tight —
a working dashboard, not an archive. Only after the state reflects present reality
should you produce your narrative reply.`

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
  temperature: 1.1,
  frequencyPenalty: 0.4,
  presencePenalty: 0.3,
}

const LS_SYSTEM = 'dm.systemPrompt'
const LS_SCENARIO = 'dm.scenario'
const LS_STATE = 'dm.state'
const LS_SUMMARY = 'dm.summary'
const LS_MESSAGES = 'dm.messages'
const LS_SAMPLING = 'dm.sampling'
const LS_CONTEXT = 'dm.context'

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

const MAX_STATE_STRING_CHARS = 200

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
  const [sampling, setSampling] = useState<SamplingParams>(() => loadStoredSampling())
  const [context, setContext] = useState<ContextConfig>(() => loadStoredContext())
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [statusText, setStatusText] = useState('DM is thinking…')
  const [showSettings, setShowSettings] = useState(false)
  const [showState, setShowState] = useState(false)
  const [showContext, setShowContext] = useState(false)
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

  async function send() {
    const text = input.trim()
    if (!text || thinking) return
    setInput('')
    const playerMsg: Message = { id: crypto.randomUUID(), role: 'player', text }
    const pendingMessages = [...messages, playerMsg]
    setMessages(pendingMessages)
    setThinking(true)
    setStatusText('DM is thinking…')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      let workingSummary = summary
      let workingMessages = pendingMessages
      if (totalChars(workingSummary, workingMessages) > context.triggerChars) {
        setStatusText('Compacting chronicle…')
        const compacted = await compactHistory(
          systemPrompt,
          scenario,
          workingSummary,
          workingMessages,
          context.prefixChars,
          context.summaryTargetChars,
          controller.signal,
        )
        workingSummary = compacted.summary
        workingMessages = compacted.kept
        commitSummary(workingSummary)
        setMessages(workingMessages)
        setStatusText('DM is thinking…')
      }

      const { text: reply, state: nextState } = await askDungeonMaster(
        systemPrompt,
        scenario,
        workingSummary,
        workingMessages,
        state,
        sampling,
        context.stateCleanupChars,
        controller.signal,
      )
      setMessages((m) => [...m, { id: crypto.randomUUID(), role: 'dm', text: reply }])
      commitState(nextState)
    } catch (err) {
      if (controller.signal.aborted) return
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

  async function newAdventure() {
    abortRef.current?.abort()
    setInput('')
    setMessages([])
    const freshState = structuredClone(DEFAULT_STATE)
    commitState(freshState)
    commitSummary('')
    setThinking(true)
    setStatusText('DM is thinking…')
    const controller = new AbortController()
    abortRef.current = controller
    const bootstrap: Message[] = [
      {
        id: 'bootstrap',
        role: 'player',
        text: `(OOC: Begin a new adventure. Scenario brief — ${scenario.trim()}\n\nPopulate the initial world state with scene/location/mood, the player's starting condition, any NPCs present at the start, and their goals. Then narrate the opening scene in 2-4 short paragraphs, in character as the DM. Do not reference this OOC message; just begin.)`,
      },
    ]
    try {
      const { text: reply, state: nextState } = await askDungeonMaster(
        systemPrompt,
        scenario,
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
            onClick={() => void newAdventure()}
            disabled={thinking}
            title="Start a new adventure — DM will narrate the opening from the scenario brief"
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
            <button onClick={() => void newAdventure()}>Begin Adventure</button>
            <p className="hint">The DM will narrate the opening based on your scenario brief (edit in Settings).</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <span className="who">{m.role === 'dm' ? 'DM' : 'You'}</span>
            <p>{m.text}</p>
          </div>
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
        <button onClick={() => void send()} disabled={thinking || !input.trim()}>
          Act
        </button>
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
          onClearSummary={() => commitSummary('')}
        />
      )}
      {showContext && (
        <ContextViewer
          apiMessages={buildApiMessages(
            systemPrompt,
            scenario,
            summary,
            messages,
            state,
            context.stateCleanupChars,
          )}
          tools={[UPDATE_STATE_TOOL]}
          sampling={sampling}
          onClose={() => setShowContext(false)}
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
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
              How many chars of the oldest messages get folded into the summary. Default{' '}
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>World State</h2>
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Next DM request</h2>
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

function totalChars(summary: string, messages: Message[]): number {
  return summary.length + messages.reduce((n, m) => n + m.text.length, 0)
}

function splitForCompaction(messages: Message[], targetChars: number): {
  toSummarize: Message[]
  kept: Message[]
} {
  let acc = 0
  let cut = 0
  for (let i = 0; i < messages.length; i++) {
    acc += messages[i].text.length
    cut = i + 1
    if (acc >= targetChars) break
  }
  if (cut >= messages.length) cut = Math.max(1, messages.length - 1)
  return { toSummarize: messages.slice(0, cut), kept: messages.slice(cut) }
}

function buildApiMessages(
  systemPrompt: string,
  scenario: string,
  summary: string,
  history: Message[],
  currentState: WorldState,
  stateCleanupThreshold: number,
): ApiMessage[] {
  const lastIsPlayer = history.length > 0 && history[history.length - 1].role === 'player'
  const earlier = lastIsPlayer ? history.slice(0, -1) : history
  const latestPlayer = lastIsPlayer ? history[history.length - 1] : null

  const stateJson = JSON.stringify(currentState, null, 2)
  const cleanupNudge =
    stateJson.length > stateCleanupThreshold
      ? `\n\nNOTE: the state is getting large (${stateJson.length.toLocaleString()} chars). ` +
        `Remember to clean up state — remove things no longer relevant, or summarise things ` +
        `that are still important to the plot into tighter descriptive entries. For bulk ` +
        `cleanup, use update_state with a delete=[...] array to drop multiple stale keys in ` +
        `a single call. Any individual string value is capped at ${MAX_STATE_STRING_CHARS} ` +
        `chars; longer strings will fail and delete the existing value at that path, so keep ` +
        `every entry terse.`
      : ''

  const scenarioTrimmed = scenario.trim()

  return [
    { role: 'system', content: systemPrompt },
    ...(scenarioTrimmed
      ? [
          {
            role: 'system' as const,
            content: `SCENARIO BRIEF (the premise, setting, and tone for this adventure — treat as the foundational frame for everything you narrate):\n\n${scenarioTrimmed}`,
          },
        ]
      : []),
    ...(summary
      ? [
          {
            role: 'system' as const,
            content: `STORY SO FAR (chronicle of earlier turns, condensed by the archivist — treat as canon):\n\n${summary}`,
          },
        ]
      : []),
    ...earlier.map<ApiMessage>((m) => ({
      role: m.role === 'dm' ? 'assistant' : 'user',
      content: m.text,
    })),
    {
      role: 'system',
      content:
        `Current world state (JSON):\n\n${stateJson}\n\n` +
        `Call update_state (as many times as needed) to reflect any changes this turn, then respond in character.` +
        cleanupNudge,
    },
    ...(latestPlayer
      ? [{ role: 'user' as const, content: latestPlayer.text }]
      : []),
  ]
}

async function compactHistory(
  systemPrompt: string,
  scenario: string,
  priorSummary: string,
  messages: Message[],
  prefixChars: number,
  summaryTargetChars: number,
  signal: AbortSignal,
): Promise<{ summary: string; kept: Message[] }> {
  const { toSummarize, kept } = splitForCompaction(messages, prefixChars)
  if (toSummarize.length === 0) return { summary: priorSummary, kept: messages }

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
  return { summary: content, kept }
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
  const apiMessages = buildApiMessages(
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
