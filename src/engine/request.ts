// Composes the provider-neutral conversations sent through the model boundary.
// Pure functions — given turns + records + flags, returns model messages.
//
// Each turn sends two requests, one per role. The Plotter goes first: it reads
// the full records, records what the last reply established, decides how the
// world answers the player, and briefs the narrator. The narrator then writes
// the reply from the story and that briefing alone. Each request is laid out
// front to back as:
//
//   1. Stable prefix — the role's own system prompt (the narrator's writing
//      brief, or the Plotter's directing brief), NSFW stance, adventure
//      slots, then the Plotter's full rules for each enabled record, or the
//      narrator's short note on reading its notes, then the chronicle.
//      Changes rarely (settings edits, compactions).
//   2. History — append-only between compactions: each turn's input (player
//      text, or the fixed bootstrap / Continue directive), its story update,
//      and its narration prose, so nothing sent once is later removed. The
//      story update — memory entries newly recalled, or already in view and
//      changed, and the OOC list when it changed — sits between the input and
//      the reply as one call the DM appears to have made, saved with the turn
//      so it replays byte for byte. Other tool calls and reasoning are never
//      replayed. A failed turn produced no narration and is skipped entirely.
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

import {
  NSFW_OFF_PROMPT,
  NSFW_ON_PROMPT,
  PLOTTER_SYSTEM_PROMPT,
  buildTurnReminder,
  narratorNotesText,
} from '../prompts'
import { buildChronicleSystemMessage } from './chronicle'
import { ADVENTURE_SLOTS } from './config'
import {
  CHECK_MEMORY_TOOL,
  CHECK_OOC_TOOL,
  CHECK_PLOT_PLAN_TOOL,
  CHECK_STATE_TOOL,
  GET_OOC_INSTRUCTIONS_TOOL,
  GET_STEER_TOOL,
  PLOT_PLAN_TOOL,
  RECALL_MEMORIES_TOOL,
  RECALL_MEMORY_TOOL,
  STEER_TOOL,
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
  return `${def.header}\n\n${def.framing}\n\n${value}`
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
    : '(no future plot plan yet)'
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
// descriptions carry its rules), injection payload, status hints, and the
// narrator's note — so every consumer (seeded injection, tool advertisement,
// live re-reads, the Plotter's instruction, the narrator's note) iterates
// this table. A subsystem that is switched off cannot be mentioned anywhere,
// by construction.
export interface ContextSubsystem {
  enabled(flags: ContextFlags): boolean
  checkTool: ModelToolDefinition
  updateTool: ModelToolDefinition
  // Further Plotter tools that brief the narrator: recall for memory, steer
  // for the plot plan.
  briefTools: readonly ModelToolDefinition[]
  // Heads this subsystem's status line in the Plotter's instruction.
  label: string
  // The narrator's line on what this subsystem puts in its notes, or after
  // them. Without the rules for keeping the record.
  narratorNote: string
  // The tool-result content for the check tool: the current data, nothing
  // else. Served in the seeded injection and for live re-reads.
  buildPayload(data: StoryData): string
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
    narratorNote: narratorNotesText('memory', { call: RECALL_MEMORIES_TOOL.name }),
    buildPayload: (data) => buildMemoryPayload(data.memory),
    buildGuidance: (data) => buildMemoryGuidance(data.memory),
  },
  {
    enabled: (flags) => flags.includePlotOutline,
    checkTool: CHECK_PLOT_PLAN_TOOL,
    updateTool: PLOT_PLAN_TOOL,
    briefTools: [STEER_TOOL],
    label: 'Plot plan',
    narratorNote: narratorNotesText('plot', { call: GET_STEER_TOOL.name }),
    buildPayload: (data) => buildPlotPayload(data.plot),
    buildGuidance: () => '',
  },
  {
    enabled: (flags) => flags.includeWorldState,
    checkTool: CHECK_STATE_TOOL,
    updateTool: UPDATE_STATE_TOOL,
    briefTools: [],
    label: 'Live state',
    narratorNote: narratorNotesText('state', { call: GET_STEER_TOOL.name }),
    buildPayload: (data) => buildStatePayload(data.state),
    buildGuidance: (data, stateCleanupThreshold) =>
      buildStateGuidance(data.state, stateCleanupThreshold),
  },
  {
    enabled: (flags) => flags.includeOoc,
    checkTool: CHECK_OOC_TOOL,
    updateTool: UPDATE_OOC_TOOL,
    briefTools: [],
    label: 'OOC instructions',
    narratorNote: narratorNotesText('ooc', { call: GET_OOC_INSTRUCTIONS_TOOL.name }),
    buildPayload: (data) => buildOocPayload(data.ooc),
    buildGuidance: () => '',
  },
]

