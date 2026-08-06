import dmSystem from './prompts/dm-system.md?raw'
import stateRulesTemplate from './prompts/state-rules.md?raw'
import memoryRulesTemplate from './prompts/memory-rules.md?raw'
import plotRulesTemplate from './prompts/plot-rules.md?raw'
import turnReminder from './prompts/turn-reminder.md?raw'
import summarizerTemplate from './prompts/summarizer.md?raw'
import defaultScenario from './prompts/default-scenario.md?raw'
import newAdventureBootstrapTemplate from './prompts/new-adventure-bootstrap.md?raw'
import reviserSystem from './prompts/reviser.md?raw'

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const v = vars[key]
    return v === undefined ? match : String(v)
  })
}

export const DEFAULT_SYSTEM_PROMPT = dmSystem.trim()
export const DEFAULT_SCENARIO = defaultScenario.trim()
export const REVISER_SYSTEM_PROMPT = reviserSystem.trim()

export interface TurnReminderCapabilities {
  worldState: boolean
  plotOutline: boolean
  memory: boolean
}

export function buildTurnReminder(capabilities: TurnReminderCapabilities): string {
  const anyTools =
    capabilities.worldState || capabilities.plotOutline || capabilities.memory
  const toolReminder = anyTools
    ? '- Do not call tools while narrating — write the prose reply only. After your reply, a separate Plotter pass reviews the turn and records state/memory/plan updates.'
    : ''
  return fill(turnReminder, { toolReminder }).trim()
}

export const NSFW_ON_PROMPT =
  'The player is a consenting adult who agrees to dark, mature or NSFW themes. Include these if appropriate to the story.'
export const NSFW_OFF_PROMPT = 'Avoid NSFW descriptions or plot developments.'

export function buildStateRules(): string {
  return stateRulesTemplate.trim()
}

export function buildMemoryRules(maxMemoryStringChars: number): string {
  return fill(memoryRulesTemplate, { maxMemoryStringChars }).trim()
}

export function buildPlotRules(maxPlotItems: number, maxPlotItemChars: number): string {
  return fill(plotRulesTemplate, { maxPlotItems, maxPlotItemChars }).trim()
}

export function buildSummarizerPrompt(targetChars: number): string {
  const maxChars = Math.ceil(targetChars * 1.5)
  return fill(summarizerTemplate, {
    targetChars: targetChars.toLocaleString(),
    maxChars: maxChars.toLocaleString(),
  }).trim()
}

export function buildNewAdventureBootstrap(): string {
  return newAdventureBootstrapTemplate.trim()
}
