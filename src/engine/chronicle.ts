// Chronicle: structured, recursive compaction of older turns.
//
// The chronicle is `Chronicle = ChronicleEntry[][]`. chronicle[0] holds the
// newest, least-compressed summaries; higher indices hold older, more
// heavily compressed material. Each entry is roughly one turn long.
//
// The chronicle is an index over the complete history. Each entry points at
// the run of turns it summarises; read in story order, the entries cover the
// folded turns from the first onward with no gaps or overlaps, and the turns
// after the last entry are live. The history is never trimmed, so the model's
// view can be rebuilt at any time from the turns and the chronicle, and the
// cutoff between folded and live turns follows from the index.
//
// Algorithm (N = compactionThreshold, floor = compactionFloor, M =
// compactionBatch), tuned so compaction events are rare: every chronicle
// change rewrites the chronicle system message and advances the cutoff,
// invalidating the provider's cached prefix for the whole history, so all
// rewriting is clustered into one drain event every (N - floor) turns.
//
// 1. When (turns.length - cutoff) >= N, drain the live tail down to `floor`
//    turns in one event: fold sub-batches of M turns into one chronicle[0]
//    entry each, in story order. Between events the chronicle and cutoff are
//    frozen.
// 2. After folding, if chronicle[k].length >= N for some k, take the first
//    M entries at level k, summarise the turns they cover into one entry,
//    and append it to chronicle[k+1]. Recurse. Levels only
//    grow during folds, so promotions can only fire inside a drain event.
// 3. If level k is the topmost and gets compacted, chronicle gains a new
//    level k+1.
//
// All summarisation goes through runSummarizer (one model call per fold or
// promotion). Each summary is written with the story so far in view: the
// entries before its turns, as they stand when it is written. So the calls
// run one after another, each fold seeing the ones made before it.

import { runSummarizer, type SummaryTurn } from './agents/summarizer'
import type { ApiProtocol, ModelMessage, ReasoningEffort } from './model/types'
import type { Chronicle, ChronicleEntry, Turn } from './types'

export interface ChronicleSettings {
  compactionThreshold: number  // N — high watermark; also per-level promotion threshold
  compactionFloor: number      // drain target; clamped to at most N - M
  compactionBatch: number      // M — turns/entries folded per chronicle entry
}

// Every entry, at any level, is summarised from the turns it covers and may
// run to the average length of one of them: entries stay within "one
// turn-worth" of text however many turns they cover. A floor prevents
// pathologically tiny limits when turns are short.
const MIN_SUMMARY_CHARS = 180

function maxCharsFor(inputs: SummaryTurn[]): number {
  const total = inputs.reduce((n, t) => n + t.text.length, 0)
  return Math.max(MIN_SUMMARY_CHARS, Math.round(total / Math.max(1, inputs.length)))
}

export interface ChronicleAgentArgs {
  model: string
  reasoningEffort?: ReasoningEffort
  apiKey: string
  baseUrl: string
  protocol: ApiProtocol
  // The adventure's prompt-cache key; see ModelConnection.
  cacheKey?: string
}

// The texts of the chronicle's entries in story order: the highest level
// first, level 0 last.
function storyTexts(chronicle: Chronicle): string[] {
  return [...chronicle].reverse().flatMap((level) => level.map((entry) => entry.text))
}

