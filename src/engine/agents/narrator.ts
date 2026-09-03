// Narrator orchestration in two phases over ONE conversation:
//
//   1. Narrate — the model writes the turn's prose. It is instructed not to
//      call tools (a stray call is still executed defensively).
//   2. Plot — the prose is appended to the same conversation followed by a
//      pivot instruction, and the model acts as the Plotter: comparing the
//      narration against the injected state/memory/plan and recording every
//      material change via the update tools, looping until it makes no calls.
//
// One message list, append-only, for the whole turn: the turn reminder is
// appended once up front, each narrator iteration adds its tool exchange or
// nudge after it, and the plotter adds the prose and pivot after that. Both
// phases advertise the identical tool set — the final narrative attempt
// forbids calls via tool_choice rather than dropping the schemas, which are
// part of the provider's cached prefix. So every request of the turn is a
// byte-for-byte extension of the previous one: the plotter request is a
// near-total prefix-cache hit on the narrator's, and updates reflect what was
// actually narrated rather than what the model intended to write. Provider
// transport and response-format quirks live under ../model.

import {
  CONTEXT_SUBSYSTEMS,
  applyTurnReminder,
  buildModelMessages,
  buildPlotterGuidance,
  type ContextFlags,
} from '../request'
import { executeEnabledTool } from '../tools'
import { completeModel } from '../model/client'
import type {
  ApiProtocol,
  ModelCompletion,
  ModelToolCall,
  ModelToolDefinition,
} from '../model/types'
import type {
  AdventureSlots,
  Chronicle,
  SamplingParams,
  StoryData,
  TraceEvent,
  Turn,
} from '../types'

export interface NarratorContext {
  systemPrompt: string
  model: string
  apiKey: string
  baseUrl: string
  protocol: ApiProtocol
  slots: AdventureSlots
  chronicle: Chronicle
  history: Turn[]
  initialData: StoryData
  sampling: SamplingParams
  stateCleanupThreshold: number
  includePriorPlayerTurns: boolean
  reminderAsSystem: boolean
  flags: ContextFlags
  nsfw: boolean
}

export interface NarratorResult {
  text: string
  data: StoryData
  // Narrate-phase events only; the plotter phase records separately so the
  // trace UI can present the two phases as distinct sections.
  trace: TraceEvent[]
  plotterTrace?: TraceEvent[]
  reasoningTokens?: number
}

export const MAX_NARRATOR_ITERATIONS = 10
export const MAX_PLOTTER_ITERATIONS = 4

const FINAL_NARRATIVE_INSTRUCTION =
  'Do not emit tool calls, JSON tool envelopes, XML function calls, analysis, or commentary. Return only the in-character narrative response now in 1-4 paragraphs.'

// The plotter pivot names only the subsystems that are actually enabled —
// a static text would point the model at injections that don't exist and
// tools that aren't advertised whenever a subsystem is switched off. It also
// carries each enabled subsystem's bookkeeping guidance and size-pressure
// hints, computed from the data as it stands at the pivot.
export function buildPlotterInstruction(
  flags: ContextFlags,
  data: StoryData,
  stateCleanupThreshold: number,
): string {
  const enabled = CONTEXT_SUBSYSTEMS.filter((s) => s.enabled(flags))
  const reads = enabled.map((s) => s.checkTool.name)
  const updates = enabled.map((s) => `\`${s.updateTool.name}\``)
  const distinctions = enabled.map((s) => s.pivotDistinction)
  const distinctLine =
    distinctions.length > 1 ? ` Keep the subsystems distinct: ${distinctions.join('; ')}.` : ''
  const guidance = buildPlotterGuidance(data, stateCleanupThreshold, flags)
  return (
    'The narration for this turn is complete. You are now acting as the Plotter: ' +
    `compare the player’s input and the narration above against the current working data (see the ${reads.join(' / ')} results). ` +
    `Record every material change by calling ${updates.join(', ')}, following each subsystem’s rules — batch every needed call into this single response.` +
    distinctLine +
    ' If a subsystem has no material change, make no call for it. Do not write story prose or commentary. If there is nothing to record at all, reply with only the word DONE.' +
    (guidance ? `\n\n${guidance}` : '')
  )
}

/**
 * Thrown when the model ends its turn (finish_reason=stop) with tool calls
 * and/or reasoning but no narrative prose, even after being nudged. Carries
 * the trace so the UI can still surface what the DM was thinking instead of
 * just a bare error line.
 */
export class EmptyNarrativeError extends Error {
  readonly trace: TraceEvent[]
  readonly reasoningTokens?: number
  constructor(
    finishReason: string | undefined,
    trace: TraceEvent[],
    reasoningTokens?: number,
  ) {
    super(`Empty narrative reply (finish_reason=${finishReason ?? 'unknown'})`)
    this.name = 'EmptyNarrativeError'
    this.trace = trace
    this.reasoningTokens = reasoningTokens
  }
}

