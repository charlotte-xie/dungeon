// Narrator orchestration in two phases over ONE conversation:
//
//   1. Narrate — the model writes the turn's prose. It is instructed not to
//      call tools (a stray call is still executed defensively).
//   2. Plot — the prose is appended to the same conversation followed by a
//      pivot instruction, and the model acts as the Plotter: comparing the
//      narration against the injected state/memory/plan and recording every
//      material change via the update tools, looping until it makes no calls.
//
// Both phases advertise the identical tool set and extend the same message
// list append-only, so the plotter request is a near-total provider cache hit
// on the narrator's prefix, and updates reflect what was actually narrated
// rather than what the model intended to write. Provider transport and
// response-format quirks live under ../model.

import {
  applyTurnReminder,
  buildMemoryPayload,
  buildModelMessages,
  buildPlotPayload,
  buildStatePayload,
} from '../request'
import {
  FUTURE_PLOT_PLAN_TOOL,
  GET_MEMORY_TOOL,
  GET_PLOT_PLAN_TOOL,
  GET_STATE_TOOL,
  UPDATE_MEMORY_TOOL,
  UPDATE_STATE_TOOL,
  executeEnabledTool,
  isContextReadTool,
} from '../tools'
import { completeModel } from '../model/client'
import type { ModelToolCall, ModelToolDefinition } from '../model/types'
import type {
  AdventureSlots,
  Chronicle,
  Memory,
  SamplingParams,
  TraceEvent,
  Turn,
  WorldState,
} from '../types'

export interface NarratorContext {
  systemPrompt: string
  model: string
  apiKey: string
  baseUrl: string
  slots: AdventureSlots
  chronicle: Chronicle
  history: Turn[]
  initialState: WorldState
  initialPlot: string[]
  initialMemory: Memory
  sampling: SamplingParams
  stateCleanupThreshold: number
  includePriorPlayerTurns: boolean
  reminderAsSystem: boolean
  includeWorldState: boolean
  includePlotOutline: boolean
  includeMemory: boolean
  nsfw: boolean
}

