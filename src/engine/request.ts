// Composes the provider-neutral conversations sent through the model boundary.
// Pure functions — given turns + records + flags, returns model messages.
//
// Each turn sends two requests, one per role. The Plotter goes first: it reads
// the full records, records what the last reply established, decides how the
// world answers the player, and briefs the narrator. The narrator then writes
// the reply from the story and that briefing alone. Each request is laid out
// front to back as:
//
//   1. Stable prefix — one system message: the role's own system prompt (the
//      narrator's writing brief, or the Plotter's directing brief), NSFW
//      stance and adventure slots; then the chronicle. The Plotter's rules
//      for each record travel in its tools. Changes rarely (settings edits,
//      compactions).
//   2. History — append-only between compactions: each turn's input (player
//      text, or the fixed opening / Continue input), the narrator's
//      story update, and its narration prose, so nothing sent once is later
//      removed. The story update — memory entries newly recalled, or already
//      in view and changed, and the arcs and the OOC list when they changed —
//      sits between the input and the reply as the narrator's own calls,
//      named for what they bring and saved with the turn so they replay byte
//      for byte. After a fold, the narrator's history opens with the same
//      kind of update, telling in full what it held when the folded turns
//      were folded, so what it has in view carries across the synopsis.
//      Other tool calls and reasoning are never replayed. A failed turn
//      produced no narration and is skipped entirely.
//   3. Tail — volatile, part of the current turn only and never persisted.
//      The Plotter gets the current records as a seeded tool exchange (one
//      assistant message that "called" the read tools, then one tool result
//      per call), followed by its instruction. The narrator gets its notes
//      for this reply alone as one call — the scene and the steer — then the
//      turn reminder.
//
// Because the volatile data enters only at the tail, each request extends the
// same role's request from the previous turn, and within a turn each request
// only appends, so providers can reuse the longest cached prefix for each
// role. The Plotter's read tools stay live, so it may re-issue them to
// re-check a value.
//
// The payloads are pure data. The per-record bookkeeping guidance (what to
// record this turn, soft size pressure) travels in the Plotter's instruction.

import { buildTurnReminder, contentStance, plotterSystemPrompt } from '../prompts'
import { buildChronicleSystemMessage } from './chronicle'
import { ADVENTURE_SLOTS } from './config'
import {
  CHECK_ARCS_TOOL,
  CHECK_MEMORY_TOOL,
  CHECK_OOC_TOOL,
  CHECK_STATE_TOOL,
  EVENTS_FACET,
  MAX_ENTRY_EVENTS,
  GET_OOC_INSTRUCTIONS_TOOL,
  GET_STEER_TOOL,
  GET_STORY_ARCS_TOOL,
  RECALL_MEMORIES_TOOL,
  RECALL_MEMORY_TOOL,
  STEER_TOOL,
  UPDATE_ARCS_TOOL,
  UPDATE_MEMORY_TOOL,
  UPDATE_OOC_TOOL,
  UPDATE_STATE_TOOL,
} from './tools'
import type { ModelMessage, ModelToolCall, ModelToolDefinition } from './model/types'
import type {
  AdventureSlots,
  BriefingCall,
  Chronicle,
  JsonValue,
  Memory,
  SlotDef,
  StoryData,
  StoryUpdate,
  Turn,
  WorldState,
} from './types'

export function buildSlotMessage(def: SlotDef, value: string): string {
  return `${def.header}\n\n${value}`
}

// --- Context payloads: the tool-result content served for each read tool, ---
// --- both in the seeded injection and for live re-reads. Pure data only.   ---

export function buildStatePayload(currentState: WorldState): string {
  return `\`\`\`json\n${JSON.stringify(currentState, null, 2)}\n\`\`\``
}

export function buildMemoryPayload(currentMemory: Memory): string {
  return Object.keys(currentMemory).length
    ? `\`\`\`json\n${JSON.stringify(currentMemory, null, 2)}\n\`\`\``
    : '(no memory yet)'
}

export function buildPlotPayload(currentPlot: string[]): string {
  return currentPlot.length
    ? currentPlot.map((p, i) => `${i + 1}. ${p}`).join('\n')
    : '(no arcs)'
}

