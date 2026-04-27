// All localStorage IO + save-file shape detection / migration. The React tree
// sees only loadStored*/persist* functions and the SavedGame type.

import { ADVENTURE_SLOTS, DEFAULT_CONTEXT, DEFAULT_SAMPLING, DEFAULT_STATE, defaultSlots } from './config'
import type {
  AdventureSlots,
  Chronicle,
  ChronicleEntry,
  ContextConfig,
  MessageV1,
  ModelCall,
  SamplingParams,
  SavedGame,
  SavedGameV1,
  SavedGameV2,
  Turn,
  WorldState,
} from './types'

export const LS_SYSTEM = 'dm.systemPrompt'
export const LS_MODEL = 'dm.model'
export const LS_XAI_KEY = 'dm.xaiKey'
export const LS_STATE = 'dm.state'
export const LS_PLOT = 'dm.plot'
export const LS_CHRONICLE = 'dm.chronicle'

const LS_SUMMARY_V2 = 'dm.summary'
export const LS_TURNS = 'dm.turns'
export const LS_SAMPLING = 'dm.sampling'
export const LS_CONTEXT = 'dm.context'
export const LS_COMPACT_CUTOFF = 'dm.compactCutoff'
export const LS_SAVES = 'dm.saves'

const LS_MESSAGES_V1 = 'dm.messages'

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
    const parsed = JSON.parse(raw) as WorldState
    return parsed
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
      const parsed = JSON.parse(raw) as Turn[]
      if (Array.isArray(parsed)) {
        return { turns: parsed, cutoff: loadStoredCompactCutoffRaw() }
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
    return {
      compactionThreshold:
        typeof parsed.compactionThreshold === 'number'
          ? parsed.compactionThreshold
          : DEFAULT_CONTEXT.compactionThreshold,
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
      usePlanner:
        typeof parsed.usePlanner === 'boolean'
          ? parsed.usePlanner
          : DEFAULT_CONTEXT.usePlanner,
      nsfw:
        typeof parsed.nsfw === 'boolean'
          ? parsed.nsfw
          : DEFAULT_CONTEXT.nsfw,
    }
  } catch {
    return { ...DEFAULT_CONTEXT }
  }
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
      if (Array.isArray(parsed)) {
        return parsed as Chronicle
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
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  const hasNewSlots =
    typeof s.slots === 'object' && s.slots !== null && !Array.isArray(s.slots)
  const hasOldScenario = typeof s.scenario === 'string'
  const hasTurnsOrMessages = Array.isArray(s.turns) || Array.isArray(s.messages)
  const hasChronicleOrSummary =
    Array.isArray(s.chronicle) || typeof s.summary === 'string'
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.savedAt === 'number' &&
    (hasNewSlots || hasOldScenario) &&
    hasChronicleOrSummary &&
    typeof s.compactCutoff === 'number' &&
    hasTurnsOrMessages &&
    typeof s.state === 'object' &&
    s.state !== null &&
    !Array.isArray(s.state)
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
    SavedGameV2 & { scenario?: string; plot?: unknown; chronicle?: unknown }
  const incoming: Partial<AdventureSlots> = (legacy.slots as Partial<AdventureSlots> | undefined) ?? {}
  const slots = { ...defaultSlots(), ...incoming }
  if (legacy.scenario && !incoming.scenario) {
    slots.scenario = legacy.scenario
  }
  const plot = Array.isArray(legacy.plot)
    ? legacy.plot.filter((p): p is string => typeof p === 'string')
    : []
  let turns: Turn[]
  let cutoff: number
  if (Array.isArray(legacy.turns)) {
    turns = legacy.turns
    cutoff = legacy.compactCutoff
  } else {
    const migrated = migrateV1MessagesToTurns(
      Array.isArray(legacy.messages) ? legacy.messages : [],
      legacy.compactCutoff,
    )
    turns = migrated.turns
    cutoff = migrated.cutoff
  }
  let chronicle: Chronicle
  if (Array.isArray(legacy.chronicle)) {
    chronicle = legacy.chronicle as Chronicle
  } else if (typeof legacy.summary === 'string' && legacy.summary.length > 0) {
    chronicle = summaryToChronicle(legacy.summary, cutoff)
  } else {
    chronicle = []
  }
  return {
    id: legacy.id,
    name: legacy.name,
    savedAt: legacy.savedAt,
    slots,
    state: legacy.state,
    plot,
    chronicle,
    turns,
    compactCutoff: cutoff,
  }
}
