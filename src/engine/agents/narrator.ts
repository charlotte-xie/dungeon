// Narrator orchestration: two requests per turn, one per role, each its own
// append-only conversation:
//
//   1. Narrate — the narrator writes the turn's prose from the story so far,
//      the current records, and a one-line note on each. It is offered no
//      tools and never sees the record-keeping rules.
//   2. Plot — the Plotter gets its own request: the same story, the full
//      rules, the records as tool results, then the prose and a pivot
//      instruction. It compares the narration against the records and
//      records every material change via the update tools, looping until it
//      makes no calls.
//
// Each request extends the same role's request from the previous turn up to
// the latest input, and within a turn a nudge or a plotter iteration only
// appends, so each role keeps its own provider prefix cache. Updates reflect
// what was actually narrated rather than what the model intended to write.
// Provider transport and response-format quirks live under ../model.

import { buildTurnReminder } from '../../prompts'
import {
  CONTEXT_SUBSYSTEMS,
  buildNarratorMessages,
  buildPlotterGuidance,
  buildPlotterMessages,
  type ContextFlags,
} from '../request'
import { executeEnabledTool } from '../tools'
import { completeModel } from '../model/client'
import type {
  ApiProtocol,
  ModelCompletion,
  ModelMessage,
  ModelToolCall,
  ModelToolDefinition,
  ReasoningEffort,
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
  reasoningEffort?: ReasoningEffort
  plotterModel?: string
  plotterReasoning?: ReasoningEffort
  apiKey: string
  baseUrl: string
  protocol: ApiProtocol
  // The adventure's prompt-cache key; see ModelConnection.
  cacheKey?: string
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
  plotterReasoningTokens?: number
  // Set when the plotter phase failed; the prose and any updates recorded
  // before the failure are still returned.
  plotterError?: string
  reasoningTokens?: number
}

// The narration as soon as it's written, before the Plotter phase records the
// turn, so the reply can be shown while the bookkeeping runs.
export interface Narration {
  text: string
  trace: TraceEvent[]
  reasoningTokens?: number
}

export interface NarratorHooks {
  onNarrated?: (narration: Narration) => void
}

export const MAX_PLOTTER_ITERATIONS = 4

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

// The tools the Plotter is offered: each enabled subsystem's update and read
// tools.
export function plotterTools(flags: ContextFlags): ModelToolDefinition[] {
  return CONTEXT_SUBSYSTEMS.filter((s) => s.enabled(flags)).flatMap((s) => [
    s.updateTool,
    s.checkTool,
  ])
}

