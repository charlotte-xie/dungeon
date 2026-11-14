// Summariser agent. Single-purpose: given the summary of the story so far and
// the run of consecutive turns that follows it, each turn rendered as
// PLAYER:/DM: lines and numbered as in the log, rewrite the summary to cover
// the extended story, its story so far at about the requested length.
//
// The chronicle module decides which turns to fold in and at what target
// length; the agent just renders the inputs and calls the model.

import { buildSummarizerInputs, summarizerSystemPrompt } from '../../prompts'
import { roleCacheKey } from '../model/cacheKey'
import { completeModel } from '../model/client'
import type { ApiProtocol, ModelCompletionRequest, ModelConnection, ReasoningEffort } from '../model/types'

export interface SummarizerInput {
  model: string
  reasoningEffort?: ReasoningEffort
  apiKey: string
  baseUrl: string
  protocol: ApiProtocol
  // The adventure's prompt-cache key; the summariser uses its own key derived
  // from it (see roleCacheKey).
  cacheKey?: string
  // The adventure's scenario brief: what the turns alone may never say, such
  // as who the player's character is and what kind of story this is.
  scenario: string
  // The summary of everything before these turns; empty at the start.
  previousSummary: string
  // The turns the new summary reaches the end of.
  turns: SummaryTurn[]
  // The length the story so far aims for, in chars: a hint to the model, not
  // a cap. The rest of the summary takes the room it needs.
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

// The summariser's request: runSummarizer sends it, and the Context view
// shows it.
export function summarizerRequest(input: SummarizerInput): {
  request: ModelCompletionRequest
  connection: ModelConnection
} {
  return {
    request: {
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      messages: [
        { role: 'system', content: summarizerSystemPrompt() },
        {
          role: 'user',
          content: buildSummarizerInputs(input.scenario, input.previousSummary, input.turns, input.targetChars),
        },
      ],
      label: 'summarizer',
    },
    connection: {
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      protocol: input.protocol,
      cacheKey: roleCacheKey(input.cacheKey, 'summarizer'),
    },
  }
}

export async function runSummarizer(
  input: SummarizerInput,
  signal: AbortSignal,
): Promise<SummarizerResult> {
  const { request, connection } = summarizerRequest(input)
  const completion = await completeModel(request, connection, signal)
  const content = completion.text
  if (!content) throw new Error('Summariser returned an empty continuity record')
  return { summary: content }
}
