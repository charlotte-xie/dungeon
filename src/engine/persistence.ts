// All localStorage IO + save-file shape detection / migration. The React tree
// sees only loadStored*/persist* functions and the SavedGame type.

import { ADVENTURE_SLOTS, DEFAULT_CONTEXT, DEFAULT_MEMORY, DEFAULT_SAMPLING, DEFAULT_STATE, defaultSlots } from './config'
import type { ReasoningEffort } from './model/types'
import type {
  AdventureSlots,
  Chronicle,
  ChronicleEntry,
  ContextConfig,
  JsonValue,
  Memory,
  MessageV1,
  ModelCall,
  SamplingParams,
  SavedGame,
  SavedGameV1,
  SavedGameV2,
  Turn,
  TurnRecovery,
  WorldSnapshot,
  WorldState,
} from './types'

export const LS_MODEL = 'dm.model'
// Keep the legacy storage key so existing users retain their configured key.
export const LS_API_KEY = 'dm.xaiKey'
export const LS_BASE_URL = 'dm.baseUrl'
export const LS_STATE = 'dm.state'
export const LS_PLOT = 'dm.plot'
export const LS_MEMORY = 'dm.memory'
export const LS_OOC = 'dm.ooc'
export const LS_CHRONICLE = 'dm.chronicle'

const LS_SUMMARY_V2 = 'dm.summary'
export const LS_TURNS = 'dm.turns'
export const LS_SAMPLING = 'dm.sampling'
export const LS_CONTEXT = 'dm.context'
export const LS_COMPACT_CUTOFF = 'dm.compactCutoff'
export const LS_SAVES = 'dm.saves'
export const LS_SHOW_TRACE = 'dm.showTrace'
export const LS_RECOVERY = 'dm.recovery'
export const LS_OOC_BASELINE = 'dm.oocBaseline'

const LS_MESSAGES_V1 = 'dm.messages'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true
  }
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function isWorldStateLike(value: unknown): value is WorldState {
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

// Memory entries are free JSON — legacy string entries and the faceted
// object shape are both valid as-is.
function isMemoryLike(value: unknown): value is Memory {
  return isRecord(value) && Object.values(value).every(isJsonValue)
}

function isTraceLike(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.every((event) => {
    if (!isRecord(event) || typeof event.kind !== 'string') return false
    if (event.kind === 'thought' || event.kind === 'reasoning') {
      return typeof event.text === 'string'
    }
    if (event.kind === 'usage') {
      return (
        typeof event.label === 'string' &&
        (event.promptTokens === undefined || typeof event.promptTokens === 'number') &&
        (event.cachedTokens === undefined || typeof event.cachedTokens === 'number') &&
        (event.durationMs === undefined || typeof event.durationMs === 'number')
      )
    }
    return (
      event.kind === 'call' &&
      typeof event.name === 'string' &&
      typeof event.arguments === 'string' &&
      typeof event.result === 'string'
    )
  })
}

function isModelCallLike(value: unknown): value is ModelCall {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.model === 'string' &&
    (value.text === undefined || typeof value.text === 'string') &&
    (value.trace === undefined || isTraceLike(value.trace)) &&
    (value.reasoningTokens === undefined ||
      (typeof value.reasoningTokens === 'number' && Number.isFinite(value.reasoningTokens))) &&
    (value.durationMs === undefined ||
      (typeof value.durationMs === 'number' && Number.isFinite(value.durationMs))) &&
    (value.error === undefined || typeof value.error === 'string') &&
    (value.stopped === undefined || typeof value.stopped === 'boolean')
  )
}

export function isTurnLike(value: unknown): value is Turn {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    (value.kind === 'bootstrap' || value.kind === 'player' || value.kind === 'continue') &&
    (value.input === undefined || typeof value.input === 'string') &&
    (value.narrator === undefined || isModelCallLike(value.narrator)) &&
    isModelCallLike(value.reply)
  )
}

function isMessageV1Like(value: unknown): value is MessageV1 {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    (value.role === 'dm' || value.role === 'player') &&
    typeof value.text === 'string' &&
    (value.trace === undefined || isTraceLike(value.trace))
  )
}

function isChronicleLike(value: unknown): value is Chronicle {
  return (
    Array.isArray(value) &&
    value.every(
      (level) =>
        Array.isArray(level) &&
        level.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.id === 'string' &&
            typeof entry.text === 'string' &&
            typeof entry.turnsCovered === 'number' &&
            Number.isFinite(entry.turnsCovered) &&
            entry.turnsCovered >= 0 &&
            typeof entry.createdAt === 'number' &&
            Number.isFinite(entry.createdAt),
        ),
    )
  )
}

