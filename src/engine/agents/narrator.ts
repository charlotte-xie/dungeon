// The single-call DM path: one xAI request that does everything — prose +
// state/plot tool calls in a single tool-use loop. The original "askDungeonMaster".
// Coexists with the planner+writer experimental path.

import {
  applyTurnReminder,
  buildApiMessagesIndexed,
  buildPlotSystemMessage,
  buildStateSystemMessage,
} from '../request'
import { PLOT_UPDATE_TOOL, UPDATE_STATE_TOOL, executeTool, parseInlineToolCalls } from '../tools'
import { modelSupportsSampling, xaiChat } from '../xai'
import type {
  AdventureSlots,
  Chronicle,
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
  sampling: SamplingParams
  stateCleanupThreshold: number
  includePriorPlayerTurns: boolean
  appendReminderToUser: boolean
  includeWorldState: boolean
  includePlotOutline: boolean
  nsfw: boolean
  // When true, drop update_state / plot_update from the offered tool set —
  // the planner already handled state/plot mutations for this turn and the
  // narrator is purely a writer.
  disableMutationTools?: boolean
  // Director's-note from the planner. Injected as the final system message
  // (after the turn reminder) so it's the freshest guidance the model sees
  // before generating prose. Omit when running the single-call path.
  plannerInstruction?: string
}

export interface NarratorResult {
  text: string
  state: WorldState
  plot: string[]
  trace: TraceEvent[]
  reasoningTokens?: number
}

export async function runNarrator(
  ctx: NarratorContext,
  signal: AbortSignal,
): Promise<NarratorResult> {
  let currentState = ctx.initialState
  let currentPlot = ctx.initialPlot
  const { messages: apiMessages, stateIndex, plotIndex } = buildApiMessagesIndexed(
    ctx.systemPrompt,
    ctx.slots,
    ctx.chronicle,
    ctx.history,
    currentState,
    currentPlot,
    ctx.stateCleanupThreshold,
    ctx.includePriorPlayerTurns,
    ctx.includeWorldState,
    ctx.includePlotOutline,
    ctx.nsfw,
  )
  const tools: unknown[] = []
  if (!ctx.disableMutationTools) {
    if (ctx.includeWorldState) tools.push(UPDATE_STATE_TOOL)
    if (ctx.includePlotOutline) tools.push(PLOT_UPDATE_TOOL)
  }

  const plannerSystemMessage = ctx.plannerInstruction
    ? {
        role: 'system' as const,
        content:
          `# PLANNER INPUT\n\n` +
          `A planner has analyzed this turn and produced the directive below. It tells you ` +
          `WHAT must happen this turn — the consequence, the next situation, and where the ` +
          `story is aiming. It does NOT tell you how to write it.\n\n` +
          `The directive is intentionally terse and telegraphic. It is RAW STRATEGIC MATERIAL ` +
          `for you to render, NOT a style template. Your prose must NOT echo its register, ` +
          `labeled-line format, fragment phrasing, or compression. Do not begin sentences with ` +
          `"Consequence:" or any other label from the directive. Do not quote it. Do not refer ` +
          `to "the planner" or any director. The player never sees the directive — they see ` +
          `only your prose.\n\n` +
          `You are the Narrator. Write in the voice and register established by the system ` +
          `prompt and style guide above: complete grammatical sentences, varied rhythm, ` +
          `fiction prose with all articles, auxiliaries, and conjunctions in place. Render ` +
          `the directive's intent through scene, sensory detail, NPC behavior, and dialogue ` +
          `of your own choosing.\n\n` +
          `--- BEGIN DIRECTIVE ---\n\n` +
          ctx.plannerInstruction +
          `\n\n--- END DIRECTIVE ---`,
      }
    : null

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
    const reminded = applyTurnReminder(apiMessages, ctx.appendReminderToUser)
    const finalMessages = plannerSystemMessage
      ? [...reminded, plannerSystemMessage]
      : reminded
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages: finalMessages,
      stream: false,
    }
    if (tools.length) body.tools = tools
    if (modelSupportsSampling(ctx.model)) {
      body.temperature = ctx.sampling.temperature
      body.frequency_penalty = ctx.sampling.frequencyPenalty
      body.presence_penalty = ctx.sampling.presencePenalty
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
      console.warn('[dm] extracted inline tool calls from narrative', {
        count: inlineCalls.length,
        names: inlineCalls.map((c) => c.name),
      })
      apiMessages.push({
        role: 'assistant',
        content,
      })
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
      if (cleaned)
        return {
          text: cleaned,
          state: currentState,
          plot: currentPlot,
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