// The narrator's own calls that bring a turn's story update, as the enabled
// records make them.
function storyUpdateTools(flags: ContextFlags): ModelToolDefinition[] {
  return [
    ...(flags.includeMemory ? [RECALL_MEMORIES_TOOL] : []),
    ...(flags.includeOoc ? [GET_OOC_INSTRUCTIONS_TOOL] : []),
  ]
}

function hasReplyNotes(flags: ContextFlags): boolean {
  return flags.includeWorldState || flags.includePlotOutline
}

// The narrator's note on its notes for its stable prefix: which calls bring
// them, then one line per enabled record. Null when nothing is enabled.
export function buildNarratorNotesMessage(flags: ContextFlags): ModelMessage | null {
  const lines = CONTEXT_SUBSYSTEMS.filter((s) => s.enabled(flags)).map(
    (s) => `- ${s.narratorNote}`,
  )
  if (!lines.length) return null
  const updates = storyUpdateTools(flags).map((t) => `\`${t.name}\``)
  const intro = [
    narratorNotesText('intro'),
    ...(updates.length ? [narratorNotesText('story-update', { calls: updates.join(' and ') })] : []),
    ...(hasReplyNotes(flags) ? [narratorNotesText('reply-notes', { replyNotes: GET_STEER_TOOL.name })] : []),
    narratorNotesText('close'),
  ].join(' ')
  return { role: 'system', content: `${intro}\n\n${lines.join('\n')}` }
}

// The tools the Plotter is offered: each enabled subsystem's update, read,
// and briefing tools.
export function buildPlotterTools(flags: ContextFlags): ModelToolDefinition[] {
  return CONTEXT_SUBSYSTEMS.filter((s) => s.enabled(flags)).flatMap((s) => [
    s.updateTool,
    s.checkTool,
    ...s.briefTools,
  ])
}

// The Plotter's seeded tool exchange delivering the volatile working data.
// Call ids are fixed: the injection appears exactly once per request and is
// never persisted or replayed, and stable bytes maximise provider prefix-cache
// hits.
export function buildContextInjectionMessages(
  data: StoryData,
  flags: ContextFlags,
): ModelMessage[] {
  const calls: ModelToolCall[] = []
  const results: ModelMessage[] = []
  for (const s of CONTEXT_SUBSYSTEMS) {
    if (!s.enabled(flags)) continue
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
  // Stable prefix: system prompt, NSFW stance, slots, and the note on its
  // notes (narrator) or the records' rules (Plotter).
  system: ModelMessage[]
  chronicle: ModelMessage[]
  history: ModelMessage[]
  // The volatile tail, rebuilt every turn.
  tail: ModelMessage[]
}

export function flattenSections(sections: RequestSections): ModelMessage[] {
  return [...sections.system, ...sections.chronicle, ...sections.history, ...sections.tail]
}

// The head of a role's stable prefix: its own system prompt, then the
// content stance and the adventure slots. The narrator gets every slot; the
// Plotter leaves out the narrator's writing guidance.
function buildFrameMessages(
  args: ModelMessagesArgs,
  systemPrompt: string,
  role: 'narrator' | 'plotter',
): ModelMessage[] {
  const messages: ModelMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: args.nsfw ? NSFW_ON_PROMPT : NSFW_OFF_PROMPT },
  ]
  for (const def of ADVENTURE_SLOTS) {
    const value = (args.slots[def.key] ?? '').trim()
    if (!value || (role === 'plotter' && def.narratorOnly)) continue
    messages.push({ role: 'system', content: buildSlotMessage(def, value) })
  }
  return messages
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
    const change = Object.hasOwn(before, key) ? diffJson(before[key], value) : value
    if (change !== undefined) changes.push([key, change])
  }
  for (const key of Object.keys(before)) {
    if (!Object.hasOwn(after, key)) changes.push([key, null])
  }
  return Object.fromEntries(changes)
}