function clampCutoff(value: number, turnCount: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(turnCount, Math.max(0, Math.floor(value)))
}

export function loadStored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function loadStoredSlots(): AdventureSlots {
  const out = {} as AdventureSlots
  for (const def of ADVENTURE_SLOTS) {
    out[def.key] = loadStored(def.storageKey, def.defaultValue)
  }
  return out
}

export function persistSlots(slots: AdventureSlots) {
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

export function loadStoredState(): WorldState {
  try {
    const raw = localStorage.getItem(LS_STATE)
    if (!raw) return structuredClone(DEFAULT_STATE)
    const parsed = JSON.parse(raw) as unknown
    return isWorldStateLike(parsed) ? parsed : structuredClone(DEFAULT_STATE)
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

export function persistState(state: WorldState) {
  try {
    localStorage.setItem(LS_STATE, JSON.stringify(state))
  } catch {
    // ignore quota / disabled storage
  }
}

export function loadStoredPlot(): string[] {
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

export function persistPlot(plot: string[]) {
  try {
    if (plot.length) localStorage.setItem(LS_PLOT, JSON.stringify(plot))
    else localStorage.removeItem(LS_PLOT)
  } catch {
    // ignore quota / disabled storage
  }
}

export function loadStoredOoc(): string[] {
  try {
    const raw = localStorage.getItem(LS_OOC)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p): p is string => typeof p === 'string')
  } catch {
    return []
  }
}

export function persistOoc(ooc: string[]) {
  try {
    if (ooc.length) localStorage.setItem(LS_OOC, JSON.stringify(ooc))
    else localStorage.removeItem(LS_OOC)
  } catch {
    // ignore quota / disabled storage
  }
}

export function loadStoredMemory(): Memory {
  try {
    const raw = localStorage.getItem(LS_MEMORY)
    if (!raw) return structuredClone(DEFAULT_MEMORY)
    const parsed = JSON.parse(raw) as unknown
    if (!isMemoryLike(parsed)) {
      return structuredClone(DEFAULT_MEMORY)
    }
    return parsed
  } catch {
    return structuredClone(DEFAULT_MEMORY)
  }
}

export function persistMemory(memory: Memory) {
  try {
    if (Object.keys(memory).length > 0) {
      localStorage.setItem(LS_MEMORY, JSON.stringify(memory))
    } else {
      localStorage.removeItem(LS_MEMORY)
    }
  } catch {
    // ignore quota / disabled storage
  }
}

function loadStoredCompactCutoffRaw(): number {
  try {
    const raw = localStorage.getItem(LS_COMPACT_CUTOFF)
    if (!raw) return 0
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

export function loadStoredTurnsAndCutoff(): { turns: Turn[]; cutoff: number } {
  try {
    const raw = localStorage.getItem(LS_TURNS)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.every(isTurnLike)) {
        return {
          turns: parsed,
          cutoff: clampCutoff(loadStoredCompactCutoffRaw(), parsed.length),
        }
      }
    }
  } catch {
    // fall through to v1 migration
  }
  // One-time migration from v1 LS_MESSAGES.
  try {
    const raw = localStorage.getItem(LS_MESSAGES_V1)
    if (!raw) return { turns: [], cutoff: 0 }
    const parsed = JSON.parse(raw) as MessageV1[]
    if (!Array.isArray(parsed)) return { turns: [], cutoff: 0 }
    const v1Cutoff = loadStoredCompactCutoffRaw()
    const migrated = migrateV1MessagesToTurns(parsed, v1Cutoff)
    try {
      localStorage.setItem(LS_TURNS, JSON.stringify(migrated.turns))
      if (migrated.cutoff > 0) {
        localStorage.setItem(LS_COMPACT_CUTOFF, String(migrated.cutoff))
      } else {
        localStorage.removeItem(LS_COMPACT_CUTOFF)
      }
      localStorage.removeItem(LS_MESSAGES_V1)
    } catch {
      // best-effort; in-memory migration still applies for this session
    }
    return migrated
  } catch {
    return { turns: [], cutoff: 0 }
  }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function isWorldSnapshotLike(value: unknown): value is WorldSnapshot {
  return (
    isRecord(value) &&
    isWorldStateLike(value.state) &&
    isStringList(value.plot) &&
    isMemoryLike(value.memory) &&
    isStringList(value.ooc) &&
    isChronicleLike(value.chronicle) &&
    typeof value.compactCutoff === 'number' &&
    Number.isInteger(value.compactCutoff) &&
    value.compactCutoff >= 0
  )
}

// Known slot keys only, as strings; anything missing takes its default.
function slotsFrom(value: Record<string, unknown>): AdventureSlots {
  const slots = defaultSlots()
  for (const def of ADVENTURE_SLOTS) {
    const entry = value[def.key]
    if (typeof entry === 'string') slots[def.key] = entry
  }
  return slots
}

function beforeFrom(value: unknown): TurnRecovery['before'] {
  if (
    !isRecord(value) ||
    typeof value.turnId !== 'string' ||
    !isWorldSnapshotLike(value.world) ||
    !isRecord(value.slots)
  ) {
    return null
  }
  return { turnId: value.turnId, world: value.world, slots: slotsFrom(value.slots) }
}

function undoneFrom(value: unknown): TurnRecovery['undone'] {
  if (
    !isRecord(value) ||
    (value.afterId !== null && typeof value.afterId !== 'string') ||
    !isTurnLike(value.turn) ||
    !isWorldSnapshotLike(value.world)
  ) {
    return null
  }
  return { afterId: value.afterId, turn: value.turn, world: value.world }
}

// Undo, Retry and Redo for the stored log. Shape-checked here; the controller
// then keeps only what still fits the log.
export function loadStoredRecovery(): TurnRecovery {
  try {
    const raw = localStorage.getItem(LS_RECOVERY)
    if (!raw) return { before: null, undone: null }
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return { before: null, undone: null }
    return { before: beforeFrom(parsed.before), undone: undoneFrom(parsed.undone) }
  } catch {
    return { before: null, undone: null }
  }
}

export function persistRecovery(recovery: TurnRecovery) {
  try {
    if (recovery.before || recovery.undone) {
      localStorage.setItem(LS_RECOVERY, JSON.stringify(recovery))
    } else {
      localStorage.removeItem(LS_RECOVERY)
    }
  } catch {
    // Storage full or disabled: drop the old record rather than keep a stale
    // one. Undo and Retry then last until the next reload, as before.
    try {
      localStorage.removeItem(LS_RECOVERY)
    } catch {
      // ignore
    }
  }
}

// The OOC list as the engine last set it. Null when never stored, so the
// caller falls back to the stored OOC list.
export function loadStoredOocBaseline(): string[] | null {
  try {
    const raw = localStorage.getItem(LS_OOC_BASELINE)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    return isStringList(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function persistOocBaseline(ooc: string[]) {
  try {
    localStorage.setItem(LS_OOC_BASELINE, JSON.stringify(ooc))
  } catch {
    // ignore quota / disabled storage
  }
}

export function loadStoredSampling(): SamplingParams {
  try {
    const raw = localStorage.getItem(LS_SAMPLING)
    if (!raw) return { ...DEFAULT_SAMPLING }
    const parsed = JSON.parse(raw) as Partial<SamplingParams>
    return { ...DEFAULT_SAMPLING, ...parsed }
  } catch {
    return { ...DEFAULT_SAMPLING }
  }
}

export function loadStoredContext(): ContextConfig {
  try {
    const raw = localStorage.getItem(LS_CONTEXT)
    if (!raw) return { ...DEFAULT_CONTEXT }
    const parsed = JSON.parse(raw) as Partial<ContextConfig>
    // Migration: configs saved before the watermark redesign carry no
    // compactionFloor, and their stored threshold of 8 is the old shipped
    // default (fold every 4 turns), not a deliberate choice. Upgrade those
    // to the current rare-compaction defaults; any other stored threshold
    // is treated as intentional and kept.
    if (typeof parsed.compactionFloor !== 'number' && parsed.compactionThreshold === 8) {
      parsed.compactionThreshold = DEFAULT_CONTEXT.compactionThreshold
    }
    return {
      // Preserve legacy routing, including local and non-xAI installations.
      narratorReasoning: storedReasoning(parsed.narratorReasoning),
      plotterModel: typeof parsed.plotterModel === 'string' ? parsed.plotterModel.trim() : '',
      plotterReasoning: storedReasoning(parsed.plotterReasoning),
      summarizerModel: typeof parsed.summarizerModel === 'string' ? parsed.summarizerModel.trim() : '',
      summarizerReasoning: storedReasoning(parsed.summarizerReasoning),
      compactionThreshold:
        typeof parsed.compactionThreshold === 'number'
          ? parsed.compactionThreshold
          : DEFAULT_CONTEXT.compactionThreshold,
      compactionFloor:
        typeof parsed.compactionFloor === 'number'
          ? parsed.compactionFloor
          : DEFAULT_CONTEXT.compactionFloor,
      compactionBatch:
        typeof parsed.compactionBatch === 'number'
          ? parsed.compactionBatch
          : DEFAULT_CONTEXT.compactionBatch,
      stateCleanupChars:
        typeof parsed.stateCleanupChars === 'number'
          ? parsed.stateCleanupChars
          : DEFAULT_CONTEXT.stateCleanupChars,
      includePriorPlayerTurns:
        typeof parsed.includePriorPlayerTurns === 'boolean'
          ? parsed.includePriorPlayerTurns
          : DEFAULT_CONTEXT.includePriorPlayerTurns,
      reminderAsSystem:
        typeof parsed.reminderAsSystem === 'boolean'
          ? parsed.reminderAsSystem
          : DEFAULT_CONTEXT.reminderAsSystem,
      includeWorldState:
        typeof parsed.includeWorldState === 'boolean'
          ? parsed.includeWorldState
          : DEFAULT_CONTEXT.includeWorldState,
      includePlotOutline:
        typeof parsed.includePlotOutline === 'boolean'
          ? parsed.includePlotOutline
          : DEFAULT_CONTEXT.includePlotOutline,
      includeMemory:
        typeof parsed.includeMemory === 'boolean'
          ? parsed.includeMemory
          : DEFAULT_CONTEXT.includeMemory,
      includeOoc:
        typeof parsed.includeOoc === 'boolean'
          ? parsed.includeOoc
          : DEFAULT_CONTEXT.includeOoc,
      useReviser:
        typeof parsed.useReviser === 'boolean'
          ? parsed.useReviser
          : DEFAULT_CONTEXT.useReviser,
      reviserModel:
        typeof parsed.reviserModel === 'string' && parsed.reviserModel.trim()
          ? parsed.reviserModel
          : DEFAULT_CONTEXT.reviserModel,
      apiProtocol:
        parsed.apiProtocol === 'responses' || parsed.apiProtocol === 'chat-completions'
          ? parsed.apiProtocol
          : 'chat-completions',
      nsfw:
        typeof parsed.nsfw === 'boolean'
          ? parsed.nsfw
          : DEFAULT_CONTEXT.nsfw,
    }
  } catch {
    return { ...DEFAULT_CONTEXT }
  }
}

function storedReasoning(value: unknown): ReasoningEffort {
  return value === 'none' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
    ? value
    : 'default'
}

export function summaryToChronicle(summary: string, cutoff: number): Chronicle {
  if (!summary) return []
  const entry: ChronicleEntry = {
    id: crypto.randomUUID(),
    text: summary,
    turnsCovered: Math.max(0, cutoff),
    createdAt: Date.now(),
  }
  return [[entry]]
}

export function loadStoredChronicle(): Chronicle {
  try {
    const raw = localStorage.getItem(LS_CHRONICLE)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (isChronicleLike(parsed)) {
        return parsed
      }
    }
  } catch {
    // fall through to v2 migration
  }
  // Migrate from v2 flat summary stored under dm.summary.
  try {
    const v2 = localStorage.getItem(LS_SUMMARY_V2)
    if (!v2) return []
    const cutoffRaw = localStorage.getItem(LS_COMPACT_CUTOFF)
    const cutoff = cutoffRaw ? Math.max(0, Math.floor(Number(cutoffRaw))) : 0
    const migrated = summaryToChronicle(v2, cutoff)
    try {
      localStorage.setItem(LS_CHRONICLE, JSON.stringify(migrated))
      localStorage.removeItem(LS_SUMMARY_V2)
    } catch {
      // best-effort
    }
    return migrated
  } catch {
    return []
  }
}

export function persistChronicle(chronicle: Chronicle) {
  try {
    if (chronicle.length > 0) {
      localStorage.setItem(LS_CHRONICLE, JSON.stringify(chronicle))
    } else {
      localStorage.removeItem(LS_CHRONICLE)
    }
  } catch {
    // ignore quota / disabled storage
  }
}

export function loadStoredSaves(): SavedGame[] {
  try {
    const raw = localStorage.getItem(LS_SAVES)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isSavedGameLike).map(normalizeSavedGame)
  } catch {
    return []
  }
}

export function persistSaves(saves: SavedGame[]) {
  try {
    localStorage.setItem(LS_SAVES, JSON.stringify(saves))
  } catch {
    // ignore quota / disabled storage
  }
}

export function makeSaveId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function isSavedGameLike(
  v: unknown,
): v is SavedGame | SavedGameV1 | SavedGameV2 {
  if (!isRecord(v)) return false
  const s = v
  const hasNewSlots =
    isRecord(s.slots) &&
    Object.entries(s.slots).every(
      ([key, value]) =>
        (key !== 'scenario' && key !== 'styleGuide') || typeof value === 'string',
    )
  const hasOldScenario = typeof s.scenario === 'string'
  const hasTurnsOrMessages =
    (Array.isArray(s.turns) && s.turns.every(isTurnLike)) ||
    (Array.isArray(s.messages) && s.messages.every(isMessageV1Like))
  const hasChronicleOrSummary =
    isChronicleLike(s.chronicle) || typeof s.summary === 'string'
  const plotValid =
    s.plot === undefined ||
    (Array.isArray(s.plot) && s.plot.every((entry) => typeof entry === 'string'))
  const memoryValid = s.memory === undefined || isMemoryLike(s.memory)
  const oocValid =
    s.ooc === undefined ||
    (Array.isArray(s.ooc) && s.ooc.every((entry) => typeof entry === 'string'))
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.savedAt === 'number' && Number.isFinite(s.savedAt) &&
    (hasNewSlots || hasOldScenario) &&
    hasChronicleOrSummary &&
    typeof s.compactCutoff === 'number' && Number.isFinite(s.compactCutoff) &&
    hasTurnsOrMessages &&
    isWorldStateLike(s.state) &&
    plotValid &&
    memoryValid &&
    oocValid
  )
}

export function migrateV1MessagesToTurns(
  messages: MessageV1[],
  v1Cutoff: number,
): { turns: Turn[]; cutoff: number } {
  const turns: Turn[] = []
  let pendingInput: string | undefined
  let cutoff = 0
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const nextV1Index = i + 1
    if (m.role === 'player') {
      pendingInput = m.text
      continue
    }
    const reply: ModelCall = {
      id: m.id,
      model: '',
      text: m.text,
      trace: m.trace,
    }
    let turn: Turn
    if (pendingInput !== undefined) {
      turn = { id: crypto.randomUUID(), kind: 'player', input: pendingInput, reply }
    } else if (turns.length === 0) {
      turn = { id: crypto.randomUUID(), kind: 'bootstrap', reply }
    } else {
      turn = { id: crypto.randomUUID(), kind: 'continue', reply }
    }
    turns.push(turn)
    pendingInput = undefined
    if (nextV1Index <= v1Cutoff) cutoff = turns.length
  }
  return { turns, cutoff }
}

export function normalizeSavedGame(
  raw: SavedGame | SavedGameV1 | SavedGameV2,
): SavedGame {
  const legacy = raw as SavedGame &
    SavedGameV1 &
    SavedGameV2 & {
      scenario?: string
      plot?: unknown
      chronicle?: unknown
      memory?: unknown
    }
  const incoming: Record<string, unknown> = isRecord(legacy.slots) ? legacy.slots : {}
  const slots = defaultSlots()
  for (const def of ADVENTURE_SLOTS) {
    const value = incoming[def.key]
    if (typeof value === 'string') slots[def.key] = value
  }
  if (legacy.scenario && !incoming.scenario) {
    slots.scenario = legacy.scenario
  }
  const plot = Array.isArray(legacy.plot)
    ? legacy.plot.filter((p): p is string => typeof p === 'string')
    : []
  const oocRaw = (legacy as { ooc?: unknown }).ooc
  const ooc = Array.isArray(oocRaw)
    ? oocRaw.filter((p): p is string => typeof p === 'string')
    : []
  let turns: Turn[]
  let cutoff: number
  if (Array.isArray(legacy.turns)) {
    turns = legacy.turns.filter(isTurnLike)
    cutoff = clampCutoff(legacy.compactCutoff, turns.length)
  } else {
    const migrated = migrateV1MessagesToTurns(
      Array.isArray(legacy.messages) ? legacy.messages : [],
      legacy.compactCutoff,
    )
    turns = migrated.turns
    cutoff = migrated.cutoff
  }
  let chronicle: Chronicle
  if (isChronicleLike(legacy.chronicle)) {
    chronicle = legacy.chronicle
  } else if (typeof legacy.summary === 'string' && legacy.summary.length > 0) {
    chronicle = summaryToChronicle(legacy.summary, cutoff)
  } else {
    chronicle = []
  }
  const memory: Memory = isMemoryLike(legacy.memory) ? legacy.memory : {}
  return {
    id: legacy.id,
    name: legacy.name,
    savedAt: legacy.savedAt,
    slots,
    state: isWorldStateLike(legacy.state) ? legacy.state : structuredClone(DEFAULT_STATE),
    plot,
    memory,
    ooc,
    chronicle,
    turns,
    compactCutoff: cutoff,
  }
}
