// Summariser agent. Single-purpose: given a run of consecutive turns, each
// rendered as PLAYER:/DM: lines and numbered as in the log, produce one
// compact continuity record within the requested length budget.
//
// The chronicle module decides what to summarise and at what target length;
// the agent just renders the inputs and calls the model.

import { SUMMARIZER_SYSTEM_PROMPT, buildSummarizerInputs } from '../../prompts'
import { roleCacheKey } from '../model/cacheKey'
import { completeModel } from '../model/client'
import type { ApiProtocol, ModelMessage, ReasoningEffort } from '../model/types'
import type { Memory } from '../types'

export interface SummarizerInput {
  model: string
  reasoningEffort?: ReasoningEffort
  apiKey: string
  baseUrl: string
  protocol: ApiProtocol
  // The adventure's prompt-cache key; the summariser uses its own key derived
  // from it (see roleCacheKey).
  cacheKey?: string
  // Long-term memory at the time of the fold, passed whole as grounding canon
  // so summaries keep entity names and established facts consistent across
  // folds (without it, adjacent entries can drift — "the priest" vs. his
  // name). Folds are rare, and matching entries to the inputs missed exactly
  // those unnamed references.
  memory: Memory
  // The turns to record in one summary, at any level of the chronicle.
  turns: SummaryTurn[]
  // Target length for the resulting summary, in chars. Used both as the
  // summariser's prompt directive and for budgeting at higher levels.
  targetChars: number
}

// One turn as the summariser reads it: its number in the log (from 1) and its
// PLAYER:/DM: rendering.
export interface SummaryTurn {
  number: number
  text: string
}

export interface SummarizerResult {
  summary: string
}

export async function runSummarizer(
  input: SummarizerInput,
  signal: AbortSignal,
): Promise<SummarizerResult> {
  const memoryJson = Object.keys(input.memory).length ? JSON.stringify(input.memory, null, 2) : null
  const userContent = buildSummarizerInputs(memoryJson, input.turns, input.targetChars)

  const messages: ModelMessage[] = [
    { role: 'system', content: SUMMARIZER_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ]

  const completion = await completeModel(
    {
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      messages,
      label: 'summarizer',
    },
    {
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      protocol: input.protocol,
      cacheKey: roleCacheKey(input.cacheKey, 'summarizer'),
    },
    signal,
  )
  const content = completion.text
  if (!content) throw new Error('Summariser returned an empty continuity record')
  return { summary: content }
}
