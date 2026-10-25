// Shared data types for the DM engine. Plain TypeScript — no React, no IO.

import type { ApiProtocol, ReasoningEffort } from './model/types'

export type Role = 'dm' | 'player'

export type TraceEvent =
  | { kind: 'thought'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'call'; name: string; arguments: string; result: string }
  // One per model request: the provider's prompt-token usage, including how
  // many prompt tokens it served from its prefix cache. Lets the trace pane
  // show whether the append-only request layout is actually being reused.
  // durationMs is how long the request took, so a slow turn shows where the
  // time went.
  | { kind: 'usage'; label: string; promptTokens?: number; cachedTokens?: number; durationMs?: number }

export type TurnKind = 'bootstrap' | 'player' | 'continue'

export interface ModelCall {
  id: string
  model: string
  text?: string
  trace?: TraceEvent[]
  reasoningTokens?: number
  durationMs?: number
  // Set when the call failed and `text` holds the player-facing failure
  // notice rather than narration. A failed turn stays in the log but is
  // never replayed to the model or folded into the chronicle.
  error?: string
  // Set when the player stopped the call. On a plotter call, the turn's
  // bookkeeping was skipped and the world stayed as the turn found it.
  stopped?: boolean
}

// One call the Plotter made before the reply that briefs the narrator — a
// recalled memory or a steer — with its result. The narrator's notes for that
// reply are built from them.
export interface BriefingCall {
  name: string
  arguments: string
  result: string
}

// What the narrator is told at a turn that holds for the rest of the story,
// kept with the turn and replayed in history as a `story_update` call between
// its input and reply: memory entries newly recalled, in full; for entries it
// already holds, only what has changed, with null for what no longer holds;
// and the player's standing OOC instructions, when they changed or have
// dropped out of view.
export interface StoryUpdate {
  recalled?: Memory
  changed?: Memory
  ooc?: string[]
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
  // The Plotter phase's activity (tool calls planning the turn and recording
  // state/memory/plan updates before the narration). No text — kept separate
  // so the trace pane can show the plot and narrate phases as distinct
  // sections.
  plotter?: ModelCall
  storyUpdate?: StoryUpdate
  // The Plotter's briefing for this turn's reply, as saved by older versions,
  // which replayed it to the narrator. No longer saved or read; the Plotter's
  // trace keeps its calls.
  briefing?: BriefingCall[]
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

// Long-term memory: slug → free JSON for each canonical entity (people,
// places, things) that persists across scenes. The rules suggest a facet
// vocabulary; the shape beyond that is the model's discretion. Edited
// additively by dotted path (any depth): only paths named in a call change;
// omission never deletes.
export type Memory = { [slug: string]: JsonValue }

// The working data a turn threads through the narrator, plotter, and tool
// executor as one unit: current-scene state, future plot plan, and the
// long-term memory fact file. Persisted shapes (SavedGame, WorldSnapshot)
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
  narratorReasoning: ReasoningEffort
  // Empty model means use the narrator model (also preserves legacy settings).
  plotterModel: string
  plotterReasoning: ReasoningEffort
  summarizerModel: string
  summarizerReasoning: ReasoningEffort
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
  // Which OpenAI-compatible wire protocol to use for all model calls.
  // 'chat-completions' works everywhere; 'responses' is the newer format
  // recommended by xAI/OpenAI (also supported by Ollama and vLLM).
  apiProtocol: ApiProtocol
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

// Everything a turn can change apart from the log itself: the plotter
// rewrites state, plot, memory and OOC, and compaction rewrites the chronicle.
// None of it can be rebuilt from the log, so undoing a turn needs a copy.
export interface WorldSnapshot {
  state: WorldState
  plot: string[]
  memory: Memory
  ooc: string[]
  chronicle: Chronicle
  compactCutoff: number
}

// The log only grows at its end, so Undo, Retry and Redo are moves on it:
// remove the latest turn, run it again, or put it back. Recovery holds only
// what the log can't give back. Persisted, and checked against the log on load.
export interface TurnRecovery {
  // The world the latest turn started from, and the adventure settings it ran
  // with. Null when that turn can't be undone or retried.
  before: { turnId: string; world: WorldSnapshot; slots: AdventureSlots } | null
  // After an Undo: the removed turn, the world it left, and the turn it sat on
  // (null for the opening), so Redo can put it back in the same place.
  undone: { afterId: string | null; turn: Turn; world: WorldSnapshot } | null
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