/**
 * Thrown when the model ends its turn (finish_reason=stop) with no narrative
 * prose, even after being nudged. Carries the trace so the UI can still
 * surface what the DM was thinking instead of just a bare error line.
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
  hooks: NarratorHooks = {},
): Promise<NarratorResult> {
  let data = ctx.initialData
  const connection = {
    baseUrl: ctx.baseUrl,
    apiKey: ctx.apiKey,
    protocol: ctx.protocol,
    cacheKey: ctx.cacheKey,
  }
  const story = {
    systemPrompt: ctx.systemPrompt,
    slots: ctx.slots,
    chronicle: ctx.chronicle,
    history: ctx.history,
    data: ctx.initialData,
    includePriorPlayerTurns: ctx.includePriorPlayerTurns,
    flags: ctx.flags,
    nsfw: ctx.nsfw,
    reminderAsSystem: ctx.reminderAsSystem,
  }

  const narratorTrace: TraceEvent[] = []
  const plotterTrace: TraceEvent[] = []
  // Events land in the trace of whichever phase is active; the helpers below
  // capture this binding, so reassigning it pivots them to the plotter trace.
  let trace: TraceEvent[] = narratorTrace
  let totalReasoningTokens = 0
  // Re-prompt the model after a reply with no usable output. Honours
  // ctx.reminderAsSystem (same convention as the turn reminder): a true system
  // message when asSystem, otherwise an in-channel (OOC: ...) user message.
  // The trace records the exact text sent.
  const pushNudge = (messages: ModelMessage[], instruction: string) => {
    const message = ctx.reminderAsSystem
      ? { role: 'system' as const, content: instruction }
      : { role: 'user' as const, content: `(OOC: ${instruction})` }
    messages.push(message)
    trace.push({
      kind: 'thought',
      text: `(nudge → ${message.role}) ${message.content}`,
    })
  }
  // Shared by both phases: file a completion's timing and prompt usage (the
  // provider's own cached-token count is the evidence that prefix caching is
  // working), reasoning, and protocol anomalies into the active trace.
  const recordCompletion = (label: string, completion: ModelCompletion, durationMs: number) => {
    trace.push({
      kind: 'usage',
      label,
      promptTokens: completion.promptTokens,
      cachedTokens: completion.cachedTokens,
      durationMs,
    })
    for (const reasoning of completion.reasoning) {
      trace.push({ kind: 'reasoning', text: reasoning })
    }
    for (const anomaly of completion.anomalies) {
      trace.push({ kind: 'thought', text: `(model protocol: ${anomaly.detail})` })
    }
    const iterReasoningTokens = completion.reasoningTokens ?? 0
    if (iterReasoningTokens > 0) totalReasoningTokens += iterReasoningTokens
  }

  // --- Phase 1: narrate ---
  // No tools are offered, so the reply is prose or nothing; a call-shaped
  // reply is quarantined by the model boundary and shows up as an anomaly.
  // An empty reply gets one nudge: the turn reminder again.
  const narratorMessages = buildNarratorMessages(story)
  console.debug('[dm] narrator request — records at the tail as plain text', {
    initialData: ctx.initialData,
  })
  let proseText = ''
  for (let attempt = 0; ; attempt++) {
    const label = `narrator:${attempt}`
    const startedAt = Date.now()
    const completion = await completeModel(
      {
        model: ctx.model,
        reasoningEffort: ctx.reasoningEffort,
        messages: narratorMessages,
        temperature: ctx.sampling.temperature,
        label,
      },
      connection,
      signal,
    )
    recordCompletion(label, completion, Date.now() - startedAt)
    if (completion.text) {
      proseText = completion.text
      break
    }
    console.warn('[dm] empty model message', { attempt, completion })
    if (attempt > 0) {
      throw new EmptyNarrativeError(
        completion.finishReason,
        trace,
        totalReasoningTokens || undefined,
      )
    }
    pushNudge(narratorMessages, buildTurnReminder())
  }
  hooks.onNarrated?.({
    text: proseText,
    trace: [...narratorTrace],
    reasoningTokens: totalReasoningTokens || undefined,
  })

  // --- Phase 2: plot ---
  // The Plotter's own conversation ends with the prose and the pivot; it
  // loops until it records nothing further. A plotter failure never loses the
  // turn: the prose and any updates recorded so far are kept, and the rest of
  // the state simply carries forward.
  const narratorReasoningTokens = totalReasoningTokens
  let plotterError: string | undefined
  const tools = plotterTools(ctx.flags)
  if (tools.length) {
    const enabledToolNames = new Set(tools.map((t) => t.name))
    const messages = buildPlotterMessages({
      ...story,
      prose: proseText,
      pivot: buildPlotterInstruction(ctx.flags, data, ctx.stateCleanupThreshold),
    })
    trace = plotterTrace
    const pushToolResult = (call: ModelToolCall, content: string) => {
      messages.push({ role: 'tool', toolCallId: call.id, content })
      trace.push({
        kind: 'call',
        name: call.name,
        arguments: call.arguments,
        result: content,
      })
    }
    // Append the model's tool-call turn and execute each call, serving
    // context reads from the live data and mutations through the game-state
    // executor. Reports whether the batch contained context reads or rejected
    // calls so the loop can decide whether another iteration has a purpose.
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
    try {
      for (let iter = 0; iter < MAX_PLOTTER_ITERATIONS; iter++) {
        const label = `plotter:${iter}`
        const startedAt = Date.now()
        const completion = await completeModel(
          {
            model: ctx.plotterModel?.trim() || ctx.model,
            reasoningEffort: ctx.plotterReasoning,
            messages,
            tools,
            temperature: ctx.sampling.temperature,
            label,
          },
          connection,
          signal,
        )
        recordCompletion(label, completion, Date.now() - startedAt)
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
            messages,
            'One or more Plotter calls were rejected — see the tool results above. Re-issue the corrected calls now, or reply with only the word DONE to leave them unrecorded.',
          )
        }
      }
    } catch (err) {
      if (signal.aborted) throw err
      const msg = err instanceof Error ? err.message : String(err)
      plotterError = msg
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
    reasoningTokens: narratorReasoningTokens || undefined,
    plotterReasoningTokens: (totalReasoningTokens - narratorReasoningTokens) || undefined,
    plotterError,
  }
}
