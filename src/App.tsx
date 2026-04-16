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

interface SavedGame {
  id: string
  name: string
  savedAt: number
  slots: AdventureSlots
  state: WorldState
  summary: string
  messages: Message[]
  compactCutoff: number
}

const SAVE_FILE_MARKER = 'dm-save' as const

interface SaveFile {
  marker: typeof SAVE_FILE_MARKER
  version: 1
  save: SavedGame
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

const DEFAULT_SYSTEM_PROMPT = `You are the Dungeon Master — narrator of an immersive
adventure. Write in the style of fast-moving commercial fiction: clear, propulsive
prose that keeps the reader turning pages. Second person, present tense. Never
break character.

# Prose
Write complete grammatical sentences throughout. Every sentence has a subject and a
verb, with all articles, auxiliaries, and conjunctions in place. Pacing comes from
varying sentence and paragraph length — some paragraphs run one sentence, others
three or four.

Vary rhythm naturally: tighter, faster sentences during action or shock; longer,
more textured sentences when the world unfolds or a character reveals themselves.
Uniform-length paragraphs feel mechanical; so does relentless brevity.

Each metaphor and turn of phrase is fresh. Before reaching for a simile, scan the
chronicle, history, and state for it — if it has appeared, write something new.

# Keep moving
Every turn advances the scene. React to the player's action, then push forward:
something happens, someone reacts, a pressure appears, a door opens or closes. If a
moment is quiet, introduce a new element rather than lingering in stillness.

Each scene, revelation, NPC entrance, and line is new ground. Revisit a prior beat
only when the plot clearly justifies it — a deliberate callback, a return for a
story reason, an NPC tracking the player — and bring something new to it.

# Authorship
The player authors one character: their thoughts, speech, and substantive choices
(whether to fight, what to say, which path, whom to trust). You author everything
else — NPCs, animals, weather, the world, and the consequences of the player's
actions. When the player commits to a course in their input, narrate the mechanical
follow-through ("I climb" lets you describe handholds, slips, the view above). When
they have not committed, stop short and let the situation press them for a choice.

Make NPC decisions yourself. NPCs act on their own goals, fears, and curiosity;
they do not pause to ask the player what they should do, feel, or think. When the
scene needs tension, deliver it through what an NPC chooses on their own — a hand
to a weapon, an accusation, a turn for the door, a name dropped that the player
should not have heard.

NPC questions, when they happen, are real questions the NPC wants answered for
their own reasons — singular and in-character ("Who sent you?", "What did you see?",
"Can I trust you?"). The Ending section's self-check applies: would the NPC ask
this if the player did not exist? If not, rewrite as action or a different concern.

# Ending each reply
End on a *narrated stimulus* — a concrete thing happening in the world that makes
the player's next action urgent and obvious they must take one. The stimulus lives
in the fiction; the decision lives with the player. Let the moment itself demand a
response.

Endings can take many shapes — physical danger, intimate revelation, social
pressure, an unsettling discovery, a sudden change of circumstance. The form
should fit the present scene; the examples below are illustrative of *style and
shape*, not a menu of recurring scenarios:

  - His blade is already half-drawn, eyes locked on yours. Two seconds, maybe less.
  - On the upper shelf, between the ledgers — your father's signet ring, gone three
    years. Still warm.
  - "I told you what he did," she says, and waits. The room settles into her words.
  - The bell across the harbour begins to toll. A wedding bell. You had forgotten
    the date.

The narrator does not address the player. If a sentence of yours ends with a
question aimed at the player, delete it and replace it with the thing happening
that makes the question urgent. Never present the player's next action as a choice
to pick from, in any voice.

An NPC question is fine when it is a real question the NPC wants answered for
their own reasons — curiosity, suspicion, self-interest. A useful self-check:
would the NPC say this line if the player did not exist? If the line only makes
sense as a prompt aimed at the player, it is the narrator's option list in
disguise — rewrite it as action or as a genuine NPC concern.

# Continuity
Remember locations, characters, items, injuries, and ongoing threats. When an
outcome depends on chance or skill, resolve it yourself and state the result.

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

const TURN_REMINDER = `(OOC: For your next reply — 1-5 paragraphs of clear, grammatical prose, complete sentences. You author NPCs, animals, and the world. End on a narrated stimulus that fits the present scene: something said, done, discovered, revealed, or shifting that makes the player's next action urgent and obvious they must take one. The decision is the player's — never present it as a choice to pick from, in any voice. NPC questions, if any, must be things the NPC genuinely wants answered for their own reasons — not disguised option lists aimed at the player.)`

const DEFAULT_SCENARIO = `A lone adventurer arrives at the threshold of the Mouldering Vaults — an ancient, half-flooded crypt rumoured to hide the relics of a forgotten order. The air is cold, the stones are damp, and something older than death stirs within. The tone is gritty and atmospheric.`

const DEFAULT_STYLE_GUIDE = ''

type SlotKey = 'scenario' | 'styleGuide'
type AdventureSlots = Record<SlotKey, string>

interface SlotDef {
  key: SlotKey
  label: string
  header: string
  framing: string
  hint: string
  placeholder: string
  defaultValue: string
  storageKey: string
  rows: number
}

const ADVENTURE_SLOTS: SlotDef[] = [
  {
    key: 'scenario',
    label: 'Scenario brief',
    header: '# Scenario brief',
    framing:
      'The premise, setting, and tone for this adventure — the foundational frame for everything you narrate.',
    hint: 'Premise, setting, and opening situation. Sets where and what the adventure is.',
    placeholder: 'e.g. A lone adventurer arrives at the threshold of the Mouldering Vaults...',
    defaultValue: DEFAULT_SCENARIO,
    storageKey: 'dm.scenario',
    rows: 5,
  },
  {
    key: 'styleGuide',
    label: 'Author style guide',
    header: '# Author style guide',
    framing:
      'The author voice, genre, and prose register for this adventure. Apply throughout your narration in addition to the general prose rules above.',
    hint: 'Voice, genre, prose register. Optional but powerful — sets the feel of the writing.',
    placeholder: 'e.g. Gritty urban noir; sparse, elliptical dialogue; present tense; no purple prose.',
    defaultValue: DEFAULT_STYLE_GUIDE,
    storageKey: 'dm.styleGuide',
    rows: 4,
  },
]

function defaultSlots(): AdventureSlots {
  const out = {} as AdventureSlots
  for (const def of ADVENTURE_SLOTS) out[def.key] = def.defaultValue
  return out
}

function buildSlotMessage(def: SlotDef, value: string): string {
  return `${def.header}\n\n${def.framing}\n\n${value}`
}

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
  const maxChars = Math.ceil(targetChars * 1.5)
  return `You are an archivist whose sole responsibility is to produce a unified
retelling of an ongoing roleplaying-game storyline, so the Dungeon Master can keep
narrating without re-reading every prior turn.

You will be given (1) the rules the DM operates under, (2) the scenario brief, (3) any
existing summary of earlier events, and (4) a chronicle of in-character exchanges
between the DM and the player. Produce a SINGLE UNIFIED RETELLING that merges the
existing summary (if any) with the new chronicle into one continuous account of the
story so far. Together your output replaces both inputs.

# Style
Write proper narrative English prose: past tense, third person, the voice of a
chronicler recapping the tale. Every sentence is complete and grammatical, with
subject, verb, and all articles, auxiliaries, prepositions, and conjunctions in place.
Sentences flow into one another. The retelling reads as a continuous story-so-far —
not a list of facts, not a dossier, not bullet points.

# Tapered detail (most important)
The retelling has DECREASING RESOLUTION as it recedes into the past. Distant events
collapse into broad strokes — a single sentence or dependent clause for what was once
a whole scene. Middle events get a sentence or two each. The most recent events fold
in at finer detail, a few sentences per beat. By the end the reader should feel they
have been told the whole tale, with the early acts in summary and the recent acts
nearly in scene.

Nothing important is dropped. Every character, thread, promise, injury, and decision
that still shapes the plot survives into the new retelling. What changes between
passes is the WORDS used to recount old events: with each compaction you re-tell the
older material more tightly than it appeared in the previous summary, choosing
phrasing that compresses without losing material consequence.

When merging the existing summary with new chronicle: the existing summary is already
shaped this way. Re-write its earlier sections more economically to make room; absorb
the new chronicle as the most recent layer at fuller resolution; the result reads as
one continuous retelling.

A fragment of good retelling reads like this:

