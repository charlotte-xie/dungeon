// Composes the OpenAI-shaped messages array sent to the model. Pure functions
// — given turns + state + plot + flags, returns the wire payload.

import { NSFW_OFF_PROMPT, NSFW_ON_PROMPT, TURN_REMINDER } from '../prompts'
import { buildChronicleSystemMessage } from './chronicle'
import { ADVENTURE_SLOTS } from './config'
import { STATE_RULES } from './state'
import { PLOT_RULES } from './tools'
import type {
  AdventureSlots,
  ApiMessage,
  Chronicle,
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

export function buildPlotSystemMessage(currentPlot: string[]): ApiMessage {
  const bullets = currentPlot.length
    ? currentPlot.map((p) => `- ${p}`).join('\n')
    : '(no plot outline yet — call plot_update to set one when the story gives you enough to aim at)'
  return {
    role: 'system',
    content: `${PLOT_RULES}\n\n## Current plot outline\n\n${bullets}`,
  }
}

export function buildApiMessagesIndexed(
  systemPrompt: string,
  slots: AdventureSlots,
  chronicle: Chronicle,
  history: Turn[],
  currentState: WorldState,
  currentPlot: string[],
  stateCleanupThreshold: number,
  includePriorPlayerTurns: boolean,
  includeWorldState: boolean,
  includePlotOutline: boolean,
  nsfw: boolean,
): { messages: ApiMessage[]; stateIndex: number; plotIndex: number } {
  const messages: ApiMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'system', content: nsfw ? NSFW_ON_PROMPT : NSFW_OFF_PROMPT },
  ]
  for (const def of ADVENTURE_SLOTS) {
    const value = (slots[def.key] ?? '').trim()
    if (!value) continue
    messages.push({ role: 'system', content: buildSlotMessage(def, value) })
  }
  const chronicleMessage = buildChronicleSystemMessage(chronicle)
  if (chronicleMessage) {
    messages.push(chronicleMessage)
  }
  let stateIndex = -1
  if (includeWorldState) {
    stateIndex = messages.length
    messages.push(buildStateSystemMessage(currentState, stateCleanupThreshold))
  }
  let plotIndex = -1
  if (includePlotOutline) {
    plotIndex = messages.length
    messages.push(buildPlotSystemMessage(currentPlot))
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
  return { messages, stateIndex, plotIndex }
}

export function buildApiMessages(
  systemPrompt: string,
  slots: AdventureSlots,
  chronicle: Chronicle,
  history: Turn[],
  currentState: WorldState,
  currentPlot: string[],
  stateCleanupThreshold: number,
  includePriorPlayerTurns: boolean,
  includeWorldState: boolean,
  includePlotOutline: boolean,
  nsfw: boolean,
): ApiMessage[] {
  return buildApiMessagesIndexed(
    systemPrompt,
    slots,
    chronicle,
    history,
    currentState,
    currentPlot,
    stateCleanupThreshold,
    includePriorPlayerTurns,
    includeWorldState,
    includePlotOutline,
    nsfw,
  ).messages
}

export function applyTurnReminder(
  messages: ApiMessage[],
  appendToUser: boolean,
): ApiMessage[] {
  if (appendToUser) {
    // Fold into the existing last user message as an OOC suffix.
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const copy = messages.slice()
        const existing = copy[i].content
        copy[i] = {
          ...copy[i],
          content: `${existing}\n\n(OOC: ${TURN_REMINDER})`,
        }
        return copy
      }
    }
  }
  // Default: append as a separate user message wrapped in (OOC: ...). The
  // dm-system prompt documents OOC-in-parens as the player's directive
  // convention, so the model treats it as in-channel guidance rather than
  // mid-conversation system noise.
  return [...messages, { role: 'user', content: `(OOC: ${TURN_REMINDER})` }]
}