export interface NarratorResult {
  text: string
  state: WorldState
  plot: string[]
  memory: Memory
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
// tools that aren't advertised whenever a subsystem is switched off.
export function buildPlotterInstruction(
  includeWorldState: boolean,
  includePlotOutline: boolean,
  includeMemory: boolean,
): string {
  const reads: string[] = []
  const updates: string[] = []
  const distinctions: string[] = []
  if (includeMemory) {
    reads.push('get_memory')
    updates.push('`update_memory`')
    distinctions.push('`update_memory` holds only durable, scene-independent canon')
  }
  if (includePlotOutline) {
    reads.push('get_plot_plan')
    updates.push('`future_plot_plan`')
    distinctions.push('`future_plot_plan` holds only future directions')
  }
  if (includeWorldState) {
    reads.push('get_state')
    updates.push('`update_state`')
    distinctions.push(
      '`update_state` holds the current scene (positions, presence, held items, active tension)',
    )
  }
  const distinctLine =
    distinctions.length > 1 ? ` Keep the subsystems distinct: ${distinctions.join('; ')}.` : ''
  return (
    'The narration for this turn is complete. You are now acting as the Plotter: ' +
    `compare the player’s input and the narration above against the current working data (see the ${reads.join(' / ')} results). ` +
    `Record every material change by calling ${updates.join(', ')}, following each subsystem’s rules — batch every needed call into this single response.` +
    distinctLine +
    ' If a subsystem has no material change, make no call for it. Do not write story prose or commentary. If there is nothing to record at all, reply with only the word DONE.'
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
  let currentState = ctx.initialState
  let currentPlot = ctx.initialPlot
  let currentMemory = ctx.initialMemory
  // The context (memory/plot/state) is injected as a seeded tool exchange at
  // the tail of these messages. From here on the conversation is append-only —
  // never rewritten mid-turn — so every loop iteration extends the provider's
  // cached prefix instead of invalidating it.
  const messages = buildModelMessages(
    ctx.systemPrompt,
    ctx.slots,
    ctx.chronicle,
    ctx.history,
    currentState,
    currentPlot,
    currentMemory,
    ctx.stateCleanupThreshold,
    ctx.includePriorPlayerTurns,
    ctx.includeWorldState,
    ctx.includePlotOutline,
    ctx.includeMemory,
    ctx.nsfw,
  )
  const tools: ModelToolDefinition[] = []
  const enabledToolNames = new Set<string>()
  const advertise = (tool: ModelToolDefinition) => {
    tools.push(tool)
    enabledToolNames.add(tool.name)
  }
  if (ctx.includeMemory) {
    advertise(UPDATE_MEMORY_TOOL)
    advertise(GET_MEMORY_TOOL)
  }
  if (ctx.includeWorldState) {
    advertise(UPDATE_STATE_TOOL)
    advertise(GET_STATE_TOOL)
  }
  if (ctx.includePlotOutline) {
    advertise(FUTURE_PLOT_PLAN_TOOL)
    advertise(GET_PLOT_PLAN_TOOL)
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
      if (enabledToolNames.has(call.name) && isContextReadTool(call.name)) {
        sawRead = true
        const payload =
          call.name === GET_MEMORY_TOOL.name
            ? buildMemoryPayload(currentMemory)
            : call.name === GET_PLOT_PLAN_TOOL.name
              ? buildPlotPayload(currentPlot)
              : buildStatePayload(currentState, ctx.stateCleanupThreshold)
        pushToolResult(call, payload)
        continue
      }
      const exec = executeEnabledTool(
        enabledToolNames,
        call.name,
        call.arguments,
        currentState,
        currentPlot,
        currentMemory,
      )
      currentState = exec.state
      currentPlot = exec.plot
      currentMemory = exec.memory
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
    const reminded = applyTurnReminder(messages, ctx.reminderAsSystem, {
      worldState: !finalNarrativeAttempt && ctx.includeWorldState,
      plotOutline: !finalNarrativeAttempt && ctx.includePlotOutline,
      memory: !finalNarrativeAttempt && ctx.includeMemory,
    })
    if (finalNarrativeAttempt) {
      const message = ctx.reminderAsSystem
        ? { role: 'system' as const, content: FINAL_NARRATIVE_INSTRUCTION }
        : { role: 'user' as const, content: `(OOC: ${FINAL_NARRATIVE_INSTRUCTION})` }
      reminded.push(message)
      trace.push({
        kind: 'thought',
        text: `(nudge → ${message.role}) ${message.content}`,
      })
    }
    if (iter === 0) {
      console.debug('[dm] narrator iter 0 — memory/plot/state slices injected as tool results', {
        initialMemory: ctx.initialMemory,
        initialMemoryKeys: Object.keys(ctx.initialMemory),
        initialPlot: ctx.initialPlot,
        initialState: ctx.initialState,
      })
    }
    const completion = await completeModel(
      {
        model: ctx.model,
        messages: reminded,
        tools: finalNarrativeAttempt ? undefined : tools,
        temperature: ctx.sampling.temperature,
        label: `narrator:${iter}`,
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
    const iterReasoningTokens = completion.reasoningTokens ?? 0
    if (iterReasoningTokens > 0) totalReasoningTokens += iterReasoningTokens

    if (completion.toolCalls.length) {
      // The narrator is instructed not to call tools; execute defensively and
      // continue toward prose. The plotter phase cleans up after regardless.
      const interstitial = completion.text
      if (interstitial) trace.push({ kind: 'thought', text: interstitial })
      handleToolCalls(completion)
      continue
    }

    const content = completion.text
    if (content) {
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
    const plotterInstruction = buildPlotterInstruction(
      ctx.includeWorldState,
      ctx.includePlotOutline,
      ctx.includeMemory,
    )
    const pivot = ctx.reminderAsSystem
      ? { role: 'system' as const, content: plotterInstruction }
      : { role: 'user' as const, content: `(OOC: ${plotterInstruction})` }
    messages.push(pivot)
    trace = plotterTrace
    try {
      for (let iter = 0; iter < MAX_PLOTTER_ITERATIONS; iter++) {
        const completion = await completeModel(
          {
            model: ctx.model,
            messages,
            tools,
            temperature: ctx.sampling.temperature,
            label: `plotter:${iter}`,
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
        const iterReasoningTokens = completion.reasoningTokens ?? 0
        if (iterReasoningTokens > 0) totalReasoningTokens += iterReasoningTokens
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
    state: currentState,
    plot: currentPlot,
    memory: currentMemory,
    trace: narratorTrace,
    plotterTrace: plotterTrace.length ? plotterTrace : undefined,
    reasoningTokens: totalReasoningTokens || undefined,
  }
}
