// Chronicle: one running summary of the older turns.
//
// The chronicle is stored as `Chronicle = ChronicleEntry[][]`. Compaction
// leaves a single entry covering every folded turn from the first onward. A
// chronicle saved with several entries reads in story order, the highest level
// first, until its next compaction folds it into that one summary.
//
// The chronicle is an index over the complete history. Each entry points at
// the run of turns it summarises; read in story order, the entries cover the
// folded turns from the first onward with no gaps or overlaps, and the turns
// after the last entry are live. The history is never trimmed, so the model's
// view can be rebuilt at any time from the turns and the chronicle, and the
// cutoff between folded and live turns follows from the index.
//
// Compaction (N = compactionThreshold, floor = compactionFloor) is tuned so
// events are rare: every chronicle change rewrites the chronicle system
// message and advances the cutoff, invalidating the provider's cached prefix
// for the whole history, so all rewriting is clustered into one event every
// (N - floor) turns. Between events the chronicle and cutoff are frozen.
//
// When (turns.length - cutoff) >= N, an event drains the live tail down to
// `floor` turns: the summary is rewritten from its last version and the real
// turns being folded in. A longer backlog, after the chronicle is cleared or
// rebuilt, is taken in stretches of (N - floor) turns, one model call each,
// every rewrite reading the summary left by the one before.

import { runSummarizer, type SummarizerInput, type SummaryTurn } from './agents/summarizer'
import type { ApiProtocol, ModelMessage, ReasoningEffort } from './model/types'
import type { Chronicle, ChronicleEntry, Turn } from './types'

export interface ChronicleSettings {
  compactionThreshold: number  // N — high watermark; also per-level promotion threshold
  compactionFloor: number      // drain target; see drainFloor
  summaryTargetChars: number   // the length the summary's story so far aims for
}

// The drain target. An event has to fold something, so a floor at or above N,
// from a stored threshold set below the default floor, counts as half of N.
function drainFloor(settings: ChronicleSettings, N: number): number {
  const floor = Math.max(0, settings.compactionFloor)
  return floor < N ? floor : Math.floor(N / 2)
}

// How many turns one rewrite of the summary reads: the turns of one event.
function stretchLength(settings: ChronicleSettings): number {
  const N = Math.max(2, settings.compactionThreshold)
  return N - drainFloor(settings, N)
}

export interface ChronicleAgentArgs {
  model: string
  reasoningEffort?: ReasoningEffort
  apiKey: string
  baseUrl: string
  protocol: ApiProtocol
  // The adventure's prompt-cache key; see ModelConnection.
  cacheKey?: string
  // The adventure's scenario brief.
  scenario: string
}

// The chronicle's text in story order: the highest level first, level 0 last.
export function summaryText(chronicle: Chronicle): string {
  return [...chronicle].reverse().flatMap((level) => level.map((entry) => entry.text)).join('\n\n')
}

// The chronicle as one summary with this text, covering the same turns. Blank
// text removes it, and the model sees those turns in full again.
export function withSummaryText(chronicle: Chronicle, turns: Turn[], text: string): Chronicle {
  const trimmed = text.trim()
  if (trimmed === summaryText(chronicle)) return chronicle
  if (!trimmed) return []
  const ranges = chronicleRanges(chronicle, turns)
  if (!ranges?.length) return chronicle
  return [[{
    id: crypto.randomUUID(),
    text: trimmed,
    firstTurnId: ranges[0].entry.firstTurnId,
    lastTurnId: ranges[ranges.length - 1].entry.lastTurnId,
    createdAt: Date.now(),
  }]]
}

// An entry with the turns it covers, as indices into the history (end
// exclusive).
export interface EntryRange {
  entry: ChronicleEntry
  level: number
  start: number
  end: number
}

// The chronicle in story order, each entry with its turns. Null when the
// entries don't cover the folded turns from the first onward without gaps or
// overlaps, or point at turns the history doesn't hold.
export function chronicleRanges(chronicle: Chronicle, turns: Turn[]): EntryRange[] | null {
  const index = new Map(turns.map((t, i) => [t.id, i]))
  const ranges: EntryRange[] = []
  let next = 0
  for (let level = chronicle.length - 1; level >= 0; level--) {
    for (const entry of chronicle[level]) {
      const start = index.get(entry.firstTurnId)
      const last = index.get(entry.lastTurnId)
      if (start !== next || last === undefined || last < start) return null
      ranges.push({ entry, level, start, end: last + 1 })
      next = last + 1
    }
  }
  return ranges
}