export function buildOocPayload(currentOoc: string[]): string {
  return currentOoc.length
    ? currentOoc.map((p, i) => `${i + 1}. ${p}`).join('\n')
    : '(no standing OOC instructions)'
}

// --- Plotter status: soft size-pressure hints computed from the data. What ---
// --- to record lives in the rules; only these change from turn to turn.     ---

export function buildStateGuidance(
  currentState: WorldState,
  stateCleanupThreshold: number,
): string {
  const size = JSON.stringify(currentState, null, 2).length
  return size > stateCleanupThreshold
    ? `STATUS: state size is ${size.toLocaleString()} chars — OVER the ${stateCleanupThreshold.toLocaleString()} cleanup threshold. Tighten the \`update_state\` call: drop stale keys by leaving them out of both \`keep\` and \`set\`, and condense any value that has grown bloated.`
    : `STATUS: state size is ${size.toLocaleString()} chars — within budget (threshold ${stateCleanupThreshold.toLocaleString()}).`
}

// Above this size memory gets a nudge to trim — the only size pressure on
// memory; there are no structural caps.
const MEMORY_SIZE_HINT_CHARS = 8_000

export function buildMemoryGuidance(currentMemory: Memory): string {
  const size = JSON.stringify(currentMemory, null, 2).length
  return size > MEMORY_SIZE_HINT_CHARS
    ? `STATUS: memory is ${size.toLocaleString()} chars — getting long. Delete what stopped mattering and fold duplicates together, keeping values as complete sentences.`
    : ''
}

// Which subsystems the current settings enable.
export interface ContextFlags {
  includeWorldState: boolean
  includePlotOutline: boolean
  includeMemory: boolean
  includeOoc: boolean
}

// One descriptor per context subsystem, in canonical order. Everything the
// pipeline needs to know about a subsystem lives here — its tools (whose
// descriptions carry its rules), injection payload and status hints — so
// every consumer (seeded injection, tool advertisement, live re-reads, the
// Plotter's instruction) iterates this table. A subsystem that is switched
// off cannot be mentioned anywhere, by construction.
export interface ContextSubsystem {
  enabled(flags: ContextFlags): boolean
  checkTool: ModelToolDefinition
  updateTool: ModelToolDefinition
  // Further Plotter tools that brief the narrator: recall for memory, steer
  // for the arcs.
  briefTools: readonly ModelToolDefinition[]
  // Heads this subsystem's status line in the Plotter's instruction.
  label: string
  // The tool-result content for the check tool: the current data, nothing
  // else. Served in the seeded injection and for live re-reads.
  buildPayload(data: StoryData): string
  // An empty record is left out of the seeded injection: there is nothing
  // to read.
  isEmpty(data: StoryData): boolean
  // Soft size hints for the Plotter this turn; empty when there are none.
  buildGuidance(data: StoryData, stateCleanupThreshold: number): string
}

export const CONTEXT_SUBSYSTEMS: readonly ContextSubsystem[] = [
  {
    enabled: (flags) => flags.includeMemory,
    checkTool: CHECK_MEMORY_TOOL,
    updateTool: UPDATE_MEMORY_TOOL,
    briefTools: [RECALL_MEMORY_TOOL],
    label: 'Memory',
    buildPayload: (data) => buildMemoryPayload(data.memory),
    isEmpty: (data) => Object.keys(data.memory).length === 0,
    buildGuidance: (data) => buildMemoryGuidance(data.memory),
  },
  {
    enabled: (flags) => flags.includePlotOutline,
    checkTool: CHECK_ARCS_TOOL,
    updateTool: UPDATE_ARCS_TOOL,
    briefTools: [STEER_TOOL],
    label: 'Arcs',
    buildPayload: (data) => buildPlotPayload(data.plot),
    isEmpty: (data) => data.plot.length === 0,
    buildGuidance: () => '',
  },
  {
    enabled: (flags) => flags.includeWorldState,
    checkTool: CHECK_STATE_TOOL,
    updateTool: UPDATE_STATE_TOOL,
    briefTools: [],
    label: 'Live state',
    buildPayload: (data) => buildStatePayload(data.state),
    isEmpty: (data) => Object.keys(data.state).length === 0,
    buildGuidance: (data, stateCleanupThreshold) =>
      buildStateGuidance(data.state, stateCleanupThreshold),
  },
  {
    enabled: (flags) => flags.includeOoc,
    checkTool: CHECK_OOC_TOOL,
    updateTool: UPDATE_OOC_TOOL,
    briefTools: [],
    label: 'OOC instructions',
    buildPayload: (data) => buildOocPayload(data.ooc),
    isEmpty: (data) => data.ooc.length === 0,
    buildGuidance: () => '',
  },
]

