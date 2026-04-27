// Planner agent. Reads the chronicle, recent turns, and current state/plot,
// then returns a director's-note instruction for the Narrator. Uses the same
// update_state / plot_update tools as the Narrator so it can record any new
// facts the last turn established and re-aim the plot outline.
//
// Coexists with the single-call narrator path; runs only when ContextConfig
// .usePlanner is on. The instruction text is stored for inspection and (in a
// later iteration) will be piped into the writer/narrator's input.

import { PLANNER_SYSTEM_PROMPT } from '../../prompts'
import {
  buildApiMessagesIndexed,
  buildPlotSystemMessage,
  buildStateSystemMessage,
} from '../request'
import { PLOT_UPDATE_TOOL, UPDATE_STATE_TOOL, executeTool, parseInlineToolCalls } from '../tools'
import { modelSupportsSampling, xaiChat } from '../xai'
import type {
  AdventureSlots,
  Chronicle,
  ModelCall,
  SamplingParams,
  ToolCall,
  TraceEvent,
  Turn,
  WorldState,
} from '../types'

export interface PlannerContext {
  model: string
  apiKey: string
  slots: AdventureSlots
  chronicle: Chronicle
  history: Turn[]
  state: WorldState
  plot: string[]
  sampling: SamplingParams
  stateCleanupThreshold: number
  includeWorldState: boolean
  includePlotOutline: boolean
}

export interface PlannerResult {
  call: ModelCall
  state: WorldState
  plot: string[]
}

