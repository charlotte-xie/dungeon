// Summariser agent. Single-purpose: given a list of input texts (raw turns
// rendered as PLAYER:/DM: lines, OR existing chronicle entries being promoted
// to a higher level), produce one compact continuity record within the
// requested length budget.
//
// The chronicle module decides what to summarise and at what target length;
// the agent just renders the inputs and calls the model.

import { SUMMARIZER_SYSTEM_PROMPT, buildSummarizerLengthNote } from '../../prompts'
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
  // The texts to compress into one summary. For level-0 folds these are raw
  // turn renderings ("PLAYER: ...\n\nDM: ..."); for level promotions these
  // are existing chronicle entry texts.
  inputs: string[]
  // Target length for the resulting summary, in chars. Used both as the
  // summariser's prompt directive and for budgeting at higher levels.
  targetChars: number
}

export interface SummarizerResult {
  summary: string
}

export async function runSummarizer(
  input: SummarizerInput,
  signal: AbortSignal,
): Promise<SummarizerResult> {
  const joined = input.inputs
    .map((text, i) => `--- ENTRY ${i + 1} ---\n\n${text}`)
    .join('\n\n')

  const canonBlock = Object.keys(input.memory).length
    ? `--- CANON (long-term memory — grounding only) ---\n\n` +
      `Use this only to preserve the spelling and identity of entities already mentioned ` +
      `in the inputs. Do NOT summarise this block or import any fact that the inputs ` +
      `themselves do not establish or change.\n\n` +
      `\`\`\`json\n${JSON.stringify(input.memory, null, 2)}\n\`\`\`\n\n`
    : ''

  const userContent =
    canonBlock +
    `--- BEGIN INPUTS (${input.inputs.length} ${input.inputs.length === 1 ? 'entry' : 'entries'} to fold into one summary) ---\n\n` +
    `${joined}\n\n` +
    `--- END INPUTS ---\n\n` +
    `${buildSummarizerLengthNote(input.targetChars)}\n\n` +
    `Produce one compact continuity record containing only consequential changes established ` +
    `by the inputs above. Use complete sentences and decrease resolution as material recedes ` +
    `into the past. The inputs are RAW MATERIAL — do not echo their formatting, headers, ` +
    `or any "ENTRY N" / "PLAYER:" / "DM:" markers. Output the continuity text only — no ` +
    `preamble, headers, bullet markers, or meta commentary.`

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