// The tools the Plotter is offered: each enabled subsystem's update, read,
// and briefing tools.
export function buildPlotterTools(flags: ContextFlags): ModelToolDefinition[] {
  return CONTEXT_SUBSYSTEMS.filter((s) => s.enabled(flags)).flatMap((s) => [
    s.updateTool,
    s.checkTool,
    ...s.briefTools,
  ])
}

// The Plotter's seeded tool exchange delivering the volatile working data,
// for each enabled record that holds something. Call ids are fixed: the
// injection appears exactly once per request and is never persisted or
// replayed, and stable bytes maximise provider prefix-cache hits.
export function buildContextInjectionMessages(
  data: StoryData,
  flags: ContextFlags,
): ModelMessage[] {
  const calls: ModelToolCall[] = []
  const results: ModelMessage[] = []
  for (const s of CONTEXT_SUBSYSTEMS) {
    if (!s.enabled(flags) || s.isEmpty(data)) continue
    const name = s.checkTool.name
    const id = `ctx-${name.replace(/_/g, '-')}`
    calls.push({ id, name, arguments: '{}' })
    results.push({ role: 'tool', toolCallId: id, content: s.buildPayload(data) })
  }
  if (!calls.length) return []
  return [{ role: 'assistant', content: '', toolCalls: calls }, ...results]
}

// The status block for the Plotter's instruction, computed from the data at
// the start of the turn. Empty when no subsystem has anything to report.
export function buildPlotterGuidance(
  data: StoryData,
  stateCleanupThreshold: number,
  flags: ContextFlags,
): string {
  return CONTEXT_SUBSYSTEMS.filter((s) => s.enabled(flags))
    .map((s) => ({ label: s.label, text: s.buildGuidance(data, stateCleanupThreshold) }))
    .filter((g) => g.text)
    .map((g) => `${g.label}: ${g.text}`)
    .join('\n\n')
}

export interface ModelMessagesArgs {
  // The narrator's system prompt; the Plotter has its own.
  systemPrompt: string
  slots: AdventureSlots
  chronicle: Chronicle
  // The turns the chronicle covers, before those in view.
  folded: Turn[]
  history: Turn[]
  data: StoryData
  includePriorPlayerTurns: boolean
  flags: ContextFlags
  nsfw: boolean
  // Send the turn reminder (narrator) or pivot (Plotter) as a trailing system
  // message, or else as an in-channel (OOC: ...) user message.
  reminderAsSystem: boolean
  // The Plotter's briefing for the reply being written, from which the
  // narrator's notes are built. The Plotter's own request ignores it.
  briefing?: BriefingCall[]
}

// One request, in its architectural sections, so the Context viewer can show
// each without re-parsing the flattened list.
export interface RequestSections {
  // Stable prefix: one system message holding the role's system prompt, the
  // content stance and the adventure slots.
  system: ModelMessage[]
  chronicle: ModelMessage[]
  history: ModelMessage[]
  // The volatile tail, rebuilt every turn.
  tail: ModelMessage[]
}

export function flattenSections(sections: RequestSections): ModelMessage[] {
  return [...sections.system, ...sections.chronicle, ...sections.history, ...sections.tail]
}

// The head of a role's stable prefix, as one system message: its own system
// prompt, then the content stance and the adventure slots under their
// headings. The narrator gets every slot; the Plotter leaves out the
// narrator's writing guidance. Some chat templates take only one system
// message at the start.
function buildFrameMessages(
  args: ModelMessagesArgs,
  systemPrompt: string,
  role: 'narrator' | 'plotter',
): ModelMessage[] {
  const parts = [systemPrompt, contentStance(args.nsfw)]
  for (const def of ADVENTURE_SLOTS) {
    const value = (args.slots[def.key] ?? '').trim()
    if (!value || (role === 'plotter' && def.narratorOnly)) continue
    parts.push(buildSlotMessage(def, value))
  }
  return [{ role: 'system', content: parts.join('\n\n') }]
}

