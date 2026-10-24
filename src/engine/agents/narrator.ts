// Turn orchestration: two requests per turn, one per role, each its own
// append-only conversation. The Plotter goes first:
//
//   1. Plot — the Plotter reads the story up to the player's latest input,
//      the full rules, and the records as tool results. It records what the
//      last reply established, decides how the world answers the player,
//      recalls the memories the reply needs, and may steer it, looping until
//      it makes no calls.
//   2. Narrate — the narrator, with no tools, writes the reply from the story
//      and its briefing: the Plotter's world updates, recalled memories, and
//      steer, shown as the DM's own tool calls ahead of the reply. The plan,
//      the OOC edits, and the Plotter's reads stay the Plotter's.
//
// Each request extends the same role's request from the previous turn, and
// within a turn a nudge or a plotter iteration only appends, so each role
// keeps its own provider prefix cache. Provider transport and response-format
// quirks live under ../model.

import { buildTurnReminder } from '../../prompts'
import {
  CONTEXT_SUBSYSTEMS,
  buildNarratorMessages,
  buildPlotterGuidance,
  buildPlotterMessages,
  buildPlotterTools,
  type ContextFlags,
} from '../request'
import { NARRATOR_VISIBLE_TOOLS, RECALL_MEMORY_TOOL, STEER_TOOL, executeEnabledTool } from '../tools'
import { roleCacheKey } from '../model/cacheKey'
import { completeModel } from '../model/client'
import type {
  ApiProtocol,
  ModelCompletion,
  ModelMessage,
  ModelToolCall,
  ReasoningEffort,
} from '../model/types'
import type {
  AdventureSlots,
  BriefingCall,
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
  // The adventure's prompt-cache key; the Plotter and the narrator each use
  // their own key derived from it (see roleCacheKey).
  cacheKey?: string
  slots: AdventureSlots
  chronicle: Chronicle
  // The story so far, ending with the turn being played (input, no reply).
  history: Turn[]
  initialData: StoryData
  sampling: SamplingParams
  stateCleanupThreshold: number
  includePriorPlayerTurns: boolean
  reminderAsSystem: boolean
  flags: ContextFlags
  nsfw: boolean
}

// What the Plotter did, as soon as it's done, so the turn can show its trace
// while the narrator writes.
export interface Plotting {
  briefing: BriefingCall[]
  trace: TraceEvent[]
  reasoningTokens?: number
  // Set when the Plotter failed; the narrator still writes, from whatever
  // was recorded before the failure.
  error?: string
}

export interface NarratorResult {
  text: string
  data: StoryData
  // Narrate-phase events only; the plotter phase records separately so the
  // trace UI can present the two phases as distinct sections.
  trace: TraceEvent[]
  reasoningTokens?: number
  plotting?: Plotting
}

export interface NarratorHooks {
  onPlotted?: (plotting: Plotting) => void
}

export const MAX_PLOTTER_ITERATIONS = 4

// The Plotter's instruction names only the subsystems that are actually
// enabled — a static text would point the model at injections that don't
// exist and tools that aren't advertised whenever a subsystem is switched
// off. What to record lives in the rules; the instruction carries the turn's
// steps and any size hints, computed from the data at the start of the turn.
export function buildPlotterInstruction(
  flags: ContextFlags,
  data: StoryData,
  stateCleanupThreshold: number,
): string {
  const enabled = CONTEXT_SUBSYSTEMS.filter((s) => s.enabled(flags))
  const reads = enabled.map((s) => s.checkTool.name)
  const updates = enabled.map((s) => `\`${s.updateTool.name}\``)
  // With the plot plan on, the Plotter directs every reply through a steer;
  // the plan itself stays private.
  const steers = flags.includePlotOutline
  const recalls = flags.includeMemory
  const steps = [
    `Record what the last reply established that the records (the ${reads.join(' / ')} results) don’t yet hold.`,
    steers
      ? 'Pick the next meaningful development: what the world does in answer to the player — an NPC acts on what they want, a consequence lands, a secret surfaces, a thread from earlier returns — taken from the plan’s Next where it fits. Deliver what the story has set up, so the development is an event that leaves the story somewhere new; when the player holds back, the world moves on. Record the changes it brings, and update the plan.'
      : 'Work out how the world answers the player, and record the changes that follow.',
    ...(recalls
      ? [
          `Recall with \`${RECALL_MEMORY_TOOL.name}\` the remembered people, places and things the reply involves, so the narrator keeps them consistent.`,
        ]
      : []),
    ...(steers
      ? [
          `Steer every reply with \`${STEER_TOOL.name}\`: what happens and who makes it happen, playing out the consequences, including that development. A steer describes the world. When recent replies have circled one moment or one image, steer somewhere fresh.`,
        ]
      : []),
  ]
  const order = [
    `${updates.join(', ')} for the records`,
    ...(recalls ? [`\`${RECALL_MEMORY_TOOL.name}\``] : []),
    ...(steers ? [`\`${STEER_TOOL.name}\``] : []),
  ]
  const guidance = buildPlotterGuidance(data, stateCleanupThreshold, flags)
  return (
    'You are acting as the Plotter: you direct the story and keep its records, and the narrator writes the next reply from your briefing.\n' +
    steps.map((step, i) => `${i + 1}. ${step}`).join('\n') +
    `\n\nReply with tool calls alone: ${order.join(', then ')}. Update a record only where something changed.` +
    (steers ? '' : ' If there is nothing to record, reply with only the word DONE.') +
    (guidance ? `\n\n${guidance}` : '')
  )
}

