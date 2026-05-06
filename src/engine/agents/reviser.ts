// Reviser agent. Takes the narrator's draft and (optionally) the planner's
// author notes, runs a single non-reasoning pass to polish the prose into
// fluent English without changing what happens, and returns the revised text
// as the final reply for the turn.
//
// One-shot: no tool use, no iteration loop. The reviser never mutates state,
// plot, or memory — it only rewrites prose.

import { REVISER_SYSTEM_PROMPT } from '../../prompts'
import { modelSupportsSampling, xaiChat } from '../xai'
import type {
  AdventureSlots,
  ApiMessage,
  ModelCall,
  SamplingParams,
  TraceEvent,
} from '../types'

export interface ReviserContext {
  model: string
  apiKey: string
  slots: AdventureSlots
  draft: string
  authorNotes?: string
  sampling: SamplingParams
}

// Pure message-builder. Exposed so the Context viewer can preview exactly
// what the reviser will receive without executing the call.
export function buildReviserMessages(
  slots: AdventureSlots,
  draft: string,
  authorNotes?: string,
): ApiMessage[] {
  const styleGuide = slots.styleGuide?.trim() ?? ''
  const messages: ApiMessage[] = [
    { role: 'system', content: REVISER_SYSTEM_PROMPT },
  ]
  if (styleGuide) {
    messages.push({
      role: 'system',
      content:
        `# Author style guide (preserve, do not amplify)\n\n${styleGuide}\n\n` +
        `Use this only to recognize the intended voice so you don't flatten ` +
        `it. Do not "push" toward this voice — the draft is already in it. ` +
        `Your job is grammar and clarity, not stylization.`,
    })
  }
  const userParts: string[] = []
  if (authorNotes && authorNotes.trim()) {
    userParts.push(
      `--- AUTHOR NOTES (context only — do not reproduce) ---\n\n` +
        authorNotes.trim(),
    )
  }
  userParts.push(`--- DRAFT (revise this) ---\n\n${draft}`)
  userParts.push(
    `--- TASK ---\n\nReturn the full revised passage. Preserve every event, ` +
      `dialogue line, and named entity exactly. Fix grammar, awkward phrasing, ` +
      `and broken sentences. No preamble, no labels — just the prose.`,
  )
  messages.push({ role: 'user', content: userParts.join('\n\n') })
  return messages
}

export async function runReviser(
  ctx: ReviserContext,
  signal: AbortSignal,
): Promise<ModelCall> {
  const callId = crypto.randomUUID()
  const startedAt = Date.now()
  const trace: TraceEvent[] = []

  const messages = buildReviserMessages(ctx.slots, ctx.draft, ctx.authorNotes)

  const body: Record<string, unknown> = {
    model: ctx.model,
    messages,
    stream: false,
  }
  if (modelSupportsSampling(ctx.model)) {
    body.temperature = ctx.sampling.temperature
    body.frequency_penalty = ctx.sampling.frequencyPenalty
    body.presence_penalty = ctx.sampling.presencePenalty
  }

  console.debug('[reviser] xAI request', { model: ctx.model, body })
  const res = await xaiChat(body, ctx.apiKey, signal)
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`reviser ${res.status}: ${errBody.slice(0, 200) || res.statusText}`)
  }

  const rawData = (await res.json()) as unknown
  console.debug('[reviser] xAI response', { rawData })
  const data = rawData as {
    choices?: {
      finish_reason?: string
      message?: { content?: string; reasoning_content?: string }
    }[]
    usage?: { completion_tokens_details?: { reasoning_tokens?: number } }
  }
  const choice = data.choices?.[0]
  const msg = choice?.message
  if (!msg) throw new Error('Empty response from reviser (no message)')

  const reasoning = msg.reasoning_content?.trim()
  if (reasoning) trace.push({ kind: 'reasoning', text: reasoning })
  const reasoningTokens =
    data.usage?.completion_tokens_details?.reasoning_tokens ?? 0
  const text = msg.content?.trim() ?? ''
  if (!text) {
    throw new Error(
      `Empty reviser output (finish_reason=${choice?.finish_reason ?? 'unknown'})`,
    )
  }

  return {
    id: callId,
    model: ctx.model,
    text,
    trace: trace.length ? trace : undefined,
    reasoningTokens: reasoningTokens || undefined,
    durationMs: Date.now() - startedAt,
  }
}
