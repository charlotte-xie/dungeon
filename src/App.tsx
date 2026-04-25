import { Fragment, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  DEFAULT_SCENARIO,
  DEFAULT_SYSTEM_PROMPT,
  TURN_REMINDER,
  buildNewAdventureBootstrap,
  buildPlotRules,
  buildStateRules,
  buildSummarizerPrompt,
} from './prompts'

type Role = 'dm' | 'player'

type TraceEvent =
  | { kind: 'thought'; text: string }
  | { kind: 'call'; name: string; arguments: string; result: string }

interface Message {
  id: string
  role: Role
  text: string
  trace?: TraceEvent[]
}

interface TurnSnapshot {
  messages: Message[]
  state: WorldState
  plot: string[]
  summary: string
  compactCutoff: number
  input: string
  continueRequested?: boolean
}

const CONTINUE_DIRECTIVE =
  '(OOC: Continue the scene without waiting for a new player action. Push the narrative forward — time passing, an NPC making a move, a revelation, a pressure mounting — until the player faces a concrete decision. End on a narrated stimulus as usual.)'

interface SavedGame {
  id: string
  name: string
  savedAt: number
  slots: AdventureSlots
  state: WorldState
  plot: string[]
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
const MAX_PLOT_ITEMS = 10
const MAX_PLOT_ITEM_CHARS = 200

const STATE_RULES = buildStateRules(MAX_STATE_STRING_CHARS)
const PLOT_RULES = buildPlotRules(MAX_PLOT_ITEMS, MAX_PLOT_ITEM_CHARS)

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

interface ContextConfig {
  triggerChars: number
  recentTailChars: number
  summaryTargetChars: number
  stateCleanupChars: number
  includePriorPlayerTurns: boolean
  appendReminderToUser: boolean
  includeWorldState: boolean
  includePlotOutline: boolean
}

const DEFAULT_CONTEXT: ContextConfig = {
  triggerChars: 20_000,
  recentTailChars: 40_000,
  summaryTargetChars: 8_000,
  stateCleanupChars: 10_000,
  includePriorPlayerTurns: true,
  appendReminderToUser: false,
  includeWorldState: true,
  includePlotOutline: true,
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

const XAI_BASE_URL = 'https://api.x.ai/v1'
const DEFAULT_MODEL = 'grok-4'

const LS_SYSTEM = 'dm.systemPrompt'
const LS_MODEL = 'dm.model'
const LS_XAI_KEY = 'dm.xaiKey'
const LS_STATE = 'dm.state'
const LS_PLOT = 'dm.plot'
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

function loadStoredPlot(): string[] {
  try {
    const raw = localStorage.getItem(LS_PLOT)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is string => typeof p === 'string')
  } catch {
    return []
  }
}

function persistPlot(plot: string[]) {
  try {
    if (plot.length) localStorage.setItem(LS_PLOT, JSON.stringify(plot))
    else localStorage.removeItem(LS_PLOT)
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
  const legacy = raw as SavedGame & { scenario?: string; plot?: unknown }
  const incoming: Partial<AdventureSlots> = (legacy.slots as Partial<AdventureSlots> | undefined) ?? {}
  const slots = { ...defaultSlots(), ...incoming }
  if (legacy.scenario && !incoming.scenario) {
    slots.scenario = legacy.scenario
  }
  const plot = Array.isArray(legacy.plot)
    ? legacy.plot.filter((p): p is string => typeof p === 'string')
    : []
  const rest = { ...legacy } as SavedGame & { scenario?: string }
  delete rest.scenario
  return { ...rest, slots, plot }
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
    const trigger =
      typeof parsed.triggerChars === 'number' ? parsed.triggerChars : DEFAULT_CONTEXT.triggerChars
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
      includePriorPlayerTurns:
        typeof parsed.includePriorPlayerTurns === 'boolean'
          ? parsed.includePriorPlayerTurns
          : DEFAULT_CONTEXT.includePriorPlayerTurns,
      appendReminderToUser:
        typeof parsed.appendReminderToUser === 'boolean'
          ? parsed.appendReminderToUser
          : DEFAULT_CONTEXT.appendReminderToUser,
      includeWorldState:
        typeof parsed.includeWorldState === 'boolean'
          ? parsed.includeWorldState
          : DEFAULT_CONTEXT.includeWorldState,
      includePlotOutline:
        typeof parsed.includePlotOutline === 'boolean'
          ? parsed.includePlotOutline
          : DEFAULT_CONTEXT.includePlotOutline,
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
  obj[keys[keys.length - 1]] = value
  return next
}

function stripTracesBefore(messages: Message[], cutoff: number): Message[] {
  let changed = false
  const next = messages.map((m, i) => {
    if (i >= cutoff || !m.trace) return m
    changed = true
    const copy: Message = { id: m.id, role: m.role, text: m.text }
    return copy
  })
  return changed ? next : messages
}

function deleteByPath(state: WorldState, path: string): WorldState {
  const keys = path.split('.').filter(Boolean)
  if (keys.length === 0) return state
  const next: WorldState = structuredClone(state)
  let obj: { [key: string]: JsonValue } = next
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    const existing = obj[k]
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
      return state
    }
    obj = existing as { [key: string]: JsonValue }
  }
  delete obj[keys[keys.length - 1]]
  return next
}

