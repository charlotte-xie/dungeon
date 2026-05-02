// Composes the OpenAI-shaped messages array sent to the model. Pure functions
// — given turns + state + plot + flags, returns the wire payload.

import { NSFW_OFF_PROMPT, NSFW_ON_PROMPT, TURN_REMINDER } from '../prompts'
import { buildChronicleSystemMessage } from './chronicle'
import { ADVENTURE_SLOTS } from './config'
import { STATE_RULES } from './state'
import { MEMORY_RULES, PLOT_RULES } from './tools'
import type {
  AdventureSlots,
  ApiMessage,
  Chronicle,
  Memory,
  SlotDef,
  Turn,
  WorldState,
} from './types'

export function buildSlotMessage(def: SlotDef, value: string): string {
  return `${def.header}\n\n${def.framing}\n\n${value}`
}

export function buildStateSystemMessage(
  currentState: WorldState,
  stateCleanupThreshold: number,
): ApiMessage {
  const stateJson = JSON.stringify(currentState, null, 2)
  const cleanupStatus =
    stateJson.length > stateCleanupThreshold
      ? `STATUS: state size is ${stateJson.length.toLocaleString()} chars — OVER the ${stateCleanupThreshold.toLocaleString()} cleanup threshold. Drop or condense stale keys this turn. Use \`update_state\` with \`delete=[...]\` for bulk cleanup.`
      : `STATUS: state size is ${stateJson.length.toLocaleString()} chars — within budget (threshold ${stateCleanupThreshold.toLocaleString()}).`
  return {
    role: 'system',
    content: `${STATE_RULES}\n\n## Current state JSON\n\n\`\`\`json\n${stateJson}\n\`\`\`\n\n${cleanupStatus}`,
  }
}

export function buildMemorySystemMessage(currentMemory: Memory): ApiMessage {
  const entries = Object.keys(currentMemory)
  const body = entries.length
    ? `\`\`\`json\n${JSON.stringify(currentMemory, null, 2)}\n\`\`\``
    : '(no memory yet — call `update_memory` to record any NPC, location, plot theme, or key past event that should persist across scenes)'
  return {
    role: 'system',
    content: `${MEMORY_RULES}\n\n## Current memory\n\n${body}`,
  }
}

export function buildPlotSystemMessage(currentPlot: string[]): ApiMessage {
  const bullets = currentPlot.length
    ? currentPlot.map((p, i) => `${i + 1}. ${p}`).join('\n')
    : '(no future plot plan yet — call future_plot_plan with op="append" to add the first arrow when the story gives you enough to aim at)'
  const reminder = currentPlot.length
    ? '\n\nReminder: every entry above must describe something STILL AHEAD of the player. Sweep the list now — if any entry has already played out, `delete` it before writing this turn.'
    : ''
  return {
    role: 'system',
    content: `${PLOT_RULES}\n\n## Current future plot plan\n\n${bullets}${reminder}`,
  }
}

export function buildApiMessagesIndexed(
  systemPrompt: string,
  slots: AdventureSlots,
  chronicle: Chronicle,
  history: Turn[],
  currentState: WorldState,
  currentPlot: string[],
  currentMemory: Memory,
  stateCleanupThreshold: number,
  includePriorPlayerTurns: boolean,
  includeWorldState: boolean,
  includePlotOutline: boolean,
  includeMemory: boolean,
  nsfw: boolean,
): {
  messages: ApiMessage[]
  stateIndex: number
  plotIndex: number
  memoryIndex: number
} {
  const messages: ApiMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: nsfw ? NSFW_ON_PROMPT : NSFW_OFF_PROMPT },
  ]
  for (const def of ADVENTURE_SLOTS) {
    const value = (slots[def.key] ?? '').trim()
    if (!value) continue
    messages.push({ role: 'system', content: buildSlotMessage(def, value) })
  }
  let memoryIndex = -1
  if (includeMemory) {
    memoryIndex = messages.length
    messages.push(buildMemorySystemMessage(currentMemory))
  }
  let plotIndex = -1
  if (includePlotOutline) {
    plotIndex = messages.length
    messages.push(buildPlotSystemMessage(currentPlot))
  }
  let stateIndex = -1
  if (includeWorldState) {
    stateIndex = messages.length
    messages.push(buildStateSystemMessage(currentState, stateCleanupThreshold))
  }
  const chronicleMessage = buildChronicleSystemMessage(chronicle)
  if (chronicleMessage) {
    messages.push(chronicleMessage)
  }
  for (let i = 0; i < history.length; i++) {
    const t = history[i]
    const isLast = i === history.length - 1
    const hasReply = !!t.reply.text
    const inputIsHistorical = !isLast && hasReply
    // For past completed bootstrap/continue turns, omit the synthetic input —
    // matches pre-refactor behavior where those directives were never persisted.
    const includeInput =
      t.input !== undefined &&
      (!inputIsHistorical || t.kind === 'player') &&
      (includePriorPlayerTurns || !inputIsHistorical || t.kind !== 'player')
    if (includeInput) {
      messages.push({ role: 'user', content: t.input ?? '' })
    }
    if (hasReply) {
      messages.push({ role: 'assistant', content: t.reply.text ?? '' })
    }
  }
  return { messages, stateIndex, plotIndex, memoryIndex }
}

export function buildApiMessages(
  systemPrompt: string,
  slots: AdventureSlots,
  chronicle: Chronicle,
  history: Turn[],
  currentState: WorldState,
  currentPlot: string[],
  currentMemory: Memory,
  stateCleanupThreshold: number,
  includePriorPlayerTurns: boolean,
  includeWorldState: boolean,
  includePlotOutline: boolean,
  includeMemory: boolean,
  nsfw: boolean,
): ApiMessage[] {
  return buildApiMessagesIndexed(
    systemPrompt,
    slots,
    chronicle,
    history,
    currentState,
    currentPlot,
    currentMemory,
    stateCleanupThreshold,
    includePriorPlayerTurns,
    includeWorldState,
    includePlotOutline,
    includeMemory,
    nsfw,
  ).messages
}

export function applyTurnReminder(
  messages: ApiMessage[],
  asSystem: boolean,
): ApiMessage[] {
  if (asSystem) {
    return [...messages, { role: 'system', content: TURN_REMINDER }]
  }
  // Alternative: extra user message wrapped in (OOC: ...). The dm-system
  // prompt documents OOC-in-parens as the player's directive convention, so
  // this lands as in-channel guidance rather than out-of-band system noise.
  return [...messages, { role: 'user', content: `(OOC: ${TURN_REMINDER})` }]
}
