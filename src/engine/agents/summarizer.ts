// Summarizer agent. Single-purpose: given a list of input texts (raw turns
// rendered as PLAYER:/DM: lines, OR existing chronicle entries being promoted
// to a higher level), produce one polished prose summary of approximately the
// requested length.
//
// The chronicle module decides what to summarize and at what target length;
// the agent just renders the inputs and calls the model.

import { buildSummarizerPrompt } from '../../prompts'
import { ADVENTURE_SLOTS } from '../config'
import { xaiChat } from '../xai'
import type { AdventureSlots, ApiMessage } from '../types'

export interface SummarizerInput {
  systemPrompt: string
  model: string
  apiKey: string
  slots: AdventureSlots
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

export async function runSummarizer(
  input: SummarizerInput,
  signal: AbortSignal,
): Promise<SummarizerResult> {
  const slotsBlock = ADVENTURE_SLOTS.map((def) => {
    const v = (input.slots[def.key] ?? '').trim()
    return v ? `${def.label}:\n\n${v}` : ''
  })
    .filter(Boolean)
    .join('\n\n')

  const joined = input.inputs
    .map((text, i) => `--- ENTRY ${i + 1} ---\n\n${text}`)
    .join('\n\n')

  const userContent =
    `DM system prompt (rules the narrator follows):\n\n${input.systemPrompt}\n\n` +
    `${slotsBlock}\n\n` +
    `--- BEGIN INPUTS (${input.inputs.length} entries to fold into one summary) ---\n\n` +
    `${joined}\n\n` +
    `--- END INPUTS ---\n\n` +
    `Produce a single unified retelling that covers everything in the inputs above. ` +
    `Use polished prose, complete sentences, decreasing resolution as material recedes ` +
    `into the past. The inputs are RAW MATERIAL — do not echo their formatting, headers, ` +
    `or any "ENTRY N" / "PLAYER:" / "DM:" markers. Output the retelling text only — no ` +
    `preamble, headers, bullet markers, or meta commentary.`

  const apiMessages: ApiMessage[] = [
    { role: 'system', content: buildSummarizerPrompt(input.targetChars) },
    { role: 'user', content: userContent },
  ]

  const res = await xaiChat(
    {
      model: input.model,
      messages: apiMessages,
      stream: false,
    },
    input.apiKey,
    signal,
  )

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`summarizer ${res.status}: ${body.slice(0, 200) || res.statusText}`)
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const content = data.choices?.[0]?.message?.content?.trim()
  if (!content) throw new Error('Summarizer returned empty retelling')
  return { summary: content }
}