function App() {
  const [systemPrompt, setSystemPrompt] = useState(() =>
    loadStored(LS_SYSTEM, DEFAULT_SYSTEM_PROMPT),
  )
  const [model, setModel] = useState(() => loadStored(LS_MODEL, DEFAULT_MODEL))
  const [xaiKey, setXaiKey] = useState(() => loadStored(LS_XAI_KEY, ''))
  const [slots, setSlots] = useState<AdventureSlots>(() => loadStoredSlots())
  const [state, setState] = useState<WorldState>(() => loadStoredState())
  const [plot, setPlot] = useState<string[]>(() => loadStoredPlot())
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

  const compactProposedCutoff = findCompactionCutoff(
    messages,
    compactCutoff,
    context.recentTailChars,
  )
  const compactWouldFold = compactProposedCutoff > compactCutoff
  const summaryOverTarget = summary.length > Math.ceil(context.summaryTargetChars * 1.2)
  const canCompact = compactWouldFold || summaryOverTarget

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

  function commitPlot(next: string[]) {
    setPlot(next)
    persistPlot(next)
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
      plot: [...plot],
      summary,
      messages: structuredClone(messages),
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
    commitPlot([...(target.plot ?? [])])
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
    basePlot: string[],
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
          model,
          xaiKey,
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
        setMessages((m) => stripTracesBefore(m, workingCutoff))
        setStatusText('DM is thinking…')
      }

      const { text: reply, state: nextState, plot: nextPlot, trace } = await askDungeonMaster(
        systemPrompt,
        model,
        xaiKey,
        slots,
        workingSummary,
        pendingMessages.slice(workingCutoff),
        baseState,
        basePlot,
        sampling,
        context.stateCleanupChars,
        context.includePriorPlayerTurns,
        context.appendReminderToUser,
        context.includeWorldState,
        context.includePlotOutline,
        controller.signal,
      )
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'dm', text: reply, trace },
      ])
      commitState(nextState)
      commitPlot(nextPlot)
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
      plot,
      summary,
      compactCutoff,
      input: text,
    }
    setSnapshot(snap)
    const playerMsg: Message = { id: crypto.randomUUID(), role: 'player', text }
    const pendingMessages = [...messages, playerMsg]
    setMessages(pendingMessages)
    await runTurn(pendingMessages, state, plot, summary, compactCutoff, () => {
      setMessages((m) => (m[m.length - 1]?.id === playerMsg.id ? m.slice(0, -1) : m))
      setInput((cur) => cur || text)
    })
  }

  async function continueStory() {
    if (thinking || messages.length === 0) return
    const snap: TurnSnapshot = {
      messages,
      state,
      plot,
      summary,
      compactCutoff,
      input: '',
      continueRequested: true,
    }
    setSnapshot(snap)
    const directiveMsg: Message = {
      id: crypto.randomUUID(),
      role: 'player',
      text: CONTINUE_DIRECTIVE,
    }
    // The directive is sent to the model but never added to the visible
    // transcript, so it doesn't appear in replay or get persisted.
    const pendingMessages = [...messages, directiveMsg]
    await runTurn(pendingMessages, state, plot, summary, compactCutoff, () => {})
  }

  function undo() {
    if (thinking || !snapshot) return
    setMessages(snapshot.messages)
    commitState(snapshot.state)
    commitPlot([...snapshot.plot])
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
        model,
        xaiKey,
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
      setMessages((m) => stripTracesBefore(m, compacted.cutoff))
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
    commitSummary(snap.summary)
    commitCompactCutoff(snap.compactCutoff)
    if (snap.continueRequested) {
      const directiveMsg: Message = {
        id: crypto.randomUUID(),
        role: 'player',
        text: CONTINUE_DIRECTIVE,
      }
      setMessages(snap.messages)
      const pendingMessages = [...snap.messages, directiveMsg]
      await runTurn(pendingMessages, snap.state, snap.plot, snap.summary, snap.compactCutoff, () => {})
      return
    }
    const playerMsg: Message = { id: crypto.randomUUID(), role: 'player', text: snap.input }
    const pendingMessages = [...snap.messages, playerMsg]
    setMessages(pendingMessages)
    await runTurn(pendingMessages, snap.state, snap.plot, snap.summary, snap.compactCutoff, () => {
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
    setMessages([])
    setSnapshot(null)
    const freshState = structuredClone(DEFAULT_STATE)
    commitState(freshState)
    commitPlot([])
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
        text: buildNewAdventureBootstrap(nextSlots.scenario),
      },
    ]
    try {
      const { text: reply, state: nextState, plot: nextPlot, trace } = await askDungeonMaster(
        systemPrompt,
        model,
        xaiKey,
        nextSlots,
        '',
        bootstrap,
        freshState,
        [],
        sampling,
        context.stateCleanupChars,
        context.includePriorPlayerTurns,
        context.appendReminderToUser,
        context.includeWorldState,
        context.includePlotOutline,
        controller.signal,
      )
      setMessages([{ id: crypto.randomUUID(), role: 'dm', text: reply, trace }])
      commitState(nextState)
      commitPlot(nextPlot)
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
            disabled={thinking || !canCompact}
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
              {m.role === 'dm' && m.trace !== undefined && (
                <TraceView
                  trace={m.trace}
                  expanded={expandedTraces.has(m.id)}
                  onToggle={() => toggleTrace(m.id)}
                />
              )}
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
          <button
            className="ghost"
            onClick={() => void continueStory()}
            disabled={thinking || messages.length === 0}
            title="Have the DM keep narrating — time passes, NPCs act — until the player faces a concrete decision"
          >
            Continue
          </button>
          <button onClick={() => void send()} disabled={thinking || !input.trim()}>
            Act
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
          summary={summary}
          context={context}
          onClose={() => setShowState(false)}
          onResetState={() => commitState(structuredClone(DEFAULT_STATE))}
          onSaveState={commitState}
          onSavePlot={commitPlot}
          onClearPlot={() => commitPlot([])}
          onSaveSummary={commitSummary}
          onClearSummary={() => {
            commitSummary('')
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
              summary,
              messages.slice(compactCutoff),
              state,
              plot,
              context.stateCleanupChars,
              context.includePriorPlayerTurns,
              context.includeWorldState,
              context.includePlotOutline,
            ),
            context.appendReminderToUser,
          )}
          tools={[
            ...(context.includeWorldState ? [UPDATE_STATE_TOOL] : []),
            ...(context.includePlotOutline ? [PLOT_UPDATE_TOOL] : []),
          ]}
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
  model: string
  xaiKey: string
  slots: AdventureSlots
  sampling: SamplingParams
  context: ContextConfig
  onClose: () => void
  onSave: (
    systemPrompt: string,
    model: string,
    xaiKey: string,
    slots: AdventureSlots,
    sampling: SamplingParams,
    context: ContextConfig,
  ) => void
}

