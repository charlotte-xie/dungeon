// Turn orchestration: two requests per turn, one per role, each its own
// append-only conversation. The Plotter goes first:
//
//   1. Plot — the Plotter reads the story up to the player's latest input,
//      the full rules, and the records as tool results. It records what the
//      last reply established, decides how the world answers the player,
//      recalls the memories the reply needs, and may steer it, looping until
//      it makes no calls.
//   2. Narrate — the narrator, with no tools, writes the reply from the story
//      and two calls the DM appears to have made, built from the Plotter's
//      briefing: the turn's story update, which stays in history (memories
//      recalled or changed, the OOC list when it changed),
//      and its notes for this reply alone (the scene and the steer). The
//      records' updates, the plan, the OOC edits, and the Plotter's reads
//      stay the Plotter's.
//
// Each request extends the same role's request from the previous turn, and
// within a turn a nudge or a plotter iteration only appends, so each role
// keeps its own provider prefix cache. Provider transport and response-format
// quirks live under ../model.

import { buildTurnReminder, plotterTurnText, type PlotterTurnSection } from '../../prompts'
import {
  CONTEXT_SUBSYSTEMS,
  buildNarratorMessages,
  buildPlotterGuidance,
  buildPlotterMessages,
  buildPlotterTools,
  buildReplyNotes,
  buildStoryUpdate,
  renderStoryUpdate,
  type ContextFlags,
} from '../request'
import {
  BRIEFING_TOOLS,
  RECALL_MEMORY_TOOL,
  REPLY_NOTES_TOOL,
  STEER_TOOL,
  STORY_UPDATE_TOOL,
  executeEnabledTool,
} from '../tools'
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
  StoryUpdate,
  TraceEvent,
  Turn,
  TurnKind,
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
  // What the turn adds to the narrator's history, saved with the turn.
  storyUpdate?: StoryUpdate
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

// The Plotter's instruction for the turn: its steps, worded in
// plotter-turn.md, for the records that are switched on only — a step for a
// switched-off record would point the model at injections that don't exist
// and tools that aren't advertised. The principles live in the Plotter's
// system prompt and what to record in the rules; the instruction carries the
// turn's steps and any size hints, computed from the data at the start of
// the turn.
export function buildPlotterInstruction(
  flags: ContextFlags,
  data: StoryData,
  stateCleanupThreshold: number,
  // The opening has no reply to record from: the Plotter sets the records
  // and the plan up from the scenario instead.
  kind: TurnKind = 'player',
): string {
  const opening = kind === 'bootstrap'
  const enabled = CONTEXT_SUBSYSTEMS.filter((s) => s.enabled(flags))
  // With the plot plan on, the Plotter directs every reply through a steer;
  // the plan itself stays private.
  const steers = flags.includePlotOutline
  const recalls = flags.includeMemory
  const vars = {
    reply: opening ? 'the opening' : 'the next reply',
    reads: enabled.map((s) => s.checkTool.name).join(' / '),
    recall: RECALL_MEMORY_TOOL.name,
    steer: STEER_TOOL.name,
    order: [
      `${enabled.map((s) => `\`${s.updateTool.name}\``).join(', ')} for the records`,
      ...(recalls ? [`\`${RECALL_MEMORY_TOOL.name}\``] : []),
      ...(steers ? [`\`${STEER_TOOL.name}\``] : []),
    ].join(', then '),
  }
  const text = (name: PlotterTurnSection) => plotterTurnText(name, vars)
  const steps: PlotterTurnSection[] = opening
    ? [
        'opening-setup',
        ...(steers ? ['opening-plan' as const] : []),
        ...(recalls ? ['opening-recall' as const] : []),
        ...(steers ? ['opening-steer' as const] : []),
      ]
    : [
        'record',
        kind === 'continue' ? 'develop-continue' : 'develop',
        ...(recalls ? ['recall' as const] : []),
        ...(steers ? ['steer' as const] : []),
      ]
  const guidance = buildPlotterGuidance(data, stateCleanupThreshold, flags)
  return (
    `${text('intro')}\n` +
    steps.map((step, i) => `${i + 1}. ${text(step)}`).join('\n') +
    `\n\n${text('order')}` +
    (steers ? '' : ` ${text('done')}`) +
    (guidance ? `\n\n${guidance}` : '')
  )
}