// The briefing's calls of one tool, by their parsed arguments. The executor
// has already accepted each one.
function briefingArgs(briefing: BriefingCall[], name: string): Record<string, unknown>[] {
  return briefing.flatMap((c) => {
    if (c.name !== name) return []
    try {
      const args: unknown = JSON.parse(c.arguments)
      return args && typeof args === 'object' ? [args as Record<string, unknown>] : []
    } catch {
      return []
    }
  })
}

// A plain JSON object, as opposed to an array, a scalar or null.
function isPlainObject(value: unknown): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// What changed between two versions of a memory value: within objects, only
// the keys whose values differ, with null for a key that has gone; anything
// else is replaced whole. Undefined when nothing changed. fromEntries defines
// own properties, so no key can reach a prototype.
function diffJson(before: JsonValue, after: JsonValue): JsonValue | undefined {
  if (JSON.stringify(before) === JSON.stringify(after)) return undefined
  if (!isPlainObject(before) || !isPlainObject(after)) return after
  const changes: [string, JsonValue][] = []
  for (const [key, value] of Object.entries(after)) {
    const held = before[key]
    let change: JsonValue | undefined
    if (key === EVENTS_FACET && Array.isArray(held) && Array.isArray(value)) {
      // Only what is new: the rest of a rolling list was said when it was new.
      const added = value.filter((item) => !held.includes(item))
      change = added.length ? added : undefined
    } else {
      change = Object.hasOwn(before, key) ? diffJson(held, value) : value
    }
    if (change !== undefined) changes.push([key, change])
  }
  for (const key of Object.keys(before)) {
    if (!Object.hasOwn(after, key)) changes.push([key, null])
  }
  return changes.length ? Object.fromEntries(changes) : undefined
}

// Applies a change made by diffJson. An entry's events keep the last few, as
// memory keeps them.
function applyJsonChange(base: JsonValue, change: JsonValue): JsonValue {
  if (!isPlainObject(base) || !isPlainObject(change)) return change
  const merged = new Map(Object.entries(base))
  for (const [key, value] of Object.entries(change)) {
    const held = base[key]
    if (value === null) merged.delete(key)
    else if (key === EVENTS_FACET && Array.isArray(held) && Array.isArray(value)) {
      merged.set(key, [...held, ...value].slice(-MAX_ENTRY_EVENTS))
    }
    else merged.set(key, Object.hasOwn(base, key) ? applyJsonChange(held, value) : value)
  }
  return Object.fromEntries(merged)
}

// --- The narrator's view of the records ---
// What the narrator has been told: the memory entries it was given in full,
// with later changes applied, and the OOC list and arcs it was last given.
// Every story update is one step from a view: worked out by storyUpdateFor,
// told by storyUpdateCalls, and taken in by applyStoryUpdate. The first step
// comes straight after the synopsis and tells, from nothing in view,
// everything the narrator held when the folded turns were folded; each turn
// then takes a step from there.

export interface NarratorView {
  memory: ReadonlyMap<string, JsonValue>
  ooc?: string[]
  arcs?: string[]
}

const NOTHING_IN_VIEW: NarratorView = { memory: new Map() }

// What a step aims for. A record left undefined isn't touched.
interface ViewTarget {
  memory?: ReadonlyMap<string, JsonValue>
  ooc?: string[]
  arcs?: string[]
}

// The view once the narrator has been told this update.
function applyStoryUpdate(view: NarratorView, update: StoryUpdate | undefined): NarratorView {
  if (!update) return view
  const memory = new Map(view.memory)
  for (const [name, entry] of Object.entries(update.recalled ?? {})) memory.set(name, entry)
  for (const [name, change] of Object.entries(update.changed ?? {})) {
    // A change to an entry whose full version is out of view can't be read
    // on its own, so that entry stays out of view.
    const held = memory.get(name)
    if (held !== undefined) memory.set(name, applyJsonChange(held, change))
  }
  for (const name of update.forgotten ?? []) memory.delete(name)
  return { memory, ooc: update.ooc ?? view.ooc, arcs: update.arcs ?? view.arcs }
}

