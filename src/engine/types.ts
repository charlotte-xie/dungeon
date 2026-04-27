// Shared data types for the DM engine. Plain TypeScript — no React, no IO.

export type Role = 'dm' | 'player'

export type TraceEvent =
  | { kind: 'thought'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'call'; name: string; arguments: string; result: string }

export type TurnKind = 'bootstrap' | 'player' | 'continue'

export interface ModelCall {
  id: string
  model: string
  text?: string
  trace?: TraceEvent[]
  reasoningTokens?: number
  durationMs?: number
}

export interface Turn {
  id: string
  kind: TurnKind
  input?: string
  planner?: ModelCall
  reply: ModelCall
}

// Legacy shape — kept only so v1 saves and v1 localStorage can be migrated.
export interface MessageV1 {
  id: string
  role: Role
  text: string
  trace?: TraceEvent[]
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type WorldState = { [key: string]: JsonValue }

export type SlotKey = 'scenario' | 'styleGuide'
export type AdventureSlots = Record<SlotKey, string>

export interface SlotDef {
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

export interface ContextConfig {
  // N — when the live tail (turns past the cutoff) reaches this many turns,
  // fold the oldest M into one chronicle[0] entry. Same N applies recursively
  // at every chronicle level: when chronicle[k].length >= N, promote first M
  // to chronicle[k+1].
  compactionThreshold: number
  // M — how many turns or entries to fold per compaction step. Each summary
  // targets 1/M of the combined input length, so compression ratio is
  // constant and entries end up roughly "one turn-worth" regardless of how
  // long individual turns happen to be.
  compactionBatch: number
  stateCleanupChars: number
  includePriorPlayerTurns: boolean
  appendReminderToUser: boolean
  includeWorldState: boolean
  includePlotOutline: boolean
  usePlanner: boolean
}

export interface ChronicleEntry {
  id: string
  text: string
  // Number of original raw turns this entry represents. For chronicle[0]
  // entries that's M; promoted entries multiply (one chronicle[k+1] entry
  // covers M^(k+1) turns).
  turnsCovered: number
  createdAt: number
}

// Outer index = level. chronicle[0] is the newest, least compressed level;
// chronicle[chronicle.length - 1] is the topmost (oldest, most compressed).
// When a level reaches N entries, the first M are promoted into one entry at
// the next level up, and the structure can grow taller.
export type Chronicle = ChronicleEntry[][]

export interface SamplingParams {
  temperature: number
  frequencyPenalty: number
  presencePenalty: number
}

export interface TurnSnapshot {
  turns: Turn[]
  state: WorldState
  plot: string[]
  chronicle: Chronicle
  compactCutoff: number
  input: string
  kind: TurnKind
}

export interface SavedGame {
  id: string
  name: string
  savedAt: number
  slots: AdventureSlots
  state: WorldState
  plot: string[]
  chronicle: Chronicle
  turns: Turn[]
  compactCutoff: number
}

// Pre-chronicle save shape (v2). Kept so existing saves migrate on load.
export interface SavedGameV2 {
  id: string
  name: string
  savedAt: number
  slots: AdventureSlots
  state: WorldState
  plot: string[]
  summary: string
  turns: Turn[]
  compactCutoff: number
}

export interface SavedGameV1 {
  id: string
  name: string
  savedAt: number
  slots?: AdventureSlots
  scenario?: string
  state: WorldState
  plot?: unknown
  summary: string
  messages: MessageV1[]
  compactCutoff: number
}

export const SAVE_FILE_MARKER = 'dm-save' as const

export interface SaveFile {
  marker: typeof SAVE_FILE_MARKER
  version: 3
  save: SavedGame
}

export interface SaveFileV2 {
  marker: typeof SAVE_FILE_MARKER
  version: 2
  save: SavedGameV2
}

export interface SaveFileV1 {
  marker: typeof SAVE_FILE_MARKER
  version: 1
  save: SavedGameV1
}

// xAI request/response shapes.

export interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type?: string
  function: { name: string; arguments: string }
}

export interface InlineToolCall {
  name: string
  arguments: string
}

export const CONTINUE_DIRECTIVE =
  '(OOC: Continue the scene without waiting for a new player action. Push the narrative forward — time passing, an NPC making a move, a revelation, a pressure mounting — until the player faces a concrete decision. End on a narrated stimulus as usual.)'