// Where the live turns start: just after the last entry's turns.
export function chronicleCutoff(chronicle: Chronicle, turns: Turn[]): number {
  return chronicleRanges(chronicle, turns)?.at(-1)?.end ?? 0
}

// Each entry's first and last turn, numbered from 1 as in the log.
export function entryTurnNumbers(chronicle: Chronicle, turns: Turn[]): Map<string, { first: number; last: number }> {
  return new Map((chronicleRanges(chronicle, turns) ?? []).map((r) => [r.entry.id, { first: r.start + 1, last: r.end }]))
}

// Whether two chronicles hold the same entries: the same object, or one
// loaded from storage with the same contents.
export function sameChronicle(a: Chronicle, b: Chronicle): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

// The chronicle without the given entries, still covering the same turns:
// each dropped entry's turns join the entry before it in story order, or the
// one after when it was the first.
export function withoutEntries(chronicle: Chronicle, ids: ReadonlySet<string>): Chronicle {
  const order = [...chronicle.keys()].reverse().flatMap((level) => chronicle[level].map((entry) => ({ entry, level })))
  const kept: { entry: ChronicleEntry; level: number }[] = []
  let carriedFirst: string | undefined
  for (const item of order) {
    if (!ids.has(item.entry.id)) {
      kept.push(carriedFirst ? { ...item, entry: { ...item.entry, firstTurnId: carriedFirst } } : item)
      carriedFirst = undefined
      continue
    }
    const previous = kept.at(-1)
    if (previous) previous.entry = { ...previous.entry, lastTurnId: item.entry.lastTurnId }
    else carriedFirst ??= item.entry.firstTurnId
  }
  const next: Chronicle = chronicle.map(() => [])
  for (const { entry, level } of kept) next[level].push(entry)
  return kept.length ? next : []
}

// An entry saved before entries pointed at their turns: it carried only how
// many turns it covered.
export interface LegacyChronicleEntry {
  id: string
  text: string
  turnsCovered: number
  createdAt: number
}

export type StoredChronicle = (ChronicleEntry | LegacyChronicleEntry)[][]

function isLegacyEntry(entry: ChronicleEntry | LegacyChronicleEntry): entry is LegacyChronicleEntry {
  return !('firstTurnId' in entry)
}

// A stored chronicle as an index over these turns. Legacy entries take their
// turns from their counts in story order; turns up to the old cutoff that no
// entry counted (batches of nothing but failed turns) join the last entry.
// A chronicle that can't be laid over the turns is dropped: its turns are
// live again, and the next compaction folds them afresh.
export function indexChronicle(stored: StoredChronicle, turns: Turn[], legacyCutoff = 0): Chronicle {
  const entries = stored.flat()
  if (!entries.some(isLegacyEntry)) {
    const chronicle = stored as Chronicle
    return chronicleRanges(chronicle, turns) ? chronicle : []
  }
  if (!entries.every(isLegacyEntry)) return []
  const levels: ChronicleEntry[][] = stored.map(() => [])
  let next = 0
  for (let level = stored.length - 1; level >= 0; level--) {
    for (const entry of stored[level] as LegacyChronicleEntry[]) {
      const count = Math.floor(entry.turnsCovered)
      if (count < 1) continue
      if (next + count > turns.length) return []
      levels[level].push({
        id: entry.id,
        text: entry.text,
        firstTurnId: turns[next].id,
        lastTurnId: turns[next + count - 1].id,
        createdAt: entry.createdAt,
      })
      next += count
    }
  }
  if (next === 0) return []
  const cutoff = Math.min(turns.length, Math.max(0, Math.floor(legacyCutoff)))
  const indexed = next < cutoff ? (extendLastEntry(levels, turns[cutoff - 1].id) ?? levels) : levels
  return chronicleRanges(indexed, turns) ? indexed : []
}

// The chronicle with its last entry in story order, the newest level's last,
// reaching on to `lastTurnId`. Null when it holds no entries.
function extendLastEntry(chronicle: Chronicle, lastTurnId: string): Chronicle | null {
  for (let level = 0; level < chronicle.length; level++) {
    const entries = chronicle[level]
    if (!entries.length) continue
    const updated = chronicle.slice()
    updated[level] = [...entries.slice(0, -1), { ...entries[entries.length - 1], lastTurnId }]
    return updated
  }
  return null
}

