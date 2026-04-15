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
2-4 short paragraphs.

Describe the world's reaction to the player's action, then keep the story moving. Every
turn should advance the scene: something happens, someone reacts, a new pressure appears,
a door opens or closes. Always end on a fresh development that presents the player with
the next challenge or decision — an unfolding event, a looming threat, a choice to weigh,
a hook to pull on. Show, don't ask: do NOT close with rhetorical prompts like "What do
you do?" or "What's your next move?" — the situation itself should demand a response.

Avoid static descriptions or stalling; if a beat is quiet, introduce a new element.

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
and possessions, NPCs present, their goals and attitudes, story flags, etc. Before
narrating each turn, call the update_state tool as many times as needed to record the
changes produced by the player's latest action and your narration — new NPCs who appear,
shifts in relationships or goals, the player's position/clothing/inventory/injuries,
location changes, story beats reached. Keep the state accurate and current; treat it as
the source of truth for continuity. Only after the state reflects reality should you
produce your narrative reply.`

const DEFAULT_SCENARIO = `A lone adventurer arrives at the threshold of the Mouldering Vaults — an ancient, half-flooded crypt rumoured to hide the relics of a forgotten order. The air is cold, the stones are damp, and something older than death stirs within. The tone is gritty and atmospheric.`

const DEFAULT_STATE: WorldState = {
  scene: { location: '', time: '', mood: '' },
  player: { position: 'standing', clothes: [], inventory: [], status: [] },
  npcs: {},
  goals: {},
  flags: {},
}

const LS_SYSTEM = 'dm.systemPrompt'
const LS_SCENARIO = 'dm.scenario'
const LS_STATE = 'dm.state'

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
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showState, setShowState] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  useEffect(() => () => abortRef.current?.abort(), [])

  function commitState(next: WorldState) {
    setState(next)
    persistState(next)
  }

  async function send() {
    const text = input.trim()
    if (!text || thinking) return
    setInput('')
    const playerMsg: Message = { id: crypto.randomUUID(), role: 'player', text }
    setMessages((m) => [...m, playerMsg])
    setThinking(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const { text: reply, state: nextState } = await askDungeonMaster(
        systemPrompt,
        [...messages, playerMsg],
        state,
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

  function saveSettings(nextSystem: string, nextScenario: string) {
    setSystemPrompt(nextSystem)
    setScenario(nextScenario)
    try {
      localStorage.setItem(LS_SYSTEM, nextSystem)
      localStorage.setItem(LS_SCENARIO, nextScenario)
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
    setThinking(true)
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
        bootstrap,
        freshState,
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
        {thinking && <div className="msg msg-dm thinking">DM is thinking…</div>}
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
          onClose={() => setShowSettings(false)}
          onSave={saveSettings}
        />
      )}
      {showState && (
        <StateViewer
          state={state}
          onClose={() => setShowState(false)}
          onReset={() => commitState(structuredClone(DEFAULT_STATE))}
        />
      )}
    </main>
  )
}

interface SettingsPanelProps {
  systemPrompt: string
  scenario: string
  onClose: () => void
  onSave: (systemPrompt: string, scenario: string) => void
}

function SettingsPanel({ systemPrompt, scenario, onClose, onSave }: SettingsPanelProps) {
  const [draftSystem, setDraftSystem] = useState(systemPrompt)
  const [draftScenario, setDraftScenario] = useState(scenario)

  function save() {
    onSave(draftSystem.trim(), draftScenario.trim())
    onClose()
  }

  function resetDefaults() {
    setDraftSystem(DEFAULT_SYSTEM_PROMPT)
    setDraftScenario(DEFAULT_SCENARIO)
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
        <p className="hint">
          Saving persists to this browser. The system prompt takes effect on the next turn.
          Click <em>New Adventure</em> in the header to restart — the DM will generate a fresh
          opening from the brief above.
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
  onClose: () => void
  onReset: () => void
}

function StateViewer({ state, onClose, onReset }: StateViewerProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>World State</h2>
        <p className="hint">
          The DM maintains this JSON via an <code>update_state</code> tool after each turn.
          It's sent to the model as a system message after the conversation history.
        </p>
        <pre className="state-json">{JSON.stringify(state, null, 2)}</pre>
        <div className="modal-actions">
          <button
            className="ghost"
            onClick={() => {
              if (confirm('Reset world state to empty defaults?')) onReset()
            }}
          >
            Reset state
          </button>
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
      'Update the world state JSON at a dotted path. Example: path="npcs.jack.goals.seduceHer", value="seduce the player". Use value=null to delete the key at that path. Intermediate objects are created as needed. Call this tool as many times as needed before your narrative reply to reflect everything that changed this turn.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Dotted path into the state JSON, e.g. "player.position" or "npcs.jack.type".',
        },
        value: {
          description: 'The JSON value to set at that path. Any JSON type is allowed. null deletes the key.',
        },
      },
      required: ['path', 'value'],
    },
  },
}

async function askDungeonMaster(
  systemPrompt: string,
  history: Message[],
  initialState: WorldState,
  signal: AbortSignal,
): Promise<{ text: string; state: WorldState }> {
  let currentState = initialState
  const apiMessages: ApiMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map<ApiMessage>((m) => ({
      role: m.role === 'dm' ? 'assistant' : 'user',
      content: m.text,
    })),
    {
      role: 'system',
      content:
        `Current world state (JSON):\n\n${JSON.stringify(currentState, null, 2)}\n\n` +
        `Call update_state (as many times as needed) to reflect any changes this turn, then respond in character.`,
    },
  ]

  let nudged = false
  for (let iter = 0; iter < 8; iter++) {
    // __XAI_MODEL__ is injected by Vite `define` — see vite.config.ts.
    const res = await fetch('/api/xai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: __XAI_MODEL__,
        messages: apiMessages,
        tools: [UPDATE_STATE_TOOL],
        stream: false,
      }),
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
              path: string
              value: JsonValue
            }
            currentState = setByPath(currentState, args.path, args.value)
            apiMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: `ok — set ${args.path}`,
            })
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
