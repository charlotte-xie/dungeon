// Summariser agent. Single-purpose: given the story so far and the run of
// consecutive turns that follows it, each turn rendered as PLAYER:/DM: lines
// and numbered as in the log, write the next part of the story so far within
// the requested length budget.
//
// The chronicle module decides what to summarise, what comes before it and
// at what target length; the agent just renders the inputs and calls the
// model.

import { SUMMARIZER_SYSTEM_PROMPT, buildSummarizerInputs } from '../../prompts'
import { roleCacheKey } from '../model/cacheKey'
import { completeModel } from '../model/client'
import type { ApiProtocol, ModelMessage, ReasoningEffort } from '../model/types'

export interface SummarizerInput {
  model: string
  reasoningEffort?: ReasoningEffort
  apiKey: string
  baseUrl: string
  protocol: ApiProtocol
  // The adventure's prompt-cache key; the summariser uses its own key derived
  // from it (see roleCacheKey).
  cacheKey?: string
  // The summaries of everything before these turns, oldest first. They give
  // the story's threads and the names it uses, as they stood at the time;
  // they come first in the input, so the calls of one compaction, each
  // seeing one more, share a cached prefix.
  storySoFar: string[]
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
  const userContent = buildSummarizerInputs(input.storySoFar, input.turns, input.targetChars)

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