export async function runPlanner(
  ctx: PlannerContext,
  signal: AbortSignal,
): Promise<PlannerResult> {
  const callId = crypto.randomUUID()
  const startedAt = Date.now()
  let currentState = ctx.state
  let currentPlot = ctx.plot
  // Reuse the narrator's request-builder, but swap in the planner system
  // prompt as the first message. The history rendering rules (player input
  // included only for the in-flight turn, etc.) are identical — both agents
  // consume the same conversation shape.
  const { messages: apiMessages, stateIndex, plotIndex } = buildApiMessagesIndexed(
    PLANNER_SYSTEM_PROMPT,
    ctx.slots,
    ctx.chronicle,
    ctx.history,
    currentState,
    currentPlot,
    ctx.stateCleanupThreshold,
    true, // include the player's input on the in-flight turn (planner needs it)
    ctx.includeWorldState,
    ctx.includePlotOutline,
  )

  const tools: unknown[] = []
  if (ctx.includeWorldState) tools.push(UPDATE_STATE_TOOL)
  if (ctx.includePlotOutline) tools.push(PLOT_UPDATE_TOOL)

  const trace: TraceEvent[] = []
  let totalReasoningTokens = 0
  const pushToolResult = (call: ToolCall, content: string) => {
    apiMessages.push({ role: 'tool', tool_call_id: call.id, content })
    trace.push({
      kind: 'call',
      name: call.function?.name ?? '(unknown)',
      arguments: call.function?.arguments ?? '',
      result: content,
    })
  }

  const finishCall = (text: string): ModelCall => ({
    id: callId,
    model: ctx.model,
    text,
    trace,
    reasoningTokens: totalReasoningTokens || undefined,
    durationMs: Date.now() - startedAt,
  })

  let nudged = false
  let wrapUpForced = false
  // Cap higher than narrator (8). Planner is allowed a couple of tool rounds
  // before we force a wrap-up below.
  const MAX_ITER = 12
  // After this many iterations of tool-calling-without-text, strip the tools
  // and demand the instruction. Some models will otherwise spin until the
  // ceiling, calling update_state path-by-path or re-checking themselves.
  const FORCE_WRAP_AT = 3
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const offerTools = tools.length > 0 && iter < FORCE_WRAP_AT
    if (!offerTools && tools.length > 0 && !wrapUpForced) {
      wrapUpForced = true
      apiMessages.push({
        role: 'user',
        content:
          '(OOC: Tool work is done for this turn. Tools are no longer offered. Write the planning instruction for the Narrator now — three to six short paragraphs, no XML, no tool calls.)',
      })
    }
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: apiMessages,
      stream: false,
    }
    if (offerTools) body.tools = tools
    if (modelSupportsSampling(ctx.model)) {
      body.temperature = ctx.sampling.temperature
      body.frequency_penalty = ctx.sampling.frequencyPenalty
      body.presence_penalty = ctx.sampling.presencePenalty
    }
    console.debug('[planner] xAI request', { iter, model: ctx.model, toolCount: offerTools ? tools.length : 0, body })
    const res = await xaiChat(body, ctx.apiKey, signal)

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`planner ${res.status}: ${errBody.slice(0, 200) || res.statusText}`)
    }

    const rawData = (await res.json()) as unknown
    console.debug('[planner] xAI response', { iter, rawData })
    const data = rawData as {
      choices?: {
        finish_reason?: string
        message?: {
          content?: string
          reasoning_content?: string
          tool_calls?: ToolCall[]
        }
      }[]
      usage?: {
        completion_tokens_details?: { reasoning_tokens?: number }
      }
    }
    const choice = data.choices?.[0]
    const msg = choice?.message
    const finishReason = choice?.finish_reason
    if (!msg) throw new Error('Empty response from planner (no message)')

    const reasoning = msg.reasoning_content?.trim()
    if (reasoning) trace.push({ kind: 'reasoning', text: reasoning })
    const iterReasoningTokens =
      data.usage?.completion_tokens_details?.reasoning_tokens ?? 0
    if (iterReasoningTokens > 0) totalReasoningTokens += iterReasoningTokens

    if (msg.tool_calls?.length) {
      const interstitial = msg.content?.trim()
      if (interstitial) trace.push({ kind: 'thought', text: interstitial })
      apiMessages.push({
        role: 'assistant',
        content: msg.content ?? '',
        tool_calls: msg.tool_calls,
      })
      for (const call of msg.tool_calls) {
        const name = call.function?.name ?? '(anonymous)'
        const rawArgs = call.function?.arguments ?? ''
        const exec = executeTool(name, rawArgs, currentState, currentPlot)
        currentState = exec.state
        currentPlot = exec.plot
        pushToolResult(call, exec.result)
      }
      if (stateIndex >= 0) {
        apiMessages[stateIndex] = buildStateSystemMessage(currentState, ctx.stateCleanupThreshold)
      }
      if (plotIndex >= 0) {
        apiMessages[plotIndex] = buildPlotSystemMessage(currentPlot)
      }
      continue
    }

    const content = msg.content?.trim() ?? ''
    const { cleaned, calls: inlineCalls } = parseInlineToolCalls(content)
    if (inlineCalls.length) {
      console.warn('[planner] extracted inline tool calls from instruction', {
        count: inlineCalls.length,
        names: inlineCalls.map((c) => c.name),
      })
      apiMessages.push({ role: 'assistant', content })
      for (const call of inlineCalls) {
        const exec = executeTool(call.name, call.arguments, currentState, currentPlot)
        currentState = exec.state
        currentPlot = exec.plot
        trace.push({
          kind: 'call',
          name: `${call.name} (inline)`,
          arguments: call.arguments,
          result: exec.result,
        })
      }
      if (stateIndex >= 0) {
        apiMessages[stateIndex] = buildStateSystemMessage(currentState, ctx.stateCleanupThreshold)
      }
      if (plotIndex >= 0) {
        apiMessages[plotIndex] = buildPlotSystemMessage(currentPlot)
      }
      if (cleaned) {
        return { call: finishCall(cleaned), state: currentState, plot: currentPlot }
      }
      if (!nudged) {
        nudged = true
        apiMessages.push({
          role: 'user',
          content:
            '(OOC: Inline tool calls extracted. Use the structured tool API. Now write the planning instruction for the Narrator — three to six short paragraphs, no XML tags.)',
        })
        continue
      }
      throw new Error('Planner output was entirely inline tool calls with no instruction text')
    }
    if (content) {
      return { call: finishCall(content), state: currentState, plot: currentPlot }
    }

    console.warn('[planner] empty xAI message', { iter, finishReason, data })
    if (!nudged) {
      nudged = true
      apiMessages.push({
        role: 'user',
        content:
          '(OOC: State updates recorded. Now write the planning instruction for the Narrator — three to six short paragraphs.)',
      })
      continue
    }
    throw new Error(`Empty planner instruction (finish_reason=${finishReason ?? 'unknown'})`)
  }
  throw new Error('Planner tool-call loop exceeded max iterations')
}