// Applies a change made by diffJson.
function applyJsonChange(base: JsonValue, change: JsonValue): JsonValue {
  if (!isPlainObject(base) || !isPlainObject(change)) return change
  const merged = new Map(Object.entries(base))
  for (const [key, value] of Object.entries(change)) {
    if (value === null) merged.delete(key)
    else merged.set(key, Object.hasOwn(base, key) ? applyJsonChange(base[key], value) : value)
  }
  return Object.fromEntries(merged)
}

// What the turn adds to the narrator's history, from the Plotter's briefing
// and the records as they stand after its updates: memory entries recalled
// that the narrator doesn't hold, in full; for entries it holds, only what
// has changed since, so nothing unchanged is said again; and the OOC list
// when it differs from the latest one in view, or has dropped out of view
// with compaction. `earlier` is the history in view before this turn.
// Undefined when there is nothing to add.
export function buildStoryUpdate(
  earlier: Turn[],
  briefing: BriefingCall[],
  data: StoryData,
  flags: ContextFlags,
): StoryUpdate | undefined {
  // The narrator's view of memory: entries it has been given in full, with
  // later changes applied. A change to an entry whose full version is out of
  // view can't be read on its own, so that entry counts as not held.
  const view = new Map<string, JsonValue>()
  for (const t of earlier) {
    if (t.reply.error || !t.storyUpdate) continue
    for (const [name, entry] of Object.entries(t.storyUpdate.recalled ?? {})) view.set(name, entry)
    for (const [name, change] of Object.entries(t.storyUpdate.changed ?? {})) {
      const held = view.get(name)
      if (held !== undefined) view.set(name, applyJsonChange(held, change))
    }
  }
  const oocBefore = oocInView(earlier)
  const update: StoryUpdate = {}
  if (flags.includeMemory) {
    // Newly recalled entries, then those the narrator already holds: once
    // recalled, an entry is kept current without being recalled again.
    const recalledNames = briefingArgs(briefing, RECALL_MEMORY_TOOL.name).flatMap((a) =>
      Array.isArray(a.names) ? a.names.filter((n): n is string => typeof n === 'string') : [],
    )
    const recalled: [string, JsonValue][] = []
    const changed: [string, JsonValue][] = []
    for (const name of new Set([...recalledNames, ...view.keys()])) {
      if (!Object.hasOwn(data.memory, name)) continue
      const current = data.memory[name]
      const held = view.get(name)
      if (held === undefined) {
        recalled.push([name, current])
        continue
      }
      const change = diffJson(held, current)
      if (change !== undefined) changed.push([name, change])
    }
    if (recalled.length) update.recalled = Object.fromEntries(recalled)
    if (changed.length) update.changed = Object.fromEntries(changed)
  }
  if (flags.includeOoc) {
    const oocChanged = oocBefore
      ? JSON.stringify(oocBefore) !== JSON.stringify(data.ooc)
      : data.ooc.length > 0
    if (oocChanged) update.ooc = [...data.ooc]
  }
  return Object.keys(update).length ? update : undefined
}