// Endpoints and models found to reject a request that replays tool calls
// without offering any tools, for this browser session. The narrator then
// sends the schemas of its own calls with calls forbidden.
const toolsRequiredForOwnCalls = new Set<string>()

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
  // The turn being played gets its story update once the Plotter is done.
  const latest = ctx.history.length - 1
  const story = {
    systemPrompt: ctx.systemPrompt,
    slots: ctx.slots,
    chronicle: ctx.chronicle,
    history: ctx.history.map((t, i) => (i === latest ? { ...t, storyUpdate: undefined } : t)),
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
      pivot: buildPlotterInstruction(
        ctx.flags,
        data,
        ctx.stateCleanupThreshold,
        ctx.history.at(-1)?.kind,
      ),
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
    // the game-state executor. Recalls and steers join the briefing unless
    // they were rejected. Reports whether the batch contained context
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
        if (!rejected && BRIEFING_TOOLS.has(call.name)) {
          briefing.push({ name: call.name, arguments: call.arguments, result: exec.result })
        }
        pushToolResult(call, exec.result)
      }
      return { sawError, sawRead }
    }
    let error: string | undefined
    // With the plot plan on, every reply is steered. A Plotter that stops
    // without a steer — after a batch of updates, or by writing prose in
    // the narrator's place — is reminded once, and the request after the
    // reminder has it make a call.
    let steerNudged = false
    let forceCall = false
    const needsSteerNudge = () =>
      ctx.flags.includePlotOutline &&
      !steerNudged &&
      !briefing.some((c) => c.name === STEER_TOOL.name)
    const nudgeForSteer = () => {
      steerNudged = true
      forceCall = true
      pushNudge(messages, plotterTurnText('nudge-steer', { steer: STEER_TOOL.name }))
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
            ...(forceCall ? { toolChoice: 'required' as const } : {}),
            temperature: ctx.sampling.temperature,
            label,
          },
          plotterConnection,
          signal,
        )
        forceCall = false
        recordCompletion(label, completion, Date.now() - startedAt)
        if (completion.text && completion.text.trim().toUpperCase() !== 'DONE') {
          trace.push({ kind: 'thought', text: completion.text })
        }
        if (!completion.toolCalls.length) {
          if (!needsSteerNudge()) break
          // Its prose stays out of its conversation: fed back, it was copied
          // word for word in place of the steer. The request still only
          // appends, since the prose was never part of it.
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
          pushNudge(messages, plotterTurnText('nudge-rejected'))
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
      storyUpdate: buildStoryUpdate(ctx.history.slice(0, latest), briefing, data, ctx.flags),
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
  const storyUpdate = plotting?.storyUpdate
  const narratorMessages = buildNarratorMessages({
    ...story,
    history: story.history.map((t, i) => (i === latest ? { ...t, storyUpdate } : t)),
    data,
    briefing,
  })
  // The story update and the notes show in the narrator's trace, which is
  // never replayed into either role's context.
  if (storyUpdate) {
    trace.push({
      kind: 'call',
      name: STORY_UPDATE_TOOL.name,
      arguments: '{}',
      result: renderStoryUpdate(storyUpdate),
    })
  }
  const notes = buildReplyNotes(briefing, data, ctx.flags)
  if (notes) trace.push({ kind: 'call', name: REPLY_NOTES_TOOL.name, arguments: '{}', result: notes })
  // A provider that won't take a replayed tool call without schemas gets the
  // schemas of the narrator's own calls, with calls forbidden.
  const capabilityKey = `${ctx.baseUrl}\u0000${ctx.model}`
  const narrate = async (label: string): Promise<ModelCompletion> => {
    const attempt = (withSchemas: boolean) =>
      completeModel(
        {
          model: ctx.model,
          reasoningEffort: ctx.reasoningEffort,
          messages: narratorMessages,
          ...(withSchemas
            ? { tools: [STORY_UPDATE_TOOL, REPLY_NOTES_TOOL], toolChoice: 'none' as const }
            : {}),
          temperature: ctx.sampling.temperature,
          label,
        },
        narratorConnection,
        signal,
      )
    const replaysCalls = narratorMessages.some((m) => m.toolCalls?.length)
    const withSchemas = replaysCalls && toolsRequiredForOwnCalls.has(capabilityKey)
    try {
      return await attempt(withSchemas)
    } catch (err) {
      if (withSchemas || !replaysCalls || signal.aborted || !rejectsToolsWithoutSchemas(err)) throw err
      toolsRequiredForOwnCalls.add(capabilityKey)
      trace.push({
        kind: 'thought',
        text: '(the provider rejected replayed tool calls without tools; resent with the narrator’s own tools offered and calls forbidden)',
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
    pushNudge(narratorMessages, buildTurnReminder(ctx.history.at(-1)?.kind))
  }

  return {
    text: proseText,
    data,
    trace: narratorTrace,
    reasoningTokens: reasoningTokens - plotterReasoningTokens || undefined,
    plotting,
  }
}
