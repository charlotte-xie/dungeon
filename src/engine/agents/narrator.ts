// The single-call DM path: one xAI request that does everything — prose +
// state/plot tool calls in a single tool-use loop.

import {
  applyTurnReminder,
  buildApiMessagesIndexed,
  buildMemorySystemMessage,
  buildPlotSystemMessage,
  buildStateSystemMessage,
} from '../request'
import {
  FUTURE_PLOT_PLAN_TOOL,
  UPDATE_MEMORY_TOOL,
  UPDATE_STATE_TOOL,
  executeTool,
  parseInlineToolCalls,
} from '../tools'
import { modelSupportsSampling, xaiChat } from '../xai'
import type {
  AdventureSlots,
  Chronicle,
  Memory,
  SamplingParams,
  ToolCall,
  TraceEvent,
  Turn,
  WorldState,
} from '../types'

export interface NarratorContext {
  systemPrompt: string
  model: string
  apiKey: string
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
  trace: TraceEvent[]
  reasoningTokens?: number
}

export async function runNarrator(
  ctx: NarratorContext,
  signal: AbortSignal,
): Promise<NarratorResult> {
  let currentState = ctx.initialState
  let currentPlot = ctx.initialPlot
  let currentMemory = ctx.initialMemory
  const { messages: apiMessages, stateIndex, plotIndex, memoryIndex } = buildApiMessagesIndexed(
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
  const tools: unknown[] = []
  if (ctx.includeMemory) tools.push(UPDATE_MEMORY_TOOL)
  if (ctx.includeWorldState) tools.push(UPDATE_STATE_TOOL)
  if (ctx.includePlotOutline) tools.push(FUTURE_PLOT_PLAN_TOOL)

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

  let nudged = false
  for (let iter = 0; iter < 8; iter++) {
    const reminded = applyTurnReminder(apiMessages, ctx.reminderAsSystem)
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: reminded,
      stream: false,
    }
    if (tools.length) body.tools = tools
    if (modelSupportsSampling(ctx.model)) {
      body.temperature = ctx.sampling.temperature
    }
    if (iter === 0) {
      console.debug('[dm] narrator iter 0 — memory/plot/state slices the model sees', {
        initialMemory: ctx.initialMemory,
        initialMemoryKeys: Object.keys(ctx.initialMemory),
        initialPlot: ctx.initialPlot,
        initialState: ctx.initialState,
        memorySystemMessage: memoryIndex >= 0 ? apiMessages[memoryIndex]?.content : '(disabled)',
        plotSystemMessage: plotIndex >= 0 ? apiMessages[plotIndex]?.content : '(disabled)',
        stateSystemMessage: stateIndex >= 0 ? apiMessages[stateIndex]?.content : '(disabled)',
      })
    }
    console.debug('[dm] xAI request', { iter, model: ctx.model, toolCount: (body.tools as unknown[])?.length, body })
    const res = await xaiChat(body, ctx.apiKey, signal)

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      throw new Error(`xAI ${res.status}: ${errBody.slice(0, 200) || res.statusText}`)
    }

    const rawData = (await res.json()) as unknown
    console.debug('[dm] xAI response', { iter, rawData })
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
    if (!msg) throw new Error('Empty response from xAI (no message)')

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
        const exec = executeTool(name, rawArgs, currentState, currentPlot, currentMemory)
        currentState = exec.state
        currentPlot = exec.plot
        currentMemory = exec.memory
        pushToolResult(call, exec.result)
      }
      if (stateIndex >= 0) {
        apiMessages[stateIndex] = buildStateSystemMessage(currentState, ctx.stateCleanupThreshold)
      }
      if (plotIndex >= 0) {
        apiMessages[plotIndex] = buildPlotSystemMessage(currentPlot)
      }
      if (memoryIndex >= 0) {
        apiMessages[memoryIndex] = buildMemorySystemMessage(currentMemory)
      }
      continue
    }

    const content = msg.content?.trim() ?? ''
    const { cleaned, calls: inlineCalls } = parseInlineToolCalls(content)
    if (inlineCalls.length) {
      console.warn('[dm] extracted inline tool calls from narrative', {
        count: inlineCalls.length,
        names: inlineCalls.map((c) => c.name),
      })
      apiMessages.push({
        role: 'assistant',
        content,
      })
      for (const call of inlineCalls) {
        const exec = executeTool(call.name, call.arguments, currentState, currentPlot, currentMemory)
        currentState = exec.state
        currentPlot = exec.plot
        currentMemory = exec.memory
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
      if (memoryIndex >= 0) {
        apiMessages[memoryIndex] = buildMemorySystemMessage(currentMemory)
      }
      if (cleaned)
        return {
          text: cleaned,
          state: currentState,
          plot: currentPlot,
          memory: currentMemory,
          trace,
          reasoningTokens: totalReasoningTokens || undefined,
        }
      if (!nudged) {
        nudged = true
        apiMessages.push({
          role: 'user',
          content:
            '(OOC: Inline tool calls extracted. Use the structured tool API next time. Now provide the narrative reply — 2-4 short paragraphs, no XML tags.)',
        })
        continue
      }
      throw new Error('Narrative reply was entirely inline tool calls with no remaining prose')
    }
    if (content)
      return {
        text: content,
        state: currentState,
        plot: currentPlot,
        memory: currentMemory,
        trace,
        reasoningTokens: totalReasoningTokens || undefined,
      }

    console.warn('[dm] empty xAI message', { iter, finishReason, data })
    if (!nudged) {
      nudged = true
      apiMessages.push({
        role: 'user',
        content:
          '(OOC: State updates recorded. Now provide the narrative reply in character — 2-4 short paragraphs.)',
      })
      continue
    }
    throw new Error(`Empty narrative reply (finish_reason=${finishReason ?? 'unknown'})`)
  }
  throw new Error('Tool-call loop exceeded max iterations')
}
