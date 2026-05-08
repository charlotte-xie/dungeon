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
  const auditPrompt =
    'Reminder: did this turn change the live scene — player position, NPCs present, what is held or worn, the active stimulus? If yes, call `update_state` (passing both `keep` and `set`; anything not in either is dropped). If the scene is unchanged, skip the call and the current state carries forward unchanged.'
  const cleanupStatus =
    stateJson.length > stateCleanupThreshold
      ? `STATUS: state size is ${stateJson.length.toLocaleString()} chars — OVER the ${stateCleanupThreshold.toLocaleString()} cleanup threshold. Tighten the next \`update_state\` call: drop stale keys by omitting them from both \`keep\` and \`set\`, and condense any value that's grown bloated.`
      : `STATUS: state size is ${stateJson.length.toLocaleString()} chars — within budget (threshold ${stateCleanupThreshold.toLocaleString()}).`
  return {
    role: 'system',
    content: `${STATE_RULES}\n\n## Current state JSON\n\n\`\`\`json\n${stateJson}\n\`\`\`\n\n${auditPrompt}\n\n${cleanupStatus}`,
  }
}

export function buildMemorySystemMessage(
  currentMemory: Memory,
): ApiMessage {
  const entries = Object.keys(currentMemory)
  const body = entries.length
    ? `\`\`\`json\n${JSON.stringify(currentMemory, null, 2)}\n\`\`\``
    : '(no memory yet — call `update_memory` to record any NPC, location, plot theme, or key past event that should persist across scenes)'
  const reminder =
    '\n\nReminder: did this turn introduce a recurring NPC, location, or thread, or meaningfully change an existing entry? If yes, call `update_memory` before writing. If nothing notable changed, skip it.'
  return {
    role: 'system',
    content: `${MEMORY_RULES}\n\n## Current memory\n\n${body}${reminder}`,
  }
}

export function buildPlotSystemMessage(
  currentPlot: string[],
): ApiMessage {
  const bullets = currentPlot.length
    ? currentPlot.map((p, i) => `${i + 1}. ${p}`).join('\n')
    : '(no future plot plan yet — call `future_plot_plan` with op="append" to record the first plot direction as soon as you have one)'
  const reminder =
    '\n\nReminder: keeping the story interesting and engaging is your job as DM. Each turn, work the plan: `delete` any entry the player has already seen play out, `update` any direction that has shifted, and `append` (or `insert`) any new pressure, hook, or thread this turn has opened. Skip the call only when genuinely nothing has changed — an empty or stale plan means the story is drifting.'
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