function SettingsPanel({
  systemPrompt,
  model,
  xaiKey,
  slots,
  sampling,
  context,
  onClose,
  onSave,
}: SettingsPanelProps) {
  const [draftSystem, setDraftSystem] = useState(systemPrompt)
  const [draftModel, setDraftModel] = useState(model)
  const [draftXaiKey, setDraftXaiKey] = useState(xaiKey)
  const [draftSlots, setDraftSlots] = useState<AdventureSlots>(() => ({ ...slots }))
  const [draftSampling, setDraftSampling] = useState<SamplingParams>(sampling)
  const [draftContext, setDraftContext] = useState<ContextConfig>(context)

  function setSlotField(key: SlotKey, value: string) {
    setDraftSlots((s) => ({ ...s, [key]: value }))
  }

  function setSamplingField<K extends keyof SamplingParams>(key: K, value: number) {
    setDraftSampling((s) => ({ ...s, [key]: value }))
  }

  function setContextField<K extends keyof ContextConfig>(key: K, value: ContextConfig[K]) {
    setDraftContext((c) => ({ ...c, [key]: value }))
  }

  function save() {
    const trimmed = {} as AdventureSlots
    for (const def of ADVENTURE_SLOTS) trimmed[def.key] = (draftSlots[def.key] ?? '').trim()
    onSave(
      draftSystem.trim(),
      draftModel.trim(),
      draftXaiKey.trim(),
      trimmed,
      draftSampling,
      draftContext,
    )
    onClose()
  }

  function resetDefaults() {
    setDraftSystem(DEFAULT_SYSTEM_PROMPT)
    setDraftModel(DEFAULT_MODEL)
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
          <span>xAI API key</span>
          <input
            type="password"
            value={draftXaiKey}
            onChange={(e) => setDraftXaiKey(e.target.value)}
            placeholder="xai-…"
            spellCheck={false}
            autoComplete="off"
          />
          <small className="hint">
            Stored in this browser&apos;s localStorage and sent directly to{' '}
            <code>api.x.ai</code> on each turn. Get one at{' '}
            <a href="https://console.x.ai/" target="_blank" rel="noreferrer">
              console.x.ai
            </a>
            .
          </small>
        </label>
        <label>
          <span>Model</span>
          <input
            type="text"
            value={draftModel}
            onChange={(e) => setDraftModel(e.target.value)}
            placeholder={DEFAULT_MODEL}
            list="dm-model-suggestions"
            spellCheck={false}
          />
          <datalist id="dm-model-suggestions">
            <option value="grok-4" />
            <option value="grok-4-fast" />
            <option value="grok-4-fast-reasoning" />
            <option value="grok-code-fast" />
          </datalist>
          <small className="hint">
            xAI model id sent to <code>/chat/completions</code>. Default:{' '}
            <code>{DEFAULT_MODEL}</code>. Applies on the next turn — reasoning variants
            skip temperature/penalty.
          </small>
        </label>
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

        <h3 className="saves-subhead">Experimental flags</h3>
        <div className="flag-list">
          <label className="flag-field">
            <input
              type="checkbox"
              checked={draftContext.includePriorPlayerTurns}
              onChange={(e) => setContextField('includePriorPlayerTurns', e.target.checked)}
            />
            <span>
              <strong>Include prior player turns in context</strong>
              <small>
                When off, only the current player message is sent; earlier player messages
                are dropped (their content already lives in the DM narration that followed).
                Saves tokens but loses the literal wording for reference. Default{' '}
                {DEFAULT_CONTEXT.includePriorPlayerTurns ? 'on' : 'off'}.
              </small>
            </span>
          </label>
          <label className="flag-field">
            <input
              type="checkbox"
              checked={draftContext.appendReminderToUser}
              onChange={(e) => setContextField('appendReminderToUser', e.target.checked)}
            />
            <span>
              <strong>Append turn reminder to last user message</strong>
              <small>
                When on, the turn reminder is folded into the latest player message as an
                OOC suffix so the wire ends with a <code>user</code> turn (standard
                alternation). When off, it trails as a separate <code>system</code> message
                after the player's input. Flip this if the model hallucinates
                &quot;Player input:&quot; style turns. Default{' '}
                {DEFAULT_CONTEXT.appendReminderToUser ? 'on' : 'off'}.
              </small>
            </span>
          </label>
          <label className="flag-field">
            <input
              type="checkbox"
              checked={draftContext.includeWorldState}
              onChange={(e) => setContextField('includeWorldState', e.target.checked)}
            />
            <span>
              <strong>Include world state</strong>
              <small>
                When off, the world-state system message is dropped AND the{' '}
                <code>update_state</code> tool is not advertised — the model can't read or
                write state. Useful for comparing prose quality with/without structured
                grounding. Default {DEFAULT_CONTEXT.includeWorldState ? 'on' : 'off'}.
              </small>
            </span>
          </label>
          <label className="flag-field">
            <input
              type="checkbox"
              checked={draftContext.includePlotOutline}
              onChange={(e) => setContextField('includePlotOutline', e.target.checked)}
            />
            <span>
              <strong>Include plot outline</strong>
              <small>
                When off, the plot-outline system message is dropped AND the{' '}
                <code>plot_update</code> tool is not advertised — the model steers without
                a running outline. Default{' '}
                {DEFAULT_CONTEXT.includePlotOutline ? 'on' : 'off'}.
              </small>
            </span>
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
  plot: string[]
  summary: string
  context: ContextConfig
  onClose: () => void
  onResetState: () => void
  onSaveState: (next: WorldState) => void
  onSavePlot: (next: string[]) => void
  onClearPlot: () => void
  onSaveSummary: (next: string) => void
  onClearSummary: () => void
}

function plotToDraft(plot: string[]): string {
  return plot.join('\n')
}

function parsePlotDraft(draft: string): string[] {
  return draft
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length > 0)
}