export async function runNarrator(
  ctx: NarratorContext,
  signal: AbortSignal,
): Promise<NarratorResult> {
  let data = ctx.initialData
  // The context (memory/plot/state) is injected as a seeded tool exchange at
  // the tail of the built messages, and the turn reminder is appended once
  // right after it. From here on the conversation is append-only — never
  // rewritten mid-turn — so every request of this turn extends the previous
  // one and the provider's cached prefix keeps growing instead of resetting.
  const messages = applyTurnReminder(
    buildModelMessages({
      systemPrompt: ctx.systemPrompt,
      slots: ctx.slots,
      chronicle: ctx.chronicle,
      history: ctx.history,
      data,
      includePriorPlayerTurns: ctx.includePriorPlayerTurns,
      flags: ctx.flags,
      nsfw: ctx.nsfw,
    }),
    ctx.reminderAsSystem,
    {
      worldState: ctx.flags.includeWorldState,
      plotOutline: ctx.flags.includePlotOutline,
      memory: ctx.flags.includeMemory,
      ooc: ctx.flags.includeOoc,
    },
  )
  const tools: ModelToolDefinition[] = []
  const enabledToolNames = new Set<string>()
  for (const s of CONTEXT_SUBSYSTEMS) {
    if (!s.enabled(ctx.flags)) continue
    tools.push(s.updateTool, s.checkTool)
    enabledToolNames.add(s.updateTool.name)
    enabledToolNames.add(s.checkTool.name)
  }

  const narratorTrace: TraceEvent[] = []
  const plotterTrace: TraceEvent[] = []
  // Events land in the trace of whichever phase is active; the helpers below
  // capture this binding, so reassigning it pivots them to the plotter trace.
  let trace: TraceEvent[] = narratorTrace
  let totalReasoningTokens = 0
  const pushToolResult = (call: ModelToolCall, content: string) => {
    messages.push({ role: 'tool', toolCallId: call.id, content })
    trace.push({
      kind: 'call',
      name: call.name,
      arguments: call.arguments,
      result: content,
    })
  }
  // Re-prompt the model for prose when a turn produced tool calls / reasoning
  // but no narrative. Honors ctx.reminderAsSystem (same convention as the turn
  // reminder): a true system message when asSystem, otherwise an in-channel
  // (OOC: ...) user message. The trace records the exact text sent.
  const pushNudge = (instruction: string) => {
    const message = ctx.reminderAsSystem
      ? { role: 'system' as const, content: instruction }
      : { role: 'user' as const, content: `(OOC: ${instruction})` }
    messages.push(message)
    trace.push({
      kind: 'thought',
      text: `(nudge → ${message.role}) ${message.content}`,
    })
  }
  // Shared by both phases: file a completion's prompt usage (the provider's
  // own cached-token count is the evidence that prefix caching is working),
  // reasoning, and protocol anomalies into the active trace.
  const recordCompletion = (label: string, completion: ModelCompletion) => {
    if (completion.promptTokens !== undefined || completion.cachedTokens !== undefined) {
      trace.push({
        kind: 'usage',
        label,
        promptTokens: completion.promptTokens,
        cachedTokens: completion.cachedTokens,
      })
    }
    for (const reasoning of completion.reasoning) {
      trace.push({ kind: 'reasoning', text: reasoning })
    }
    for (const anomaly of completion.anomalies) {
      trace.push({ kind: 'thought', text: `(model protocol: ${anomaly.detail})` })
    }
    const iterReasoningTokens = completion.reasoningTokens ?? 0
    if (iterReasoningTokens > 0) totalReasoningTokens += iterReasoningTokens
  }

  // Shared by both phases: append the model's tool-call turn and execute each
  // call, serving context reads from the live data and mutations through the
  // game-state executor. Append-only throughout. Reports whether the batch
  // contained context reads or rejected calls so the plotter loop can decide
  // whether another iteration has a purpose.
  const handleToolCalls = (completion: { text: string; toolCalls: ModelToolCall[] }) => {
    messages.push({
      role: 'assistant',
      content: completion.text,
      toolCalls: completion.toolCalls,
    })
    let sawError = false
    let sawRead = false
    for (const call of completion.toolCalls) {
      const readSubsystem = CONTEXT_SUBSYSTEMS.find((s) => s.checkTool.name === call.name)
      if (readSubsystem && enabledToolNames.has(call.name)) {
        sawRead = true
        pushToolResult(call, readSubsystem.buildPayload(data))
        continue
      }
      const exec = executeEnabledTool(enabledToolNames, call.name, call.arguments, data)
      data = exec.data
      if (/^(error|partial)\b/i.test(exec.result)) sawError = true
      pushToolResult(call, exec.result)
    }
    return { sawError, sawRead }
  }

  // --- Phase 1: narrate ---
  let proseText: string | null = null
  let nudged = false
  for (let iter = 0; iter < MAX_NARRATOR_ITERATIONS; iter++) {
    const finalNarrativeAttempt = iter === MAX_NARRATOR_ITERATIONS - 1
    if (finalNarrativeAttempt) pushNudge(FINAL_NARRATIVE_INSTRUCTION)
    if (iter === 0) {
      console.debug('[dm] narrator iter 0 — memory/plot/state slices injected as tool results', {
        initialData: ctx.initialData,
      })
    }
    const label = `narrator:${iter}`
    const completion = await completeModel(
      {
        model: ctx.model,
        messages,
        tools,
        // The last attempt forbids tool use without dropping the schemas,
        // which sit in the provider's cached prefix.
        toolChoice: finalNarrativeAttempt ? 'none' : undefined,
        temperature: ctx.sampling.temperature,
        label,
      },
      { baseUrl: ctx.baseUrl, apiKey: ctx.apiKey, protocol: ctx.protocol },
      signal,
    )
    recordCompletion(label, completion)

    if (completion.toolCalls.length && !(finalNarrativeAttempt && completion.text)) {
      // The narrator is instructed not to call tools; execute defensively and
      // continue toward prose. The plotter phase cleans up after regardless.
      const interstitial = completion.text
      if (interstitial) trace.push({ kind: 'thought', text: interstitial })
      handleToolCalls(completion)
      continue
    }

    const content = completion.text
    if (content) {
      if (completion.toolCalls.length) {
        // Final attempt: the prose is what matters; stray calls are dropped.
        trace.push({
          kind: 'thought',
          text: `(final attempt: ${completion.toolCalls.length} stray tool call(s) ignored)`,
        })
      }
      proseText = content
      break
    }

    console.warn('[dm] empty model message', { iter, completion })
    if (finalNarrativeAttempt) {
      throw new EmptyNarrativeError(
        completion.finishReason,
        trace,
        totalReasoningTokens || undefined,
      )
    }
    if (!nudged) {
      nudged = true
      pushNudge('Provide the narrative reply in character — 2-4 short paragraphs.')
      continue
    }
    throw new EmptyNarrativeError(
      completion.finishReason,
      trace,
      totalReasoningTokens || undefined,
    )
  }
  if (proseText === null) {
    throw new Error(`Narrator loop exceeded ${MAX_NARRATOR_ITERATIONS} iterations`)
  }

  // --- Phase 2: plot ---
  // Commit the prose into the same conversation, pivot the model into the
  // Plotter role, and loop until it records nothing further. A plotter
  // failure never loses the turn: the prose and any updates recorded so far
  // are kept, and the rest of the state simply carries forward.
  if (tools.length) {
    messages.push({ role: 'assistant', content: proseText })
    const plotterInstruction = buildPlotterInstruction(ctx.flags, data, ctx.stateCleanupThreshold)
    const pivot = ctx.reminderAsSystem
      ? { role: 'system' as const, content: plotterInstruction }
      : { role: 'user' as const, content: `(OOC: ${plotterInstruction})` }
    messages.push(pivot)
    trace = plotterTrace
    try {
      for (let iter = 0; iter < MAX_PLOTTER_ITERATIONS; iter++) {
        const label = `plotter:${iter}`
        const completion = await completeModel(
          {
            model: ctx.model,
            messages,
            tools,
            temperature: ctx.sampling.temperature,
            label,
          },
          { baseUrl: ctx.baseUrl, apiKey: ctx.apiKey, protocol: ctx.protocol },
          signal,
        )
        recordCompletion(label, completion)
        if (completion.text && completion.text.trim().toUpperCase() !== 'DONE') {
          trace.push({ kind: 'thought', text: completion.text })
        }
        if (!completion.toolCalls.length) break
        const batch = handleToolCalls(completion)
        // A clean batch of updates is the normal end of the phase. Stop here:
        // a confirmation round-trip ends the request on bare tool results
        // with no fresh directive, which makes models waffle about whether
        // they should be waiting for player input. Iterate only when there is
        // something concrete left to do — repair a rejected call, or act on a
        // context read the model chose to make.
        if (!batch.sawError && !batch.sawRead) break
        if (batch.sawError) {
          pushNudge(
            'One or more Plotter calls were rejected — see the tool results above. Re-issue the corrected calls now, or reply with only the word DONE to leave them unrecorded.',
          )
        }
      }
    } catch (err) {
      if (signal.aborted) throw err
      const msg = err instanceof Error ? err.message : String(err)
      trace.push({
        kind: 'thought',
        text: `(plotter failed: ${msg} — updates recorded so far are kept; anything else carries forward unchanged)`,
      })
    }
  }

  return {
    text: proseText,
    data,
    trace: narratorTrace,
    plotterTrace: plotterTrace.length ? plotterTrace : undefined,
    reasoningTokens: totalReasoningTokens || undefined,
  }
}
