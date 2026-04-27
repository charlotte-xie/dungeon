// Chronicle: structured, recursive compaction of older turns.
//
// The chronicle is `Chronicle = ChronicleEntry[][]`. chronicle[0] holds the
// newest, least-compressed summaries; higher indices hold older, more
// heavily compressed material. Each entry is roughly entryTargetChars long.
//
// Algorithm (parameters N = compactionThreshold, M = compactionBatch):
//
// 1. After every turn, if (turns.length - cutoff) >= N, fold the M oldest
//    live turns into one chronicle[0] entry. Cutoff advances by M.
// 2. After folding, if chronicle[k].length >= N for some k, take the first
//    M entries at level k, summarize them into one entry of approximately
//    entryTargetChars, append it to chronicle[k+1]. Recurse.
// 3. If level k is the topmost and gets compacted, chronicle gains a new
//    level k+1.
//
// All summarization goes through runSummarizer (one xAI call per fold or
// promotion). Old turns stay in `turns[]` for inspection/replay; the cutoff
// just marks the boundary the model sees as "summarized".

import { runSummarizer } from './agents/summarizer'
import type {
  AdventureSlots,
  ApiMessage,
  Chronicle,
  ChronicleEntry,
  Turn,
} from './types'

export interface ChronicleSettings {
  compactionThreshold: number  // N
  compactionBatch: number      // M
}

// Each summary targets 1/M of the combined input length — so compression
// ratio stays constant across levels and entries end up roughly "one
// turn-worth" of text regardless of how long individual inputs were. A
// floor prevents pathologically tiny targets when inputs are short.
const MIN_SUMMARY_TARGET_CHARS = 300

function targetForInputs(inputs: string[], M: number): number {
  const total = inputs.reduce((n, s) => n + s.length, 0)
  return Math.max(MIN_SUMMARY_TARGET_CHARS, Math.round(total / Math.max(1, M)))
}

export interface ChronicleAgentArgs {
  systemPrompt: string
  model: string
  apiKey: string
  slots: AdventureSlots
}

export interface CompactionResult {
  chronicle: Chronicle
  cutoff: number
}

function renderTurnForSummary(t: Turn): string {
  const lines: string[] = []
  if (t.input && t.kind === 'player') lines.push(`PLAYER: ${t.input}`)
  if (t.reply.text) lines.push(`DM: ${t.reply.text}`)
  return lines.join('\n\n')
}

// One pass through the cascade: fold raw turns into chronicle[0] if eligible,
// then promote upward as long as any level is over threshold. Each iteration
// makes at most one summarizer call. Loop until no further compaction is
// triggered.
export async function compactCascade(
  turns: Turn[],
  cutoff: number,
  chronicle: Chronicle,
  settings: ChronicleSettings,
  agent: ChronicleAgentArgs,
  signal: AbortSignal,
  onProgress?: (label: string) => void,
): Promise<CompactionResult> {
  const N = Math.max(2, settings.compactionThreshold)
  const M = Math.max(1, Math.min(settings.compactionBatch, N - 1))
  let nextChronicle: Chronicle = chronicle.map((level) => level.slice())
  let nextCutoff = cutoff

  // Outer loop: keep compacting until nothing is over threshold.
  // Bounded by total possible operations (turns / M) plus levels.
  const HARD_CAP = 64
  for (let safety = 0; safety < HARD_CAP; safety++) {
    // Step 1: fold raw turns if eligible.
    if (turns.length - nextCutoff >= N) {
      onProgress?.('Folding turns into chronicle…')
      const batch = turns.slice(nextCutoff, nextCutoff + M)
      const inputs = batch.map(renderTurnForSummary).filter(Boolean)
      const result = await runSummarizer(
        {
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          apiKey: agent.apiKey,
          slots: agent.slots,
          inputs,
          targetChars: targetForInputs(inputs, M),
        },
        signal,
      )
      const entry: ChronicleEntry = {
        id: crypto.randomUUID(),
        text: result.summary,
        turnsCovered: batch.length,
        createdAt: Date.now(),
      }
      if (nextChronicle.length === 0) nextChronicle.push([])
      nextChronicle[0] = [...nextChronicle[0], entry]
      nextCutoff += batch.length
      continue
    }

    // Step 2: promote any level that's over threshold. Process bottom-up so
    // each pass touches at most one level (cleaner reasoning).
    let promoted = false
    for (let level = 0; level < nextChronicle.length; level++) {
      if (nextChronicle[level].length < N) continue
      onProgress?.(`Compacting chronicle level ${level}…`)
      const batch = nextChronicle[level].slice(0, M)
      const inputs = batch.map((e) => e.text)
      const result = await runSummarizer(
        {
          systemPrompt: agent.systemPrompt,
          model: agent.model,
          apiKey: agent.apiKey,
          slots: agent.slots,
          inputs,
          targetChars: targetForInputs(inputs, M),
        },
        signal,
      )
      const newEntry: ChronicleEntry = {
        id: crypto.randomUUID(),
        text: result.summary,
        turnsCovered: batch.reduce((n, e) => n + e.turnsCovered, 0),
        createdAt: Date.now(),
      }
      const updated = nextChronicle.map((lvl, i) =>
        i === level ? lvl.slice(M) : lvl.slice(),
      )
      if (level + 1 >= updated.length) updated.push([])
      updated[level + 1] = [...updated[level + 1], newEntry]
      nextChronicle = updated
      promoted = true
      break // restart from the bottom; promotions can cascade
    }
    if (promoted) continue

    // Nothing over threshold and no raw fold pending → done.
    break
  }
  return { chronicle: nextChronicle, cutoff: nextCutoff }
}

export function chronicleNeedsCompaction(
  turns: Turn[],
  cutoff: number,
  chronicle: Chronicle,
  settings: ChronicleSettings,
): boolean {
  const N = Math.max(2, settings.compactionThreshold)
  if (turns.length - cutoff >= N) return true
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
export function buildChronicleSystemMessage(chronicle: Chronicle): ApiMessage | null {
  if (chronicle.length === 0 || totalChronicleEntries(chronicle) === 0) {
    return null
  }
  const sections: string[] = []
  // Iterate from highest level (oldest) down to 0 (newest).
  for (let level = chronicle.length - 1; level >= 0; level--) {
    const entries = chronicle[level]
    if (entries.length === 0) continue
    const isTop = level === chronicle.length - 1
    const header = isTop ? '## Top level' : '## More recent'
    const body = entries.map((e) => e.text).join('\n\n')
    sections.push(`${header}\n\n${body}`)
  }
  const intro =
    `# Story so far\n\n` +
    `Chronicle of earlier turns, condensed by the archivist into nested levels: ` +
    `the topmost section covers the most distant past in heavy compression; each ` +
    `subsequent section is more recent and in finer detail. Treat all of it as canon.`
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
    if (i >= cutoff || (!t.reply.trace && !t.planner?.trace)) return t
    changed = true
    const reply = { ...t.reply }
    delete reply.trace
    let planner = t.planner
    if (planner?.trace) {
      planner = { ...planner }
      delete planner.trace
    }
    return { ...t, reply, planner }
  })
  return changed ? next : turns
}