  Long before, the party had fled the burning village and reached the abbey, where
  the priest agreed to shelter them in exchange for a promise to recover his
  brother's seal. Through the weeks that followed they crossed the marsh and lost
  one of their number to fever, but eventually reached the river. There the priest
  pressed the captain about the missing seal, and the captain refused to answer
  until the camp was set; by nightfall those evasions had hardened into open
  silence, and the priest noted a fresh tear in the captain's cloak.

Notice how weeks of travel collapse into one sentence while the recent confrontation
gets three. That is the shape.

# Coverage at the right resolution
Preserve everything a future turn might need to stay consistent — but at the
resolution appropriate to its age:
  - Plot points, decisions, actions, and consequences, in chronological order.
  - Each character introduced: their role, motivations, current attitude toward the
    player, and current whereabouts.
  - Locations visited, items acquired or lost, injuries sustained, promises made,
    secrets revealed, clues discovered, unresolved threads, and story flags set.
  - The player character's current condition (position, clothes, inventory,
    injuries, mood) at the end of the retelling.

Older background may live in a single dependent clause ("after the abbey-priest's
errand, …"); recent state should be precise.

# Constraints
Target total length: roughly ${targetChars.toLocaleString()} characters for the entire
retelling. HARD MAXIMUM: ${maxChars.toLocaleString()} characters. If the merged content
would exceed the maximum, COMPRESS THE OLDER SECTIONS FURTHER — re-tell early events
in fewer words, condense multiple old beats into one summary sentence, prefer summary
clauses over scene re-creation for distant material. Do not delete characters, threads,
or material facts; re-tell them more tightly.

Do not pad, invent, foreshadow, or summarize events that have not happened. Output
the retelling text only — no preamble, headers, bullet markers, or meta commentary.`
}

interface ContextConfig {
  triggerChars: number
  recentTailChars: number
  summaryTargetChars: number
  stateCleanupChars: number
}

const DEFAULT_CONTEXT: ContextConfig = {
  triggerChars: 5_000,
  recentTailChars: 12_000,
  summaryTargetChars: 4_000,
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
const LS_STATE = 'dm.state'
const LS_SUMMARY = 'dm.summary'
const LS_MESSAGES = 'dm.messages'
const LS_SAMPLING = 'dm.sampling'
const LS_CONTEXT = 'dm.context'
const LS_COMPACT_CUTOFF = 'dm.compactCutoff'
const LS_SAVES = 'dm.saves'

function loadStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function loadStoredSlots(): AdventureSlots {
  const out = {} as AdventureSlots
  for (const def of ADVENTURE_SLOTS) {
    out[def.key] = loadStored(def.storageKey, def.defaultValue)
  }
  return out
}

function persistSlots(slots: AdventureSlots) {
  for (const def of ADVENTURE_SLOTS) {
    try {
      const v = slots[def.key]
      if (v) localStorage.setItem(def.storageKey, v)
      else localStorage.removeItem(def.storageKey)
    } catch {
      // ignore quota / disabled storage
    }
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

function loadStoredSaves(): SavedGame[] {
  try {
    const raw = localStorage.getItem(LS_SAVES)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedGame).map(normalizeSavedGame)
  } catch {
    return []
  }
}

function persistSaves(saves: SavedGame[]) {
  try {
    localStorage.setItem(LS_SAVES, JSON.stringify(saves))
  } catch {
    // ignore quota / disabled storage
  }
}

function makeSaveId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isSavedGame(v: unknown): v is SavedGame {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  const hasNewSlots =
    typeof s.slots === 'object' && s.slots !== null && !Array.isArray(s.slots)
  const hasOldScenario = typeof s.scenario === 'string'
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.savedAt === 'number' &&
    (hasNewSlots || hasOldScenario) &&
    typeof s.summary === 'string' &&
    typeof s.compactCutoff === 'number' &&
    Array.isArray(s.messages) &&
    typeof s.state === 'object' &&
    s.state !== null &&
    !Array.isArray(s.state)
  )
}

function normalizeSavedGame(raw: SavedGame): SavedGame {
  const legacy = raw as SavedGame & { scenario?: string }
  const incoming: Partial<AdventureSlots> = (legacy.slots as Partial<AdventureSlots> | undefined) ?? {}
  const slots = { ...defaultSlots(), ...incoming }
  if (legacy.scenario && !incoming.scenario) {
    slots.scenario = legacy.scenario
  }
  const { scenario: _legacyScenario, ...rest } = legacy
  void _legacyScenario
  return { ...rest, slots }
}

function loadStoredContext(): ContextConfig {
  try {
    const raw = localStorage.getItem(LS_CONTEXT)
    if (!raw) return { ...DEFAULT_CONTEXT }
    const parsed = JSON.parse(raw) as Partial<ContextConfig> & { prefixChars?: number }
    const recentTail =
      typeof parsed.recentTailChars === 'number'
        ? parsed.recentTailChars
        : typeof parsed.prefixChars === 'number'
          ? parsed.prefixChars
          : DEFAULT_CONTEXT.recentTailChars
    let trigger =
      typeof parsed.triggerChars === 'number' ? parsed.triggerChars : DEFAULT_CONTEXT.triggerChars
    if (trigger > 15_000) trigger = DEFAULT_CONTEXT.triggerChars
    return {
      triggerChars: trigger,
      recentTailChars: recentTail,
      summaryTargetChars:
        typeof parsed.summaryTargetChars === 'number'
          ? parsed.summaryTargetChars
          : DEFAULT_CONTEXT.summaryTargetChars,
      stateCleanupChars:
        typeof parsed.stateCleanupChars === 'number'
          ? parsed.stateCleanupChars
          : DEFAULT_CONTEXT.stateCleanupChars,
    }
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
  const [slots, setSlots] = useState<AdventureSlots>(() => loadStoredSlots())
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
  const [showSaves, setShowSaves] = useState(false)
  const [saves, setSaves] = useState<SavedGame[]>(() => loadStoredSaves())
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

  function commitSlots(next: AdventureSlots) {
    setSlots(next)
    persistSlots(next)
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
      summary,
      messages,
      compactCutoff,
    }
    commitSaves([entry, ...saves])
  }

  function loadSavedGame(id: string) {
    const target = saves.find((s) => s.id === id)
    if (!target) return
    if (
      (messages.length > 0 || summary) &&
      !confirm('Load this save? Your current adventure will be replaced.')
    ) {
      return
    }
    abortRef.current?.abort()
    setThinking(false)
    setSnapshot(null)
    commitSlots({ ...defaultSlots(), ...target.slots })
    commitState(structuredClone(target.state))
    commitSummary(target.summary)
    setMessages(target.messages)
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
    const payload: SaveFile = { marker: SAVE_FILE_MARKER, version: 1, save: target }
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
      let save: SavedGame | null = null
      if (
        parsed &&
        typeof parsed === 'object' &&
        (parsed as { marker?: unknown }).marker === SAVE_FILE_MARKER &&
        isSavedGame((parsed as { save?: unknown }).save)
      ) {
        save = (parsed as SaveFile).save
      } else if (isSavedGame(parsed)) {
        save = parsed
      }
      if (!save) {
        alert('That file is not a valid Dungeon Master save.')
        return
      }
      const normalized = normalizeSavedGame(save)
      const entry: SavedGame = { ...normalized, id: makeSaveId(), savedAt: Date.now() }
      commitSaves([entry, ...saves])
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
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
      const proposedCutoff = findCompactionCutoff(
        pendingMessages,
        workingCutoff,
        context.recentTailChars,
      )
      const wouldFoldChars = pendingMessages
        .slice(workingCutoff, proposedCutoff)
        .reduce((n, m) => n + m.text.length, 0)
      if (wouldFoldChars >= context.triggerChars) {
        setStatusText('Compacting chronicle…')
        const compacted = await compactHistory(
          systemPrompt,
          slots,
          workingSummary,
          pendingMessages,
          workingCutoff,
          context.recentTailChars,
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
        slots,
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

  async function compactNow() {
    if (thinking) return
    const proposedCutoff = findCompactionCutoff(
      messages,
      compactCutoff,
      context.recentTailChars,
    )
    const wouldFold = proposedCutoff > compactCutoff
    const summaryOverTarget = summary.length > Math.ceil(context.summaryTargetChars * 1.2)
    if (!wouldFold && !summaryOverTarget) {
      alert('Nothing to compact: chronicle is up to date and within target length.')
      return
    }
    setThinking(true)
    setStatusText(wouldFold ? 'Compacting chronicle…' : 'Re-compressing chronicle…')
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const compacted = await compactHistory(
        systemPrompt,
        slots,
        summary,
        messages,
        compactCutoff,
        context.recentTailChars,
        context.summaryTargetChars,
        controller.signal,
        true,
      )
      commitSummary(compacted.summary)
      commitCompactCutoff(compacted.cutoff)
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
    nextSlots: AdventureSlots,
    nextSampling: SamplingParams,
    nextContext: ContextConfig,
  ) {
    setSystemPrompt(nextSystem)
    commitSlots(nextSlots)
    setSampling(nextSampling)
    setContext(nextContext)
    try {
      localStorage.setItem(LS_SYSTEM, nextSystem)
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
        text: `(OOC: Begin a new adventure. Scenario brief — ${nextSlots.scenario}\n\nPopulate the initial world state with scene/location/mood, the player's starting condition, any NPCs present at the start, and their goals. Then narrate the opening scene in 2-4 short paragraphs, in character as the DM. Do not reference this OOC message; just begin.)`,
      },
    ]
    try {
      const { text: reply, state: nextState } = await askDungeonMaster(
        systemPrompt,
        nextSlots,
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
          <button
            className="ghost"
            onClick={() => void compactNow()}
            disabled={thinking || messages.length - compactCutoff <= 1}
            title="Fold older turns into the chronicle summary now"
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
          summary={summary}
          context={context}
          onClose={() => setShowState(false)}
          onResetState={() => commitState(structuredClone(DEFAULT_STATE))}
          onSaveState={commitState}
          onSaveSummary={commitSummary}
          onClearSummary={() => {
            commitSummary('')
            commitCompactCutoff(0)
          }}
        />
      )}
      {showContext && (
        <ContextViewer
          apiMessages={[
            ...buildApiMessages(
              systemPrompt,
              slots,
              summary,
              messages.slice(compactCutoff),
              state,
              context.stateCleanupChars,
            ),
            { role: 'user', content: TURN_REMINDER },
          ]}
          tools={[UPDATE_STATE_TOOL]}
          sampling={sampling}
          onClose={() => setShowContext(false)}
        />
      )}
      {showNewAdventure && (
        <NewAdventurePrompt
          slots={slots}
          inProgress={messages.length > 0}
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
          canSave={messages.length > 0}
          turnCount={messages.length}
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

interface SettingsPanelProps {
  systemPrompt: string
  slots: AdventureSlots
  sampling: SamplingParams
  context: ContextConfig
  onClose: () => void
  onSave: (
    systemPrompt: string,
    slots: AdventureSlots,
    sampling: SamplingParams,
    context: ContextConfig,
  ) => void
}

function SettingsPanel({
  systemPrompt,
  slots,
  sampling,
  context,
  onClose,
  onSave,
}: SettingsPanelProps) {
  const [draftSystem, setDraftSystem] = useState(systemPrompt)
  const [draftSlots, setDraftSlots] = useState<AdventureSlots>(() => ({ ...slots }))
  const [draftSampling, setDraftSampling] = useState<SamplingParams>(sampling)
  const [draftContext, setDraftContext] = useState<ContextConfig>(context)

  function setSlotField(key: SlotKey, value: string) {
    setDraftSlots((s) => ({ ...s, [key]: value }))
  }

  function setSamplingField<K extends keyof SamplingParams>(key: K, value: number) {
    setDraftSampling((s) => ({ ...s, [key]: value }))
  }

  function setContextField<K extends keyof ContextConfig>(key: K, value: number) {
    setDraftContext((c) => ({ ...c, [key]: value }))
  }

  function save() {
    const trimmed = {} as AdventureSlots
    for (const def of ADVENTURE_SLOTS) trimmed[def.key] = (draftSlots[def.key] ?? '').trim()
    onSave(draftSystem.trim(), trimmed, draftSampling, draftContext)
    onClose()
  }

  function resetDefaults() {
    setDraftSystem(DEFAULT_SYSTEM_PROMPT)
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
        {ADVENTURE_SLOTS.map((def) => (
          <label key={def.key}>
            <span>{def.label}</span>
            <textarea
              value={draftSlots[def.key] ?? ''}
              onChange={(e) => setSlotField(def.key, e.target.value)}
              rows={def.rows}
              placeholder={def.placeholder}
            />
            <small className="hint">{def.hint}</small>
          </label>
        ))}

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
            <span>Recent tail (chars)</span>
            <input
              type="number"
              min={2000}
              step={1000}
              value={draftContext.recentTailChars}
              onChange={(e) => setContextField('recentTailChars', Number(e.target.value))}
            />
            <small>
              Recent message text always kept live (uncompacted). Older turns past
              this tail are eligible for folding into the chronicle. Default{' '}
              {DEFAULT_CONTEXT.recentTailChars.toLocaleString()}.
            </small>
          </label>
          <label className="sampling-field">
            <span>Compact trigger (chars)</span>
            <input
              type="number"
              min={500}
              step={500}
              value={draftContext.triggerChars}
              onChange={(e) => setContextField('triggerChars', Number(e.target.value))}
            />
            <small>
              Compaction fires when this much older-than-tail material has piled
              up since the last fold. Default{' '}
              {DEFAULT_CONTEXT.triggerChars.toLocaleString()}.
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
  slots: AdventureSlots
  inProgress: boolean
  onCancel: () => void
  onBegin: (slots: AdventureSlots) => void
}

function NewAdventurePrompt({ slots, inProgress, onCancel, onBegin }: NewAdventurePromptProps) {
  const [drafts, setDrafts] = useState<AdventureSlots>(() => ({ ...slots }))
  const scenarioReady = (drafts.scenario ?? '').trim().length > 0

  function setSlotField(key: SlotKey, value: string) {
    setDrafts((d) => ({ ...d, [key]: value }))
  }

  function begin() {
    const trimmed = {} as AdventureSlots
    for (const def of ADVENTURE_SLOTS) trimmed[def.key] = (drafts[def.key] ?? '').trim()
    onBegin(trimmed)
  }

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
        {ADVENTURE_SLOTS.map((def, i) => (
          <label key={def.key}>
            <span>{def.label}</span>
            <textarea
              value={drafts[def.key] ?? ''}
              onChange={(e) => setSlotField(def.key, e.target.value)}
              rows={def.rows}
              placeholder={def.placeholder}
              autoFocus={i === 0}
            />
            <small className="hint">{def.hint}</small>
          </label>
        ))}
        <div className="modal-actions">
          <span className="spacer" />
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button onClick={begin} disabled={!scenarioReady}>
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
  onSaveState: (next: WorldState) => void
  onSaveSummary: (next: string) => void
  onClearSummary: () => void
}

function StateViewer({
  state,
  summary,
  context,
  onClose,
  onResetState,
  onSaveState,
  onSaveSummary,
  onClearSummary,
}: StateViewerProps) {
  const [draft, setDraft] = useState(() => JSON.stringify(state, null, 2))
  const [parseError, setParseError] = useState<string | null>(null)
  const [summaryDraft, setSummaryDraft] = useState(summary)

  useEffect(() => {
    setDraft(JSON.stringify(state, null, 2))
    setParseError(null)
  }, [state])

  useEffect(() => {
    setSummaryDraft(summary)
  }, [summary])

  const currentJson = JSON.stringify(state, null, 2)
  const stateDirty = draft !== currentJson
  const summaryDirty = summaryDraft !== summary

  function handleSave() {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('State must be a JSON object (e.g. { "scene": {...} }).')
      return
    }
    setParseError(null)
    onSaveState(parsed as WorldState)
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>World State</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="hint">
          The DM maintains this JSON via an <code>update_state</code> tool after each turn.
          It's sent to the model as a system message after the conversation history. Edit
          below and click <em>Save state</em> to override.
        </p>
        <textarea
          className="state-json state-json-editor"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {parseError && <p className="error-text">{parseError}</p>}

        <h2>Chronicle summary</h2>
        <p className="hint">
          Auto-generated when at least {context.triggerChars.toLocaleString()} chars of
          older-than-tail history have accumulated; older turns are folded into this recap
          (target ~{context.summaryTargetChars.toLocaleString()} chars), while the most
          recent ~{context.recentTailChars.toLocaleString()} chars of message text stay live.
          Current length: {summaryDraft.length.toLocaleString()} chars. Edit freely and
          click <em>Save summary</em>.
        </p>
        <textarea
          className="state-json state-json-editor"
          spellCheck={false}
          value={summaryDraft}
          onChange={(e) => setSummaryDraft(e.target.value)}
          placeholder="(no summary yet)"
        />

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
          <button onClick={handleSave} disabled={!stateDirty}>
            Save state
          </button>
          <button onClick={() => onSaveSummary(summaryDraft)} disabled={!summaryDirty}>
            Save summary
          </button>
        </div>
      </div>
    </div>
  )
}

interface SavesPanelProps {
  saves: SavedGame[]
  canSave: boolean
  turnCount: number
  onClose: () => void
  onSave: (name: string) => void
  onLoad: (id: string) => void
  onDelete: (id: string) => void
  onExport: (id: string) => void
  onImport: (file: File) => void
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts
  const sec = Math.max(0, Math.floor(diffMs / 1000))
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`
  const days = Math.floor(sec / 86400)
  if (days < 14) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

function SavesPanel({
  saves,
  canSave,
  turnCount,
  onClose,
  onSave,
  onLoad,
  onDelete,
  onExport,
  onImport,
}: SavesPanelProps) {
  const [name, setName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function handleSave() {
    onSave(name)
    setName('')
  }

  function handleImportClick() {
    fileRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onImport(file)
    e.target.value = ''
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>Saved games</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <h3 className="saves-subhead">Save current game</h3>
        <p className="hint">
          {canSave
            ? `Snapshot scenario, style, chronicle, state, and all ${turnCount} turn${turnCount === 1 ? '' : 's'} under a short label.`
            : 'Start an adventure first — there is nothing to save yet.'}
        </p>
        <div className="saves-save-row">
          <input
            type="text"
            placeholder="Brief summary — e.g. Before the crypt fight"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) handleSave()
            }}
            disabled={!canSave}
          />
          <button onClick={handleSave} disabled={!canSave}>
            Save current
          </button>
        </div>

        <h3 className="saves-subhead">Saved ({saves.length})</h3>
        {saves.length === 0 ? (
          <p className="hint">No saved games yet.</p>
        ) : (
          <div className="saves-list">
            {saves.map((s) => (
              <div key={s.id} className="saves-item">
                <div className="saves-item-head">
                  <span className="saves-item-name">{s.name}</span>
                  <span className="saves-item-meta">
                    {s.messages.length} turn{s.messages.length === 1 ? '' : 's'} · {formatRelative(s.savedAt)}
                  </span>
                </div>
                <div className="saves-item-actions">
                  <button onClick={() => onLoad(s.id)}>Load</button>
                  <button className="ghost" onClick={() => onExport(s.id)}>Export</button>
                  <button className="ghost" onClick={() => onDelete(s.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={handleImportClick}>
            Import from file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
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

function findCompactionCutoff(
  messages: Message[],
  priorCutoff: number,
  recentTailChars: number,
): number {
  // Walk backwards from the end accumulating text. The new cutoff is the
  // earliest message index whose tail [index..end] still contains at least
  // recentTailChars of message text — guaranteeing the live tail survives.
  // Anything before the cutoff is foldable into the chronicle summary.
  let acc = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    acc += messages[i].text.length
    if (acc >= recentTailChars) {
      return Math.max(priorCutoff, i)
    }
  }
  return priorCutoff
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
  slots: AdventureSlots,
  summary: string,
  history: Message[],
  currentState: WorldState,
  stateCleanupThreshold: number,
): { messages: ApiMessage[]; stateIndex: number } {
  const messages: ApiMessage[] = [{ role: 'system', content: systemPrompt }]
  for (const def of ADVENTURE_SLOTS) {
    const value = (slots[def.key] ?? '').trim()
    if (!value) continue
    messages.push({ role: 'system', content: buildSlotMessage(def, value) })
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
  slots: AdventureSlots,
  summary: string,
  history: Message[],
  currentState: WorldState,
  stateCleanupThreshold: number,
): ApiMessage[] {
  return buildApiMessagesIndexed(
    systemPrompt,
    slots,
    summary,
    history,
    currentState,
    stateCleanupThreshold,
  ).messages
}

async function compactHistory(
  systemPrompt: string,
  slots: AdventureSlots,
  priorSummary: string,
  messages: Message[],
  priorCutoff: number,
  recentTailChars: number,
  summaryTargetChars: number,
  signal: AbortSignal,
  allowRewrite = false,
): Promise<{ summary: string; cutoff: number }> {
  const slotsBlock = ADVENTURE_SLOTS.map((def) => {
    const v = (slots[def.key] ?? '').trim()
    return v ? `${def.label}:\n\n${v}` : ''
  })
    .filter(Boolean)
    .join('\n\n')
  const newCutoff = findCompactionCutoff(messages, priorCutoff, recentTailChars)
  const hasNew = newCutoff > priorCutoff
  if (!hasNew && !(allowRewrite && priorSummary)) {
    return { summary: priorSummary, cutoff: priorCutoff }
  }

  const toSummarize = hasNew ? messages.slice(priorCutoff, newCutoff) : []
  const chronicle = toSummarize
    .map((m) => `${m.role === 'dm' ? 'DM' : 'PLAYER'}: ${m.text}`)
    .join('\n\n')

  const userContent = hasNew
    ? `DM system prompt (rules the narrator follows):\n\n${systemPrompt}\n\n` +
      `${slotsBlock}\n\n` +
      (priorSummary
        ? `Existing retelling of earlier events (merge in and re-tell more tightly as needed):\n\n${priorSummary}\n\n`
        : '') +
      `Chronicle to fold in (in order):\n\n${chronicle}\n\n` +
      `Now write the unified retelling.`
    : `DM system prompt (rules the narrator follows):\n\n${systemPrompt}\n\n` +
      `${slotsBlock}\n\n` +
      `Existing retelling to RE-COMPRESS — there is no new chronicle to fold in this pass. Re-tell the same material more tightly so the result fits within the target length. Preserve every character, thread, and material fact; the early sections in particular should collapse further.\n\n${priorSummary}\n\n` +
      `Now write the re-compressed retelling.`

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
  if (!content) throw new Error('Summarizer returned empty retelling')
  return { summary: content, cutoff: hasNew ? newCutoff : priorCutoff }
}

function modelSupportsSampling(model: string): boolean {
  // Reasoning models (e.g. grok-4-1-fast-reasoning) reject temperature and penalty params.
  return !/reasoning/i.test(model)
}

async function askDungeonMaster(
  systemPrompt: string,
  slots: AdventureSlots,
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
    slots,
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
      messages: [...apiMessages, { role: 'user', content: TURN_REMINDER }],
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