// The view after these turns' updates, failed turns aside.
function viewAfter(view: NarratorView, turns: Turn[]): NarratorView {
  return turns.reduce((v, t) => (t.reply.error ? v : applyStoryUpdate(v, t.storyUpdate)), view)
}

// A list goes when it differs from the one in view, or when none is in view
// and it holds something.
function listDiffers(inView: string[] | undefined, list: string[]): boolean {
  return inView ? JSON.stringify(inView) !== JSON.stringify(list) : list.length > 0
}

// The step: what to tell a narrator holding `view` so that it holds
// `target`. Memory entries it doesn't hold go in full; for those it holds,
// only what has changed, so nothing unchanged is said again; held entries the
// target no longer has are forgotten. The OOC list and the arcs go whole when
// they differ. Undefined when there is nothing to tell.
function storyUpdateFor(view: NarratorView, target: ViewTarget): StoryUpdate | undefined {
  const update: StoryUpdate = {}
  if (target.memory) {
    const recalled: [string, JsonValue][] = []
    const changed: [string, JsonValue][] = []
    for (const [name, entry] of target.memory) {
      const held = view.memory.get(name)
      if (held === undefined) {
        recalled.push([name, entry])
        continue
      }
      const change = diffJson(held, entry)
      if (change !== undefined) changed.push([name, change])
    }
    const forgotten = [...view.memory.keys()].filter((name) => !target.memory?.has(name))
    if (recalled.length) update.recalled = Object.fromEntries(recalled)
    if (changed.length) update.changed = Object.fromEntries(changed)
    if (forgotten.length) update.forgotten = forgotten
  }
  if (target.arcs && listDiffers(view.arcs, target.arcs)) update.arcs = [...target.arcs]
  if (target.ooc && listDiffers(view.ooc, target.ooc)) update.ooc = [...target.ooc]
  return Object.keys(update).length ? update : undefined
}

// The records a step aims for, of those switched on.
function shownRecords(flags: ContextFlags, records: ViewTarget): ViewTarget {
  return {
    ...(flags.includeMemory ? { memory: records.memory } : {}),
    ...(flags.includePlotOutline ? { arcs: records.arcs } : {}),
    ...(flags.includeOoc ? { ooc: records.ooc } : {}),
  }
}

// The first step, told straight after the synopsis: from nothing in view, to
// what the narrator held when these turns were folded. It changes only when
// more turns are folded. Undefined with nothing folded.
export function synopsisStoryUpdate(folded: Turn[], flags: ContextFlags): StoryUpdate | undefined {
  return storyUpdateFor(NOTHING_IN_VIEW, shownRecords(flags, viewAfter(NOTHING_IN_VIEW, folded)))
}

// What the narrator holds before the turn being played: the first step, then
// the updates of the turns in view before it.
export function narratorView(folded: Turn[], earlier: Turn[], flags: ContextFlags): NarratorView {
  return viewAfter(applyStoryUpdate(NOTHING_IN_VIEW, synopsisStoryUpdate(folded, flags)), earlier)
}

// What the turn adds to the narrator's history: the step to the records as
// they stand after the Plotter's updates, for the entries the narrator holds
// and those the Plotter recalled. Once recalled, an entry is kept current
// without being recalled again. `folded` are the turns the synopsis covers,
// and `earlier` those in view before this turn.
export function buildStoryUpdate(
  earlier: Turn[],
  briefing: BriefingCall[],
  data: StoryData,
  flags: ContextFlags,
  folded: Turn[],
): StoryUpdate | undefined {
  const view = narratorView(folded, earlier, flags)
  const recalledNames = briefingArgs(briefing, RECALL_MEMORY_TOOL.name).flatMap((a) =>
    Array.isArray(a.names) ? a.names.filter((n): n is string => typeof n === 'string') : [],
  )
  const memory = new Map<string, JsonValue>()
  for (const name of new Set([...recalledNames, ...view.memory.keys()])) {
    if (Object.hasOwn(data.memory, name)) memory.set(name, data.memory[name])
  }
  return storyUpdateFor(view, shownRecords(flags, { memory, arcs: data.plot, ooc: data.ooc }))
}