function StateViewer({
  state,
  plot,
  summary,
  context,
  onClose,
  onResetState,
  onSaveState,
  onSavePlot,
  onClearPlot,
  onSaveSummary,
  onClearSummary,
}: StateViewerProps) {
  const [draft, setDraft] = useState(() => JSON.stringify(state, null, 2))
  const [parseError, setParseError] = useState<string | null>(null)
  const [plotDraft, setPlotDraft] = useState(() => plotToDraft(plot))
  const [plotError, setPlotError] = useState<string | null>(null)
  const [summaryDraft, setSummaryDraft] = useState(summary)

  useEffect(() => {
    setDraft(JSON.stringify(state, null, 2))
    setParseError(null)
  }, [state])

  useEffect(() => {
    setPlotDraft(plotToDraft(plot))
    setPlotError(null)
  }, [plot])

  useEffect(() => {
    setSummaryDraft(summary)
  }, [summary])

  const currentJson = JSON.stringify(state, null, 2)
  const stateDirty = draft !== currentJson
  const plotDirty = plotDraft !== plotToDraft(plot)
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

  function handleSavePlot() {
    const parsed = parsePlotDraft(plotDraft)
    if (parsed.length > MAX_PLOT_ITEMS) {
      setPlotError(`Too many bullets (${parsed.length}, max ${MAX_PLOT_ITEMS}).`)
      return
    }
    const tooLong = parsed.find((s) => s.length > MAX_PLOT_ITEM_CHARS)
    if (tooLong) {
      setPlotError(`A bullet is too long (${tooLong.length} chars, max ${MAX_PLOT_ITEM_CHARS}).`)
      return
    }
    setPlotError(null)
    onSavePlot(parsed)
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

        <h2>Plot outline</h2>
        <p className="hint">
          The DM maintains this bullet list via a <code>plot_update</code> tool — a short
          private notebook of directions the story is aiming at. One bullet per line;
          leading <code>-</code> or <code>*</code> is stripped on save. Max {MAX_PLOT_ITEMS}{' '}
          bullets, each up to {MAX_PLOT_ITEM_CHARS} chars. Current: {plot.length} bullet
          {plot.length === 1 ? '' : 's'}.
        </p>
        <textarea
          className="state-json state-json-editor"
          spellCheck={false}
          value={plotDraft}
          onChange={(e) => setPlotDraft(e.target.value)}
          placeholder="(no plot outline yet — one bullet per line)"
        />
        {plotError && <p className="error-text">{plotError}</p>}

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
              if (plot.length && confirm('Clear the plot outline?')) onClearPlot()
            }}
            disabled={plot.length === 0}
          >
            Clear plot
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
          <button onClick={handleSavePlot} disabled={!plotDirty}>
            Save plot
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