// One summariser call: the summary as it stands and turns [start, end).
function summarizerInput(
  turns: Turn[],
  chronicle: Chronicle,
  start: number,
  end: number,
  settings: ChronicleSettings,
  agent: ChronicleAgentArgs,
): SummarizerInput {
  return {
    model: agent.model,
    reasoningEffort: agent.reasoningEffort,
    apiKey: agent.apiKey,
    baseUrl: agent.baseUrl,
    protocol: agent.protocol,
    cacheKey: agent.cacheKey,
    scenario: agent.scenario,
    previousSummary: summaryText(chronicle),
    turns: turnsForSummary(turns, start, end),
    targetChars: settings.summaryTargetChars,
  }
}

// The next fold's first summariser call, as it stands: the summary so far
// and the oldest live turns, as many as one call reads, or fewer while the
// fold isn't due. `first` and `last` number those turns from 1. The fold runs
// after the next reply once `live` turns reach `threshold`, which `due` says.
export interface NextFold {
  first: number
  last: number
  live: number
  threshold: number
  due: boolean
  input: SummarizerInput
}

export function nextFold(
  turns: Turn[],
  chronicle: Chronicle,
  settings: ChronicleSettings,
  agent: ChronicleAgentArgs,
): NextFold {
  const cutoff = chronicleCutoff(chronicle, turns)
  const end = Math.min(cutoff + stretchLength(settings), turns.length)
  return {
    first: cutoff + 1,
    last: end,
    live: turns.length - cutoff,
    threshold: Math.max(2, settings.compactionThreshold),
    due: chronicleNeedsCompaction(turns, chronicle, settings),
    input: summarizerInput(turns, chronicle, cutoff, end, settings, agent),
  }
}

// Rewrites the summary to reach the end of turns [start, end), in stretches
// of `stretch` turns, one after another so each reads the summary the last one
// left. A stretch of nothing but failed turns has no story to tell: its turns
// join the summary, or the first one written when there is none yet, so the
// summary still covers the folded turns without gaps.
async function foldTurns(
  turns: Turn[],
  chronicle: Chronicle,
  start: number,
  end: number,
  settings: ChronicleSettings,
  agent: ChronicleAgentArgs,
  signal: AbortSignal,
  onStep?: (step: number, total: number) => void,
): Promise<Chronicle> {
  let next = chronicle
  const stretch = stretchLength(settings)
  const count = Math.ceil((end - start) / stretch)
  for (let c = start, i = 1; c < end; c += stretch, i++) {
    onStep?.(i, count)
    const last = Math.min(c + stretch, end)
    const input = summarizerInput(turns, next, c, last, settings, agent)
    if (!input.turns.length) {
      next = extendLastEntry(next, turns[last - 1].id) ?? next
      continue
    }
    const result = await runSummarizer(input, signal)
    next = summaryReaching(turns, last, result.summary)
  }
  return next
}

function renderTurnForSummary(t: Turn): string {
  // A failed turn produced no narration — there is nothing to fold.
  if (t.reply.error) return ''
  const lines: string[] = []
  if (t.input && t.kind === 'player') lines.push(`PLAYER: ${t.input}`)
  if (t.reply.text) lines.push(`DM: ${t.reply.text}`)
  return lines.join('\n\n')
}

// The turns in [start, end) as the summariser reads them, numbered as in the
// log, leaving out failed turns.
function turnsForSummary(turns: Turn[], start: number, end: number): SummaryTurn[] {
  const inputs: SummaryTurn[] = []
  for (let i = start; i < end; i++) {
    const text = renderTurnForSummary(turns[i])
    if (text) inputs.push({ number: i + 1, text })
  }
  return inputs
}

// The chronicle as one summary of turns [0, end).
function summaryReaching(turns: Turn[], end: number, text: string): Chronicle {
  return [[{
    id: crypto.randomUUID(),
    text,
    firstTurnId: turns[0].id,
    lastTurnId: turns[end - 1].id,
    createdAt: Date.now(),
  }]]
}

export interface CompactOptions {
  // Keep this many of the latest turns live, at least one, and fold the rest
  // now, whether or not a fold is due. With nothing left to fold, the summary
  // is written again from itself. Left out, the live turns are folded down to
  // the floor once they reach the threshold.
  keep?: number
  onProgress?: (label: string) => void
}

