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
  // The Narrator's raw draft. Populated only when the reviser pass ran;
  // otherwise the narrator's output is `reply` and this is undefined. Kept
  // separate so the trace can show draft → revised side by side.
  narrator?: ModelCall
  reply: ModelCall
  // The Plotter phase's activity (tool calls recording state/memory/plan
  // updates after the narration). No text — kept separate so the trace pane
  // can show the narrate and plot phases as distinct sections.
  plotter?: ModelCall
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

// Long-term memory: a slug → freeform string description of canonical entities
// (NPCs, locations, plot themes, key events) that persist across scenes. Each
// value is a single complete English description for that entity.
export type Memory = { [key: string]: string }

// The working data a turn threads through the narrator, plotter, and tool
// executor as one unit: current-scene state, future plot plan, and the
// long-term memory fact file. Persisted shapes (SavedGame, TurnCheckpoint)
// keep these as separate fields; StoryData is the in-engine carrier.
export interface StoryData {
  state: WorldState
  plot: string[]
  memory: Memory
  // Standing out-of-character player directives, as a numbered list like the
  // plot plan. Entries persist until withdrawn, superseded, or completed.
  ooc: string[]
}

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
  // N (high watermark) — when the live tail (turns past the cutoff) reaches
  // this many turns, a compaction event runs and drains the tail down to
  // compactionFloor. N also remains the per-level promotion threshold: when
  // chronicle[k].length >= N, the first M entries promote to chronicle[k+1].
  compactionThreshold: number
  // Low watermark — the drain target of a compaction event. Events recur
  // every (N - floor) turns; between events the chronicle and cutoff are
  // frozen, so the request prefix stays byte-stable for provider caching.
  // Effective value is clamped to at most N - M.
  compactionFloor: number
  // M — how many turns or entries to fold per chronicle entry (the sub-batch
  // size within a drain event, not the event cadence). Each summary targets
  // 1/M of the combined input length, so compression ratio is constant and
  // entries end up roughly "one turn-worth" regardless of how long individual
  // turns happen to be.
  compactionBatch: number
  stateCleanupChars: number
  includePriorPlayerTurns: boolean
  reminderAsSystem: boolean
  includeWorldState: boolean
  includePlotOutline: boolean
  includeMemory: boolean
  includeOoc: boolean
  // When true, run a second model pass after the narrator to polish its draft
  // into clean English. The revised text replaces the narrator output as the
  // visible reply; the original draft is preserved on Turn.narrator.
  useReviser: boolean
  // Model id for the reviser pass. A lightweight instruction-following model
  // is generally sufficient for this prose-cleanup task.
  reviserModel: string
  nsfw: boolean
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
}

export interface TurnCheckpoint {
  turns: Turn[]
  state: WorldState
  plot: string[]
  memory: Memory
  ooc: string[]
  chronicle: Chronicle
  compactCutoff: number
}

export interface RetryAction {
  checkpoint: TurnCheckpoint
  input: string
  restoreInput: string
  kind: TurnKind
  slots: AdventureSlots
}

export interface SavedGame {
  id: string
  name: string
  savedAt: number
  slots: AdventureSlots
  state: WorldState
  plot: string[]
  memory: Memory
  ooc: string[]
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

export const CONTINUE_DIRECTIVE =
  '(OOC: The player is skipping their turn — they want the narration to continue before they act. Carry the scene forward from exactly where it stopped and progress to the next player decision point. Do not restate or linger on the previous beat; if the scene needs fresh impetus, consider bringing in a development — your future plot plan may suggest one. Stop when the player faces a concrete, meaningful choice.)'