// The OOC instructions as the narrator gets them: the whole list when it has
// none in view; after that, only what was added and what was withdrawn.
// Empty when only the order changed.
function renderOocUpdate(list: string[], before: string[] | undefined): string {
  if (!before) return buildOocPayload(list)
  const added = list.filter((entry) => !before.includes(entry))
  const withdrawn = before.filter((entry) => !list.includes(entry))
  const bullets = (entries: string[]) => entries.map((entry) => `- ${entry}`).join('\n')
  return [
    ...(added.length ? [`# Added\n\n${bullets(added)}`] : []),
    ...(withdrawn.length ? [`# Withdrawn\n\n${bullets(withdrawn)}`] : []),
  ].join('\n\n')
}

// A story update as the narrator's own calls, told against the view it held
// before, each named for what it brings: what it remembers, the story's
// arcs, then the player's standing OOC instructions. A change is told only
// for an entry in view, since on its own it can't be read; forgotten entries
// go unsaid.
export function storyUpdateCalls(
  update: StoryUpdate,
  view: NarratorView,
): { name: string; result: string }[] {
  const memories: string[] = []
  if (update.recalled) memories.push(`# Remembered\n\n${buildMemoryPayload(update.recalled)}`)
  const changed = Object.entries(update.changed ?? {}).filter(([name]) => view.memory.has(name))
  if (changed.length) memories.push(`# Changed\n\n${buildMemoryPayload(Object.fromEntries(changed))}`)
  const ooc = update.ooc ? renderOocUpdate(update.ooc, view.ooc) : ''
  return [
    ...(memories.length ? [{ name: RECALL_MEMORIES_TOOL.name, result: memories.join('\n\n') }] : []),
    ...(update.arcs
      ? [{ name: GET_STORY_ARCS_TOOL.name, result: `# Story arcs\n\n${buildPlotPayload(update.arcs)}` }]
      : []),
    ...(ooc ? [{ name: GET_OOC_INSTRUCTIONS_TOOL.name, result: ooc }] : []),
  ]
}

// The narrator's notes for the reply being written: the scene as it stands
// and the steer. Empty when there is nothing to note.
export function buildReplyNotes(
  briefing: BriefingCall[],
  data: StoryData,
  flags: ContextFlags,
): string {
  const sections: string[] = []
  if (flags.includeWorldState && Object.keys(data.state).length) {
    sections.push(`# Scene\n\n${buildStatePayload(data.state)}`)
  }
  if (flags.includePlotOutline) {
    const steers = briefingArgs(briefing, STEER_TOOL.name)
      .map((a) => (typeof a.text === 'string' ? a.text.trim() : ''))
      .filter(Boolean)
    if (steers.length) sections.push(`# Steer\n\n${steers.join('\n\n')}`)
  }
  return sections.join('\n\n')
}

// One of the narrator's own calls and its result.
function ownCallMessages(id: string, name: string, content: string): ModelMessage[] {
  return [
    { role: 'assistant', content: '', toolCalls: [{ id, name, arguments: '{}' }] },
    { role: 'tool', toolCallId: id, content },
  ]
}

// The notes as the DM's own call. The id is fixed: the notes appear once, in
// the tail, and are never replayed.
export function buildReplyNotesMessages(notes: string): ModelMessage[] {
  return notes ? ownCallMessages('dm-get-steer', GET_STEER_TOOL.name, notes) : []
}

// A story update as the DM's own calls, their ids derived from the turn so
// the replay is byte-stable.
export function buildStoryUpdateMessages(
  turnId: string,
  update: StoryUpdate,
  view: NarratorView,
): ModelMessage[] {
  return storyUpdateCalls(update, view).flatMap((c) =>
    ownCallMessages(`dm-${turnId.slice(0, 8)}-${c.name.replace(/_/g, '-')}`, c.name, c.result),
  )
}

// The first step's calls take their ids from the last folded turn, which is
// never replayed, so they hold until the next fold and match no live turn's.
function synopsisStepId(folded: Turn[]): string {
  return folded.at(-1)?.id ?? ''
}

