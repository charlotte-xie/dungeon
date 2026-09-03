// Summarizer agent. Single-purpose: given a list of input texts (raw turns
// rendered as PLAYER:/DM: lines, OR existing chronicle entries being promoted
// to a higher level), produce one compact continuity record within the
// requested length budget.
//
// The chronicle module decides what to summarize and at what target length;
// the agent just renders the inputs and calls the model.

import { SUMMARIZER_SYSTEM_PROMPT, buildSummarizerLengthNote } from '../../prompts'
import { completeModel } from '../model/client'
import type { ApiProtocol, ModelMessage } from '../model/types'
import type { Memory } from '../types'

export interface SummarizerInput {
  model: string
  apiKey: string
  baseUrl: string
  protocol: ApiProtocol
  // Long-term memory at the time of the fold, passed as grounding canon so
  // summaries keep entity names and established facts consistent across folds
  // (without it, adjacent entries can drift — "the priest" vs. his name).
  memory: Memory
  // The texts to compress into one summary. For level-0 folds these are raw
  // turn renderings ("PLAYER: ...\n\nDM: ..."); for level promotions these
  // are existing chronicle entry texts.
  inputs: string[]
  // Target length for the resulting summary, in chars. Used both as the
  // summarizer's prompt directive and for budgeting at higher levels.
  targetChars: number
}

export interface SummarizerResult {
  summary: string
}

function normalizeWords(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// Memory is useful for canonical entity names, but sending the entire store
// distracts the summarizer and can leak unrelated facts into the chronicle.
// Keep only entries whose slug or leading identity phrase is mentioned in the
// material being summarized.
export function relevantMemoryForInputs(memory: Memory, inputs: string[]): Memory {
  const source = ` ${normalizeWords(inputs.join('\n'))} `
  const relevant: Memory = {}
  for (const [slug, entry] of Object.entries(memory)) {
    const slugPhrase = normalizeWords(slug.replace(/[_-]+/g, ' '))
    const slugMentioned = slugPhrase !== 'player' && source.includes(` ${slugPhrase} `)
    // Identity phrase: the entry itself when it is a string, else its `is`
    // facet, else the first string value found.
    const record =
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : undefined
    const identitySource =
      typeof entry === 'string'
        ? entry
        : record
          ? typeof record.is === 'string'
            ? record.is
            : (Object.values(record).find((v): v is string => typeof v === 'string') ?? '')
          : ''
    const identity = identitySource.split(/[;.!?]/, 1)[0] ?? ''
    const names = identity.match(/\b[A-Z][\p{L}'’-]{2,}\b/gu) ?? []
    const nameMentioned = names
      .filter((name) => !['The', 'This', 'That'].includes(name))
      .some((name) => source.includes(` ${normalizeWords(name)} `))
    if (slugMentioned || nameMentioned) relevant[slug] = entry
  }
  return relevant
}

export async function runSummarizer(
  input: SummarizerInput,
  signal: AbortSignal,
): Promise<SummarizerResult> {
  const joined = input.inputs
    .map((text, i) => `--- ENTRY ${i + 1} ---\n\n${text}`)
    .join('\n\n')

  const relevantMemory = relevantMemoryForInputs(input.memory, input.inputs)
  const canonBlock = Object.keys(relevantMemory).length
    ? `--- CANON (long-term memory — grounding only) ---\n\n` +
      `Use this only to preserve the spelling and identity of entities already mentioned ` +
      `in the inputs. Do NOT summarize this block or import any fact that the inputs ` +
      `themselves do not establish or change.\n\n` +
      `\`\`\`json\n${JSON.stringify(relevantMemory, null, 2)}\n\`\`\`\n\n`
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
      messages,
      label: 'summarizer',
    },
    { baseUrl: input.baseUrl, apiKey: input.apiKey, protocol: input.protocol },
    signal,
  )
  const content = completion.text
  if (!content) throw new Error('Summarizer returned an empty continuity record')
  return { summary: content }
}
