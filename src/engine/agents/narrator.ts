// Narrator orchestration: compose game context, consume normalized model
// results, execute game tools, and loop until narrative prose is available.
// Provider transport and response-format quirks live under ../model.

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
  includeToolCallHistory: boolean
  nsfw: boolean
}

export interface NarratorResult {
  text: string
  state: WorldState
  plot: string[]
  memory: Memory
  trace: TraceEvent[]
  reasoningTokens?: number
}

export const MAX_NARRATOR_ITERATIONS = 10

const FINAL_NARRATIVE_INSTRUCTION =
  'The tool phase is complete. Do not emit tool calls, JSON tool envelopes, XML function calls, analysis, or commentary. Using the recorded tool results, return only the in-character narrative response now in 1-4 paragraphs.'

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
    ctx.includeToolCallHistory,
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

  const trace: TraceEvent[] = []
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
      const interstitial = completion.text
      if (interstitial) trace.push({ kind: 'thought', text: interstitial })
      messages.push({
        role: 'assistant',
        content: completion.text,
        toolCalls: completion.toolCalls,
      })
      for (const call of completion.toolCalls) {
        // Live re-read of injected context: serve the current data instead of
        // running the game-state executor. Appended as an ordinary tool
        // result — no earlier message is rewritten.
        if (enabledToolNames.has(call.name) && isContextReadTool(call.name)) {
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
        pushToolResult(call, exec.result)
      }
      continue
    }

    const content = completion.text
    if (content)
      return {
        text: content,
        state: currentState,
        plot: currentPlot,
        memory: currentMemory,
        trace,
        reasoningTokens: totalReasoningTokens || undefined,
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
      pushNudge(
        'State updates recorded. Now provide the narrative reply in character — 2-4 short paragraphs.',
      )
      continue
    }
    throw new EmptyNarrativeError(
      completion.finishReason,
      trace,
      totalReasoningTokens || undefined,
    )
  }
  throw new Error(`Narrator loop exceeded ${MAX_NARRATOR_ITERATIONS} iterations`)
}