function formatToolArgs(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return trimmed
  }
}

interface TraceViewProps {
  trace: TraceEvent[]
  expanded: boolean
  onToggle: () => void
}

function TraceView({ trace, expanded, onToggle }: TraceViewProps) {
  const calls = trace.filter((e) => e.kind === 'call').length
  const thoughts = trace.filter((e) => e.kind === 'thought').length
  const parts: string[] = []
  if (calls) parts.push(`${calls} tool call${calls === 1 ? '' : 's'}`)
  if (thoughts) parts.push(`${thoughts} note${thoughts === 1 ? '' : 's'}`)
  const label = parts.join(' · ') || 'no tools'
  return (
    <div className="trace">
      <button
        className="trace-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
        title="Show tool calls and interstitial thoughts from this turn"
      >
        {expanded ? '▾' : '▸'} trace ({label})
      </button>
      {expanded && (
        <div className="trace-pane">
          {trace.length === 0 ? (
            <div className="trace-event trace-empty">
              <span className="trace-label">no tools called this turn</span>
            </div>
          ) : (
            trace.map((e, i) =>
              e.kind === 'thought' ? (
                <div key={i} className="trace-event trace-thought">
                  <span className="trace-label">thought</span>
                  <p>{e.text}</p>
                </div>
              ) : (
                <div key={i} className="trace-event trace-call">
                  <div className="trace-call-head">
                    <span className="trace-label">call</span>
                    <code className="trace-call-name">{e.name}</code>
                  </div>
                  <pre className="state-json trace-args">{formatToolArgs(e.arguments) || '(no args)'}</pre>
                  <div className="trace-result">{e.result}</div>
                </div>
              ),
            )
          )}
        </div>
      )}
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
      `Update the world state JSON in one batched call. Provide \`set\` (a map of dotted-path → value to assign), \`delete\` (an array of dotted paths to remove), or both. Deletes apply first, then sets — so a path that appears in both ends up with the set value. Intermediate objects on a set path are auto-created. Example: {set:{"scene.location":"the docks","npcs.jack.attitude":"possessive"}, delete:["npcs.oldGuard","topics.resolved"]}. HARD LIMIT: any individual string value (including nested strings) must be <= ${MAX_STATE_STRING_CHARS} characters; an over-long value is rejected and the existing value at that path is left unchanged. Keep entries terse; split long descriptions into multiple short keys.`,
    parameters: {
      type: 'object',
      properties: {
        set: {
          type: 'object',
          description: `Map of dotted paths to values to assign, e.g. {"npcs.jack.attitude":"possessive","scene.mood":"tense"}. Any JSON value type. String values must be <= ${MAX_STATE_STRING_CHARS} chars (including nested strings).`,
          additionalProperties: true,
        },
        delete: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of dotted paths to remove. Applied before sets.',
        },
      },
    },
  },
}