// Folds the live tail into the summary when a fold is due, or as `keep` asks.
export async function compactChronicle(
  turns: Turn[],
  chronicle: Chronicle,
  settings: ChronicleSettings,
  agent: ChronicleAgentArgs,
  signal: AbortSignal,
  { keep, onProgress }: CompactOptions = {},
): Promise<Chronicle> {
  const N = Math.max(2, settings.compactionThreshold)
  const cutoff = chronicleCutoff(chronicle, turns)
  if (keep === undefined && turns.length - cutoff < N) return chronicle
  const targetCutoff = turns.length - (keep === undefined ? drainFloor(settings, N) : Math.max(1, keep))
  if (targetCutoff <= cutoff) {
    onProgress?.('Rewriting the summary…')
    return rewriteSummary(turns, chronicle, settings, agent, signal)
  }
  return foldTurns(turns, chronicle, cutoff, targetCutoff, settings, agent, signal, (step, total) =>
    onProgress?.(`Folding turns into chronicle… ${step} of ${total}`),
  )
}

// The summary written again from itself, with no new turns: what the current
// prompt makes of it. With no summary, the chronicle is left as it is.
async function rewriteSummary(
  turns: Turn[],
  chronicle: Chronicle,
  settings: ChronicleSettings,
  agent: ChronicleAgentArgs,
  signal: AbortSignal,
): Promise<Chronicle> {
  const cutoff = chronicleCutoff(chronicle, turns)
  if (!cutoff) return chronicle
  const result = await runSummarizer(summarizerInput(turns, chronicle, cutoff, cutoff, settings, agent), signal)
  return summaryReaching(turns, cutoff, result.summary)
}

// The summary written afresh from the turns it covers, replaying compaction
// from the first turn: for after the summariser or its prompt has changed.
// With no narrated turns to read, the chronicle is left as it is.
export async function rebuildChronicle(
  turns: Turn[],
  chronicle: Chronicle,
  settings: ChronicleSettings,
  agent: ChronicleAgentArgs,
  signal: AbortSignal,
  onProgress?: (writing: number, total: number) => void,
): Promise<Chronicle> {
  const rebuilt = await foldTurns(turns, [], 0, chronicleCutoff(chronicle, turns), settings, agent, signal, onProgress)
  return rebuilt.length ? rebuilt : chronicle
}

// How many model calls a rebuild makes, at most.
export function rebuildCallCount(turns: Turn[], chronicle: Chronicle, settings: ChronicleSettings): number {
  return Math.ceil(chronicleCutoff(chronicle, turns) / stretchLength(settings))
}

// Compacting by hand has something to do: a live turn before the latest to
// fold, or a summary to write again.
export function canCompact(turns: Turn[], chronicle: Chronicle): boolean {
  return turns.length - chronicleCutoff(chronicle, turns) > 1 || chronicleCutoff(chronicle, turns) > 0
}

export function chronicleNeedsCompaction(
  turns: Turn[],
  chronicle: Chronicle,
  settings: ChronicleSettings,
): boolean {
  return turns.length - chronicleCutoff(chronicle, turns) >= Math.max(2, settings.compactionThreshold)
}

export function totalChronicleEntries(chronicle: Chronicle): number {
  return chronicle.reduce((n, level) => n + level.length, 0)
}

export function totalChronicleChars(chronicle: Chronicle): number {
  return chronicle.reduce(
    (n, level) => n + level.reduce((m, e) => m + e.text.length, 0),
    0,
  )
}

// The chronicle as a single system message, or null when there's nothing to
// render so callers can skip injecting an empty message.
export function buildChronicleSystemMessage(chronicle: Chronicle): ModelMessage | null {
  const story = summaryText(chronicle)
  return story ? { role: 'system', content: `# Story so far\n\n${story}` } : null
}

// Strip per-call traces from any reply that's behind the cutoff. Same role as
// the old stripTracesBefore — those traces were only useful for inspecting
// the most recent turn, and dropping them keeps storage / save files small.
// The story update stays: what the narrator was told in the folded turns is
// what it holds after the synopsis.
export function stripTracesBefore(turns: Turn[], cutoff: number): Turn[] {
  let changed = false
  const next = turns.map((t, i) => {
    if (i >= cutoff || (!t.reply.trace && !t.narrator?.trace && !t.plotter && !t.briefing)) {
      return t
    }
    changed = true
    const reply = { ...t.reply }
    delete reply.trace
    let narrator = t.narrator
    if (narrator?.trace) {
      narrator = { ...narrator }
      delete narrator.trace
    }
    // The plotter call is nothing but trace, and an old briefing is only
    // ever replayed to the model, which no longer sees this turn.
    return { ...t, reply, narrator, plotter: undefined, briefing: undefined }
  })
  return changed ? next : turns
}