// The OOC list the narrator was last given in these turns. Undefined at the
// start of the story, and once compaction has folded it away.
export function oocInView(turns: Turn[]): string[] | undefined {
  let list: string[] | undefined
  for (const t of turns) {
    if (!t.reply.error && t.storyUpdate?.ooc) list = t.storyUpdate.ooc
  }
  return list
}

// The OOC instructions as the narrator gets them: the whole list when it has
// none in view, at the start of the story or after compaction; after that,
// only what was added and what was withdrawn. Empty when only the order
// changed.
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

// A story update as the narrator's own calls, each named for what it brings:
// what it remembers, then the player's standing OOC instructions. `oocBefore`
// is the OOC list in view before this update.
export function storyUpdateCalls(
  update: StoryUpdate,
  oocBefore: string[] | undefined,
): { name: string; result: string }[] {
  const memories: string[] = []
  if (update.recalled) memories.push(`# Remembered\n\n${buildMemoryPayload(update.recalled)}`)
  if (update.changed) memories.push(`# Changed\n\n${buildMemoryPayload(update.changed)}`)
  const ooc = update.ooc ? renderOocUpdate(update.ooc, oocBefore) : ''
  return [
    ...(memories.length ? [{ name: RECALL_MEMORIES_TOOL.name, result: memories.join('\n\n') }] : []),
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

// A turn's story update as the DM's own calls, their ids derived from the
// turn so the replay is byte-stable.
export function buildStoryUpdateMessages(
  turnId: string,
  update: StoryUpdate,
  oocBefore: string[] | undefined,
): ModelMessage[] {
  return storyUpdateCalls(update, oocBefore).flatMap((c) =>
    ownCallMessages(`dm-${turnId.slice(0, 8)}-${c.name.replace(/_/g, '-')}`, c.name, c.result),
  )
}

// History replays the durable story: each turn's input, its story update, and
// its narration prose. Bootstrap and Continue directives stay too — they are
// fixed short strings, they keep user/assistant roles alternating, and
// dropping them once the turn completed would remove bytes an earlier request
// already sent. Other tool activity and reasoning are ephemeral scaffolding of
// the turn that produced them — each role gets what it needs fresh in its
// tail, and stale snapshots would only bloat the transcript.
function buildHistoryMessages(history: Turn[], includePriorPlayerTurns: boolean): ModelMessage[] {
  const messages: ModelMessage[] = []
  // The OOC list given so far, which each later update is told against.
  let oocBefore: string[] | undefined
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
    if (t.storyUpdate) {
      messages.push(...buildStoryUpdateMessages(t.id, t.storyUpdate, oocBefore))
      if (t.storyUpdate.ooc) oocBefore = t.storyUpdate.ooc
    }
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
  const notes = buildNarratorNotesMessage(args.flags)
  return {
    system: [...buildFrameMessages(args, args.systemPrompt, 'narrator'), ...(notes ? [notes] : [])],
    chronicle: chronicleMessages(args.chronicle),
    history: buildHistoryMessages(args.history, args.includePriorPlayerTurns),
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

// The Plotter's request: the same story up to the player's latest input, the
// full rules, the records as tool results, then its instruction.
export function buildPlotterSections(args: PlotterMessagesArgs): RequestSections {
  return {
    system: buildFrameMessages(args, PLOTTER_SYSTEM_PROMPT, 'plotter'),
    chronicle: chronicleMessages(args.chronicle),
    history: buildHistoryMessages(args.history, args.includePriorPlayerTurns),
    tail: [
      ...buildContextInjectionMessages(args.data, args.flags),
      directiveMessage(args.pivot, args.reminderAsSystem),
    ],
  }
}

export function buildPlotterMessages(args: PlotterMessagesArgs): ModelMessage[] {
  return flattenSections(buildPlotterSections(args))
}