const PLOT_UPDATE_TOOL = {
  type: 'function',
  function: {
    name: 'plot_update',
    description:
      `Replace the full plot outline. Pass the new list; it overwrites the old entirely. Pass [] to clear. Max ${MAX_PLOT_ITEMS} bullets, each <= ${MAX_PLOT_ITEM_CHARS} chars. A bullet over the char limit or a list over the item limit rejects the whole call and leaves the existing outline unchanged.`,
    parameters: {
      type: 'object',
      properties: {
        plot: {
          type: 'array',
          items: { type: 'string' },
          description: `New full plot list. Each bullet <= ${MAX_PLOT_ITEM_CHARS} chars; at most ${MAX_PLOT_ITEMS} items. Empty array clears the outline.`,
        },
      },
      required: ['plot'],
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

function buildPlotSystemMessage(currentPlot: string[]): ApiMessage {
  const bullets = currentPlot.length
    ? currentPlot.map((p) => `- ${p}`).join('\n')
    : '(no plot outline yet — call plot_update to set one when the story gives you enough to aim at)'
  return {
    role: 'system',
    content: `${PLOT_RULES}\n\n## Current plot outline\n\n${bullets}`,
  }
}

function buildApiMessagesIndexed(
  systemPrompt: string,
  slots: AdventureSlots,
  summary: string,
  history: Message[],
  currentState: WorldState,
  currentPlot: string[],
  stateCleanupThreshold: number,
  includePriorPlayerTurns: boolean,
  includeWorldState: boolean,
  includePlotOutline: boolean,
): { messages: ApiMessage[]; stateIndex: number; plotIndex: number } {
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
  let stateIndex = -1
  if (includeWorldState) {
    stateIndex = messages.length
    messages.push(buildStateSystemMessage(currentState, stateCleanupThreshold))
  }
  let plotIndex = -1
  if (includePlotOutline) {
    plotIndex = messages.length
    messages.push(buildPlotSystemMessage(currentPlot))
  }
  const effectiveHistory = includePriorPlayerTurns
    ? history
    : history.filter((m, i) => m.role === 'dm' || i === history.length - 1)
  for (const m of effectiveHistory) {
    messages.push({ role: m.role === 'dm' ? 'assistant' : 'user', content: m.text })
  }
  return { messages, stateIndex, plotIndex }
}

function buildApiMessages(
  systemPrompt: string,
  slots: AdventureSlots,
  summary: string,
  history: Message[],
  currentState: WorldState,
  currentPlot: string[],
  stateCleanupThreshold: number,
  includePriorPlayerTurns: boolean,
  includeWorldState: boolean,
  includePlotOutline: boolean,
): ApiMessage[] {
  return buildApiMessagesIndexed(
    systemPrompt,
    slots,
    summary,
    history,
    currentState,
    currentPlot,
    stateCleanupThreshold,
    includePriorPlayerTurns,
    includeWorldState,
    includePlotOutline,
  ).messages
}

async function xaiChat(
  body: unknown,
  apiKey: string,
  signal: AbortSignal,
): Promise<Response> {
  if (!apiKey) {
    throw new Error('xAI API key not set. Open Settings and paste your key.')
  }
  return fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })
}

async function compactHistory(
  systemPrompt: string,
  model: string,
  apiKey: string,
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

  const closing =
    `Now write the ${hasNew ? 'unified' : 're-compressed'} retelling in proper grammatical English. ` +
    `Everything between the BEGIN/END markers above is RAW INPUT MATERIAL to digest — NOT a style template. ` +
    `Your output is polished narrative prose: complete sentences, all articles and auxiliaries in place, decreasing resolution as it recedes into the past. ` +
    `Do NOT echo the register, telegraphic phrasing, or fragmentary style of the input regardless of how rough it reads.`

  const userContent = hasNew
    ? `DM system prompt (rules the narrator follows):\n\n${systemPrompt}\n\n` +
      `${slotsBlock}\n\n` +
      (priorSummary
        ? `--- BEGIN EXISTING RETELLING (raw input — merge in and re-tell more tightly) ---\n\n${priorSummary}\n\n--- END EXISTING RETELLING ---\n\n`
        : '') +
      `--- BEGIN CHRONICLE (raw transcript to fold in, in order) ---\n\n${chronicle}\n\n--- END CHRONICLE ---\n\n` +
      closing
    : `DM system prompt (rules the narrator follows):\n\n${systemPrompt}\n\n` +
      `${slotsBlock}\n\n` +
      `No new chronicle this pass — re-tell the existing retelling more tightly so the result fits within target length. Be selective: keep only what still matters for the plot going forward; drop or collapse anything stale, atmospheric, or already overtaken by events. Older sections in particular should collapse hard.\n\n` +
      `--- BEGIN EXISTING RETELLING (raw input — re-compress) ---\n\n${priorSummary}\n\n--- END EXISTING RETELLING ---\n\n` +
      closing

  const apiMessages: ApiMessage[] = [
    { role: 'system', content: buildSummarizerPrompt(summaryTargetChars) },
    { role: 'user', content: userContent },
  ]

  const res = await xaiChat(
    {
      model,
      messages: apiMessages,
      stream: false,
    },
    apiKey,
    signal,
  )

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

function applyTurnReminder(messages: ApiMessage[], appendToUser: boolean): ApiMessage[] {
  if (!appendToUser) {
    return [...messages, { role: 'system', content: TURN_REMINDER }]
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      const copy = messages.slice()
      const existing = copy[i].content
      copy[i] = {
        ...copy[i],
        content: `${existing}\n\n(OOC: ${TURN_REMINDER})`,
      }
      return copy
    }
  }
  return [...messages, { role: 'system', content: TURN_REMINDER }]
}

function modelSupportsSampling(model: string): boolean {
  // Reasoning models (e.g. grok-4-1-fast-reasoning) reject temperature and penalty params.
  return !/reasoning/i.test(model)
}

interface ToolExecResult {
  state: WorldState
  plot: string[]
  result: string
}

function executeTool(
  name: string,
  rawArgs: string,
  state: WorldState,
  plot: string[],
): ToolExecResult {
  if (name === 'update_state') {
    try {
      const args = JSON.parse(rawArgs) as {
        set?: Record<string, JsonValue>
        delete?: string[]
      }
      const setEntries: [string, JsonValue][] =
        args.set && typeof args.set === 'object' && !Array.isArray(args.set)
          ? Object.entries(args.set).filter(
              (e): e is [string, JsonValue] => typeof e[0] === 'string' && e[0].length > 0,
            )
          : []
      const deletePaths = Array.isArray(args.delete)
        ? args.delete.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : []
      if (setEntries.length === 0 && deletePaths.length === 0) {
        return {
          state,
          plot,
          result:
            'error: update_state requires a non-empty `set` map, a non-empty `delete` array, or both.',
        }
      }
      const notes: string[] = []
      let failed = false
      let nextState = state
      for (const p of deletePaths) {
        nextState = deleteByPath(nextState, p)
        notes.push(`deleted ${p}`)
      }
      for (const [path, value] of setEntries) {
        const overLong = findOverLongString(value, MAX_STATE_STRING_CHARS)
        if (overLong !== null) {
          notes.push(
            `REJECTED set ${path}: string value too long (${overLong} chars, max ${MAX_STATE_STRING_CHARS}). Existing value unchanged. Rewrite shorter.`,
          )
          failed = true
        } else {
          nextState = setByPath(nextState, path, value)
          notes.push(`set ${path}`)
        }
      }
      return { state: nextState, plot, result: `${failed ? 'partial' : 'ok'} — ${notes.join('; ')}` }
    } catch (err) {
      return { state, plot, result: `error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  if (name === 'plot_update') {
    try {
      const args = JSON.parse(rawArgs) as { plot?: unknown }
      if (!Array.isArray(args.plot)) {
        return {
          state,
          plot,
          result: 'error: plot_update requires `plot` as an array of strings. Existing outline unchanged.',
        }
      }
      if (args.plot.some((p) => typeof p !== 'string')) {
        return {
          state,
          plot,
          result: 'error: every plot bullet must be a string. Existing outline unchanged.',
        }
      }
      if (args.plot.length > MAX_PLOT_ITEMS) {
        return {
          state,
          plot,
          result: `error: plot has ${args.plot.length} items (max ${MAX_PLOT_ITEMS}). Trim the list and retry. Existing outline unchanged.`,
        }
      }
      const cleaned = (args.plot as string[]).map((s) => s.trim()).filter((s) => s.length > 0)
      const tooLong = cleaned.find((s) => s.length > MAX_PLOT_ITEM_CHARS)
      if (tooLong) {
        return {
          state,
          plot,
          result: `error: plot bullet too long (${tooLong.length} chars, max ${MAX_PLOT_ITEM_CHARS}). Rewrite shorter. Existing outline unchanged.`,
        }
      }
      return {
        state,
        plot: cleaned,
        result: `ok — plot outline now has ${cleaned.length} bullet${cleaned.length === 1 ? '' : 's'}.`,
      }
    } catch (err) {
      return { state, plot, result: `error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  return { state, plot, result: `error: unknown tool ${name}` }
}

const INLINE_TOOL_CALL_PATTERN =
  /<function_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/function_call>/gi

interface InlineToolCall {
  name: string
  arguments: string
}

function parseInlineToolCalls(content: string): { cleaned: string; calls: InlineToolCall[] } {
  const calls: InlineToolCall[] = []
  const cleaned = content
    .replace(INLINE_TOOL_CALL_PATTERN, (_match, name: string, body: string) => {
      calls.push({ name, arguments: body.trim() })
      return ''
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { cleaned, calls }
}

async function askDungeonMaster(
  systemPrompt: string,
  model: string,
  apiKey: string,
  slots: AdventureSlots,
  summary: string,
  history: Message[],
  initialState: WorldState,
  initialPlot: string[],
  sampling: SamplingParams,
  stateCleanupThreshold: number,
  includePriorPlayerTurns: boolean,
  appendReminderToUser: boolean,
  includeWorldState: boolean,
  includePlotOutline: boolean,
  signal: AbortSignal,
): Promise<{ text: string; state: WorldState; plot: string[]; trace: TraceEvent[] }> {
  let currentState = initialState
  let currentPlot = initialPlot
  const { messages: apiMessages, stateIndex, plotIndex } = buildApiMessagesIndexed(
    systemPrompt,
    slots,
    summary,
    history,
    currentState,
    currentPlot,
    stateCleanupThreshold,
    includePriorPlayerTurns,
    includeWorldState,
    includePlotOutline,
  )
  const tools: unknown[] = []
  if (includeWorldState) tools.push(UPDATE_STATE_TOOL)
  if (includePlotOutline) tools.push(PLOT_UPDATE_TOOL)

  const trace: TraceEvent[] = []
  const pushToolResult = (call: ToolCall, content: string) => {
    apiMessages.push({ role: 'tool', tool_call_id: call.id, content })
    trace.push({
      kind: 'call',
      name: call.function?.name ?? '(unknown)',
      arguments: call.function?.arguments ?? '',
      result: content,
    })
  }

  let nudged = false
  for (let iter = 0; iter < 8; iter++) {
    const body: Record<string, unknown> = {
      model,
      messages: applyTurnReminder(apiMessages, appendReminderToUser),
      stream: false,
    }
    if (tools.length) body.tools = tools
    if (modelSupportsSampling(model)) {
      body.temperature = sampling.temperature
      body.frequency_penalty = sampling.frequencyPenalty
      body.presence_penalty = sampling.presencePenalty
    }
    console.debug('[dm] xAI request', { iter, model, toolCount: (body.tools as unknown[])?.length, body })
    const res = await xaiChat(body, apiKey, signal)

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`xAI ${res.status}: ${body.slice(0, 200) || res.statusText}`)
    }

    const rawData = (await res.json()) as unknown
    console.debug('[dm] xAI response', { iter, rawData })
    const data = rawData as {
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
      const interstitial = msg.content?.trim()
      if (interstitial) trace.push({ kind: 'thought', text: interstitial })
      apiMessages.push({
        role: 'assistant',
        content: msg.content ?? '',
        tool_calls: msg.tool_calls,
      })
      for (const call of msg.tool_calls) {
        const name = call.function?.name ?? '(anonymous)'
        const rawArgs = call.function?.arguments ?? ''
        const exec = executeTool(name, rawArgs, currentState, currentPlot)
        currentState = exec.state
        currentPlot = exec.plot
        pushToolResult(call, exec.result)
      }
      if (stateIndex >= 0) {
        apiMessages[stateIndex] = buildStateSystemMessage(currentState, stateCleanupThreshold)
      }
      if (plotIndex >= 0) {
        apiMessages[plotIndex] = buildPlotSystemMessage(currentPlot)
      }
      continue
    }

    const content = msg.content?.trim() ?? ''
    const { cleaned, calls: inlineCalls } = parseInlineToolCalls(content)
    if (inlineCalls.length) {
      console.warn('[dm] extracted inline tool calls from narrative', {
        count: inlineCalls.length,
        names: inlineCalls.map((c) => c.name),
      })
      apiMessages.push({
        role: 'assistant',
        content,
      })
      for (const call of inlineCalls) {
        const exec = executeTool(call.name, call.arguments, currentState, currentPlot)
        currentState = exec.state
        currentPlot = exec.plot
        trace.push({
          kind: 'call',
          name: `${call.name} (inline)`,
          arguments: call.arguments,
          result: exec.result,
        })
      }
      if (stateIndex >= 0) {
        apiMessages[stateIndex] = buildStateSystemMessage(currentState, stateCleanupThreshold)
      }
      if (plotIndex >= 0) {
        apiMessages[plotIndex] = buildPlotSystemMessage(currentPlot)
      }
      if (cleaned) return { text: cleaned, state: currentState, plot: currentPlot, trace }
      if (!nudged) {
        nudged = true
        apiMessages.push({
          role: 'user',
          content:
            '(OOC: Inline tool calls extracted. Use the structured tool API next time. Now provide the narrative reply — 2-4 short paragraphs, no XML tags.)',
        })
        continue
      }
      throw new Error('Narrative reply was entirely inline tool calls with no remaining prose')
    }
    if (content) return { text: content, state: currentState, plot: currentPlot, trace }

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