// History replays the durable story: each turn's input, its story update for
// the narrator, and its narration prose. For the narrator, the first step of
// story updates comes first, told against nothing in view, and each turn's is
// told against the view the steps before it left. The Plotter gets the
// records whole in its tail, so the story updates are the narrator's alone.
// The opening and Continue inputs stay too — they are fixed short strings,
// they keep user/assistant roles alternating, and dropping them once the turn
// completed would remove bytes an earlier request already sent. Other tool
// activity and reasoning are ephemeral scaffolding of the turn that produced
// them — each role gets what it needs fresh in its tail, and stale snapshots
// would only bloat the transcript.
function buildHistoryMessages(
  history: Turn[],
  includePriorPlayerTurns: boolean,
  role: 'narrator' | 'plotter',
  folded: Turn[],
  flags: ContextFlags,
): ModelMessage[] {
  const messages: ModelMessage[] = []
  let view = NOTHING_IN_VIEW
  const tell = (id: string, update: StoryUpdate | undefined) => {
    if (!update || role !== 'narrator') return
    messages.push(...buildStoryUpdateMessages(id, update, view))
    view = applyStoryUpdate(view, update)
  }
  tell(synopsisStepId(folded), synopsisStoryUpdate(folded, flags))
  for (let i = 0; i < history.length; i++) {
    const t = history[i]
    // A failed turn has no narration to replay, and its input was never
    // answered — replaying either would present the failure as story.
    if (t.reply.error) continue
    const isLast = i === history.length - 1
    const hasReply = !!t.reply.text
    const inputIsHistorical = !isLast && hasReply
    const includeInput =
      t.input !== undefined &&
      (includePriorPlayerTurns || !inputIsHistorical || t.kind !== 'player')
    if (includeInput) {
      messages.push({ role: 'user', content: t.input ?? '' })
    }
    tell(t.id, t.storyUpdate)
    if (hasReply) {
      messages.push({ role: 'assistant', content: t.reply.text ?? '' })
    }
  }
  return messages
}

function chronicleMessages(chronicle: Chronicle): ModelMessage[] {
  const message = buildChronicleSystemMessage(chronicle)
  return message ? [message] : []
}

// A trailing directive in the role the settings choose.
function directiveMessage(content: string, asSystem: boolean): ModelMessage {
  // The alternative is an extra user message wrapped in (OOC: ...). The
  // dm-system prompt documents OOC-in-parens as the player's directive
  // convention, so this lands as in-channel guidance rather than out-of-band
  // system noise.
  return asSystem ? { role: 'system', content } : { role: 'user', content: `(OOC: ${content})` }
}

// The narrator's request: it writes the reply from the story, its story
// updates, and its notes for this reply, with no tools. The latest turn
// carries the story update just made.
export function buildNarratorSections(args: ModelMessagesArgs): RequestSections {
  return {
    system: buildFrameMessages(args, args.systemPrompt, 'narrator'),
    chronicle: chronicleMessages(args.chronicle),
    history: buildHistoryMessages(args.history, args.includePriorPlayerTurns, 'narrator', args.folded, args.flags),
    tail: [
      ...buildReplyNotesMessages(buildReplyNotes(args.briefing ?? [], args.data, args.flags)),
      directiveMessage(
        buildTurnReminder(args.history.at(-1)?.kind, args.history.at(-1)?.input),
        args.reminderAsSystem,
      ),
    ],
  }
}

export function buildNarratorMessages(args: ModelMessagesArgs): ModelMessage[] {
  return flattenSections(buildNarratorSections(args))
}

export interface PlotterMessagesArgs extends ModelMessagesArgs {
  // The instruction that sets the Plotter to work on the player's input.
  pivot: string
}

// The Plotter's request: the story's inputs and replies up to the player's
// latest input, the records whole as tool results, then its instruction.
export function buildPlotterSections(args: PlotterMessagesArgs): RequestSections {
  return {
    system: buildFrameMessages(args, plotterSystemPrompt(), 'plotter'),
    chronicle: chronicleMessages(args.chronicle),
    history: buildHistoryMessages(args.history, args.includePriorPlayerTurns, 'plotter', args.folded, args.flags),
    tail: [
      ...buildContextInjectionMessages(args.data, args.flags),
      directiveMessage(args.pivot, args.reminderAsSystem),
    ],
  }
}

export function buildPlotterMessages(args: PlotterMessagesArgs): ModelMessage[] {
  return flattenSections(buildPlotterSections(args))
}
