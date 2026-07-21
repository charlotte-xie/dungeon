// Reviser agent. Takes the narrator's draft, runs a single non-reasoning
// pass to polish the prose into fluent English without changing what happens,
// and returns the revised text as the final reply for the turn.
//
// One-shot: no tool use, no iteration loop. The reviser never mutates state,
// plot, or memory — it only rewrites prose.

import { REVISER_SYSTEM_PROMPT } from '../../prompts'
import { completeModel } from '../model/client'
import type { ModelMessage } from '../model/types'
import type {
  AdventureSlots,
  ModelCall,
  SamplingParams,
  TraceEvent,
} from '../types'

export interface ReviserContext {
  model: string
  apiKey: string
  baseUrl: string
  slots: AdventureSlots
  draft: string
  sampling: SamplingParams
}

// Pure message-builder. Exposed so the Context viewer can preview exactly
// what the reviser will receive without executing the call.
export function buildReviserMessages(
  slots: AdventureSlots,
  draft: string,
): ModelMessage[] {
  const styleGuide = slots.styleGuide?.trim() ?? ''
  const messages: ModelMessage[] = [
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
  const userText =
    `--- DRAFT (revise this) ---\n\n${draft}\n\n` +
    `--- TASK ---\n\nReturn the full revised passage. Preserve every event, ` +
    `dialogue line, and named entity exactly. Fix grammar, awkward phrasing, ` +
    `and broken sentences. No preamble, no labels — just the prose.`
  messages.push({ role: 'user', content: userText })
  return messages
}

export async function runReviser(
  ctx: ReviserContext,
  signal: AbortSignal,
): Promise<ModelCall> {
  const callId = crypto.randomUUID()
  const startedAt = Date.now()
  const trace: TraceEvent[] = []

  const messages = buildReviserMessages(ctx.slots, ctx.draft)

  const completion = await completeModel(
    {
      model: ctx.model,
      messages,
      temperature: ctx.sampling.temperature,
      label: 'reviser',
    },
    { baseUrl: ctx.baseUrl, apiKey: ctx.apiKey },
    signal,
  )
  for (const reasoning of completion.reasoning) {
    trace.push({ kind: 'reasoning', text: reasoning })
  }
  for (const anomaly of completion.anomalies) {
    trace.push({ kind: 'thought', text: `(model protocol: ${anomaly.detail})` })
  }
  const text = completion.text
  if (!text) {
    throw new Error(
      `Empty reviser output (finish_reason=${completion.finishReason ?? 'unknown'})`,
    )
  }

  return {
    id: callId,
    model: ctx.model,
    text,
    trace: trace.length ? trace : undefined,
    reasoningTokens: completion.reasoningTokens,
    durationMs: Date.now() - startedAt,
  }
}