// The chronicle with `entry` appended at `level`, adding the level if need be.
function withEntry(chronicle: Chronicle, level: number, entry: ChronicleEntry): Chronicle {
  const next = chronicle.slice()
  while (next.length <= level) next.push([])
  next[level] = [...next[level], entry]
  return next
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

// Folds turns [start, end) into level-0 entries of up to `batch` turns each,
// one after another so each is written with the ones before it in view. A
// batch of nothing but failed turns has no story to summarise: its turns join
// the previous entry, or the next new one when there is none before, so the
// entries still cover the folded turns without gaps.
async function foldTurns(
  turns: Turn[],
  chronicle: Chronicle,
  start: number,
  end: number,
  batch: number,
  agent: ChronicleAgentArgs,
  signal: AbortSignal,
  onProgress?: (label: string) => void,
): Promise<Chronicle> {
  let next = chronicle
  let pendingFirst: string | undefined
  const count = Math.ceil((end - start) / batch)
  for (let c = start, i = 1; c < end; c += batch, i++) {
    onProgress?.(`Folding turns into chronicle… ${i} of ${count}`)
    const last = Math.min(c + batch, end)
    const inputs = turnsForSummary(turns, c, last)
    if (!inputs.length) {
      const extended = extendLastEntry(next, turns[last - 1].id)
      if (extended) next = extended
      else pendingFirst ??= turns[c].id
      continue
    }
    next = withEntry(next, 0, {
      id: crypto.randomUUID(),
      text: await summarise(storyTexts(next), inputs, agent, signal),
      firstTurnId: pendingFirst ?? turns[c].id,
      lastTurnId: turns[last - 1].id,
      createdAt: Date.now(),
    })
    pendingFirst = undefined
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

async function summarise(
  storySoFar: string[],
  inputs: SummaryTurn[],
  agent: ChronicleAgentArgs,
  signal: AbortSignal,
): Promise<string> {
  const result = await runSummarizer(
    {
      model: agent.model,
      reasoningEffort: agent.reasoningEffort,
      apiKey: agent.apiKey,
      baseUrl: agent.baseUrl,
      protocol: agent.protocol,
      cacheKey: agent.cacheKey,
      storySoFar,
      turns: inputs,
      maxChars: maxCharsFor(inputs),
    },
    signal,
  )
  return result.summary
}

// One pass through the cascade: fold raw turns into chronicle[0] if eligible,
// then promote upward as long as any level is over threshold, one level per
// iteration. Loop until no further compaction is triggered. A forced pass, for testing what follows compaction, folds every
// live turn but the latest whether or not the threshold is reached.
export async function compactCascade(
  turns: Turn[],
  chronicle: Chronicle,
  settings: ChronicleSettings,
  agent: ChronicleAgentArgs,
  signal: AbortSignal,
  onProgress?: (label: string) => void,
  force = false,
): Promise<Chronicle> {
  const N = Math.max(2, settings.compactionThreshold)
  const M = Math.max(1, Math.min(settings.compactionBatch, N - 1))
  // Drain target. Clamping to N - M guarantees an event folds at least one
  // full sub-batch (and reproduces legacy fold-one-batch behaviour for stored
  // configs whose threshold predates the floor setting).
  const low = Math.max(0, Math.min(settings.compactionFloor, N - M))
  const index = new Map(turns.map((t, i) => [t.id, i]))
  let next = chronicle

  // Outer loop: keep compacting until nothing is over threshold.
  // Bounded by total possible operations (turns / M) plus levels.
  const HARD_CAP = 64
  for (let safety = 0; safety < HARD_CAP; safety++) {
    // Step 1: drain raw turns if over the high watermark — fold sub-batches
    // of M down to the floor in one event.
    const cutoff = chronicleCutoff(next, turns)
    const live = turns.length - cutoff
    const forcing = force && live > 1
    if (live >= N || forcing) {
      const targetCutoff = turns.length - (forcing ? 1 : low)
      const folded = await foldTurns(turns, next, cutoff, targetCutoff, M, agent, signal, onProgress)
      // Failed turns with no entry to join stay live: nothing more to fold.
      if (chronicleCutoff(folded, turns) === cutoff) break
      next = folded
      continue
    }

    // Step 2: promote any level that's over threshold. Process bottom-up so
    // each pass touches at most one level (cleaner reasoning). The promoted
    // entry is summarised afresh from the turns its entries cover, not from
    // their summaries, so what a lower summary left out isn't lost for good;
    // the levels above, which hold the story before them, are its story so
    // far.
    let promoted = false
    for (let level = 0; level < next.length; level++) {
      if (next[level].length < N) continue
      onProgress?.(`Compacting chronicle level ${level}…`)
      const batch = next[level].slice(0, M)
      const firstTurnId = batch[0].firstTurnId
      const lastTurnId = batch[batch.length - 1].lastTurnId
      const start = index.get(firstTurnId) ?? 0
      const end = (index.get(lastTurnId) ?? start) + 1
      const newEntry: ChronicleEntry = {
        id: crypto.randomUUID(),
        text: await summarise(storyTexts(next.slice(level + 1)), turnsForSummary(turns, start, end), agent, signal),
        firstTurnId,
        lastTurnId,
        createdAt: Date.now(),
      }
      const remaining = next.map((lvl, i) => (i === level ? lvl.slice(M) : lvl))
      next = withEntry(remaining, level + 1, newEntry)
      promoted = true
      break // restart from the bottom; promotions can cascade
    }
    if (promoted) continue

    // Nothing over threshold and no raw fold pending → done.
    break
  }
  return next
}

// The chronicle with every entry written afresh from the turns it covers,
// each keeping its place and its turns: for after the summariser or its
// prompt has changed. The entries are written in story order, each with the
// ones rewritten before it as its story so far. An entry with no narrated
// turns to read keeps its text.
export async function rebuildChronicle(
  turns: Turn[],
  chronicle: Chronicle,
  agent: ChronicleAgentArgs,
  signal: AbortSignal,
  onProgress?: (writing: number, total: number) => void,
): Promise<Chronicle> {
  const ranges = chronicleRanges(chronicle, turns) ?? []
  const texts = new Map<string, string>()
  const storySoFar: string[] = []
  for (const [i, { entry, start, end }] of ranges.entries()) {
    onProgress?.(i + 1, ranges.length)
    const inputs = turnsForSummary(turns, start, end)
    const text = inputs.length ? await summarise(storySoFar.slice(), inputs, agent, signal) : entry.text
    if (inputs.length) texts.set(entry.id, text)
    storySoFar.push(text)
  }
  const createdAt = Date.now()
  return chronicle.map((level) =>
    level.map((entry) => {
      const text = texts.get(entry.id)
      return text === undefined ? entry : { ...entry, text, createdAt }
    }),
  )
}

// A forced compaction has something to fold once there is a live turn
// before the latest.
export function canForceCompaction(turns: Turn[], chronicle: Chronicle): boolean {
  return turns.length - chronicleCutoff(chronicle, turns) > 1
}

export function chronicleNeedsCompaction(
  turns: Turn[],
  chronicle: Chronicle,
  settings: ChronicleSettings,
): boolean {
  const N = Math.max(2, settings.compactionThreshold)
  if (turns.length - chronicleCutoff(chronicle, turns) >= N) return true
  for (const level of chronicle) {
    if (level.length >= N) return true
  }
  return false
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

// Render the chronicle as a single system message with level-headed sections,
// oldest level first, newest level last. Returns null when there's nothing
// to render so callers can skip injecting an empty message.
export function buildChronicleSystemMessage(chronicle: Chronicle): ModelMessage | null {
  if (chronicle.length === 0 || totalChronicleEntries(chronicle) === 0) {
    return null
  }
  const sections: string[] = []
  // Iterate from highest level (oldest) down to 0 (newest).
  for (let level = chronicle.length - 1; level >= 0; level--) {
    const entries = chronicle[level]
    if (entries.length === 0) continue
    const isTop = level === chronicle.length - 1
    const header = isTop ? '## Earliest (most compressed)' : '## More recent'
    const body = entries.map((e) => e.text).join('\n\n')
    sections.push(`${header}\n\n${body}`)
  }
  const intro =
    `# Story so far\n\n` +
    `Earlier turns, condensed: the first section is the distant past in brief, and ` +
    `each later section is more recent and more detailed. All of it is canon, read as ` +
    `story whatever its wording.`
  return {
    role: 'system',
    content: `${intro}\n\n${sections.join('\n\n')}`,
  }
}

// Strip per-call traces from any reply that's behind the cutoff. Same role as
// the old stripTracesBefore — those traces were only useful for inspecting
// the most recent turn, and dropping them keeps storage / save files small.
export function stripTracesBefore(turns: Turn[], cutoff: number): Turn[] {
  let changed = false
  const next = turns.map((t, i) => {
    if (
      i >= cutoff ||
      (!t.reply.trace && !t.narrator?.trace && !t.plotter && !t.storyUpdate && !t.briefing)
    ) {
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
    // The plotter call is nothing but trace, and the story update and an old
    // briefing are only ever replayed to the model, which no longer sees this
    // turn — drop them all.
    return { ...t, reply, narrator, plotter: undefined, storyUpdate: undefined, briefing: undefined }
  })
  return changed ? next : turns
}