// Endpoints and models found to reject a request that replays tool calls
// without offering any tools, for this browser session. The narrator then
// sends the briefing tools' schemas with calls forbidden.
const toolsRequiredForBriefing = new Set<string>()

function rejectsToolsWithoutSchemas(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /\bAPI (400|422):/.test(message) && /tool/i.test(message)
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
  const connection = { baseUrl: ctx.baseUrl, apiKey: ctx.apiKey, protocol: ctx.protocol }
  const plotterConnection = { ...connection, cacheKey: roleCacheKey(ctx.cacheKey, 'plotter') }
  const narratorConnection = { ...connection, cacheKey: roleCacheKey(ctx.cacheKey, 'narrator') }
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

  const plotterTrace: TraceEvent[] = []
  const narratorTrace: TraceEvent[] = []
  // Events land in the trace of whichever phase is active; the helpers below
  // capture this binding, so reassigning it pivots them to the narrator trace.
  let trace: TraceEvent[] = plotterTrace
  let reasoningTokens = 0
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
    reasoningTokens += completion.reasoningTokens ?? 0
  }

  // --- Phase 1: plot ---
  // The Plotter loops until it records nothing further. A plotter failure
  // never sinks the turn: what it recorded so far stands, and the narrator
  // writes from that.
  const briefing: BriefingCall[] = []
  const tools = buildPlotterTools(ctx.flags)
  let plotting: Plotting | undefined
  if (tools.length) {
    const enabledToolNames = new Set(tools.map((t) => t.name))
    const messages = buildPlotterMessages({
      ...story,
      pivot: buildPlotterInstruction(ctx.flags, data, ctx.stateCleanupThreshold),
    })
    const pushToolResult = (call: ModelToolCall, content: string) => {
      messages.push({ role: 'tool', toolCallId: call.id, content })
      trace.push({
        kind: 'call',
        name: call.name,
        arguments: call.arguments,
        result: content,
      })
    }
    // Append the model's tool-call turn and execute each call in order,
    // serving context reads from the live data and everything else through
    // the game-state executor. The calls the narrator sees join the briefing
    // unless they were rejected. Reports whether the batch contained context
    // reads or rejected calls so the loop can decide whether another
    // iteration has a purpose.
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
        const rejected = /^error\b/i.test(exec.result)
        if (rejected || /^partial\b/i.test(exec.result)) sawError = true
        if (!rejected && NARRATOR_VISIBLE_TOOLS.has(call.name)) {
          briefing.push({ name: call.name, arguments: call.arguments, result: exec.result })
        }
        pushToolResult(call, exec.result)
      }
      return { sawError, sawRead }
    }
    let error: string | undefined
    // With the plot plan on, every reply is steered. A Plotter that stops
    // without a steer — after a batch of updates, or by writing prose in
    // the narrator's place — is reminded once.
    let steerNudged = false
    const needsSteerNudge = () =>
      ctx.flags.includePlotOutline &&
      !steerNudged &&
      !briefing.some((c) => c.name === STEER_TOOL.name)
    const nudgeForSteer = () => {
      steerNudged = true
      pushNudge(messages, `Steer the reply now with \`${STEER_TOOL.name}\`, using tool calls alone.`)
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
          plotterConnection,
          signal,
        )
        recordCompletion(label, completion, Date.now() - startedAt)
        if (completion.text && completion.text.trim().toUpperCase() !== 'DONE') {
          trace.push({ kind: 'thought', text: completion.text })
        }
        if (!completion.toolCalls.length) {
          if (!needsSteerNudge()) break
          if (completion.text) messages.push({ role: 'assistant', content: completion.text })
          nudgeForSteer()
          continue
        }
        const batch = handleToolCalls(completion)
        // A clean batch is the normal end of the phase. Iterate only when
        // there is something concrete left to do — repair a rejected call,
        // act on a context read the model chose to make, or add a missing
        // steer.
        if (!batch.sawError && !batch.sawRead) {
          if (!needsSteerNudge()) break
          nudgeForSteer()
          continue
        }
        if (batch.sawError) {
          pushNudge(
            messages,
            'One or more Plotter calls were rejected — see the tool results above. Re-issue the corrected calls now, or reply with only the word DONE to leave them unrecorded.',
          )
        }
      }
    } catch (err) {
      if (signal.aborted) throw err
      error = err instanceof Error ? err.message : String(err)
      trace.push({
        kind: 'thought',
        text: `(plotter failed: ${error} — what was recorded so far stands, and the narrator writes from it)`,
      })
    }
    plotting = {
      briefing: [...briefing],
      trace: [...plotterTrace],
      reasoningTokens: reasoningTokens || undefined,
      error,
    }
    hooks.onPlotted?.(plotting)
  }

  // --- Phase 2: narrate ---
  // No tools are offered, so the reply is prose or nothing; a call-shaped
  // reply is quarantined by the model boundary and shows up as an anomaly.
  // An empty reply gets one nudge: the turn reminder again.
  trace = narratorTrace
  const plotterReasoningTokens = reasoningTokens
  const latest = ctx.history.length - 1
  const narratorMessages = buildNarratorMessages({
    ...story,
    history: ctx.history.map((t, i) => (i === latest ? { ...t, briefing } : t)),
    data,
  })
  // A provider that won't take replayed tool calls without schemas gets the
  // briefing tools' schemas, with calls forbidden.
  const capabilityKey = `${ctx.baseUrl}\u0000${ctx.model}`
  const briefingSchemas = tools.filter((t) => NARRATOR_VISIBLE_TOOLS.has(t.name))
  const narrate = async (label: string): Promise<ModelCompletion> => {
    const attempt = (withSchemas: boolean) =>
      completeModel(
        {
          model: ctx.model,
          reasoningEffort: ctx.reasoningEffort,
          messages: narratorMessages,
          ...(withSchemas ? { tools: briefingSchemas, toolChoice: 'none' as const } : {}),
          temperature: ctx.sampling.temperature,
          label,
        },
        narratorConnection,
        signal,
      )
    const replaysCalls = narratorMessages.some((m) => m.toolCalls?.length)
    const withSchemas = replaysCalls && toolsRequiredForBriefing.has(capabilityKey)
    try {
      return await attempt(withSchemas)
    } catch (err) {
      if (withSchemas || !replaysCalls || signal.aborted || !rejectsToolsWithoutSchemas(err)) throw err
      toolsRequiredForBriefing.add(capabilityKey)
      trace.push({
        kind: 'thought',
        text: '(the provider rejected replayed tool calls without tools; resent with the briefing tools offered and calls forbidden)',
      })
      return attempt(true)
    }
  }
  let proseText = ''
  for (let attempt = 0; ; attempt++) {
    const label = `narrator:${attempt}`
    const startedAt = Date.now()
    const completion = await narrate(label)
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
        reasoningTokens - plotterReasoningTokens || undefined,
      )
    }
    pushNudge(narratorMessages, buildTurnReminder())
  }

  return {
    text: proseText,
    data,
    trace: narratorTrace,
    reasoningTokens: reasoningTokens - plotterReasoningTokens || undefined,
    plotting,
  }
}
