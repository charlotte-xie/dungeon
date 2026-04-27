import dmSystem from './prompts/dm-system.md?raw'
import stateRulesTemplate from './prompts/state-rules.md?raw'
import plotRulesTemplate from './prompts/plot-rules.md?raw'
import turnReminder from './prompts/turn-reminder.md?raw'
import summarizerTemplate from './prompts/summarizer.md?raw'
import defaultScenario from './prompts/default-scenario.md?raw'
import newAdventureBootstrapTemplate from './prompts/new-adventure-bootstrap.md?raw'
import plannerSystem from './prompts/planner.md?raw'

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const v = vars[key]
    return v === undefined ? match : String(v)
  })
}

export const DEFAULT_SYSTEM_PROMPT = dmSystem.trim()
export const TURN_REMINDER = turnReminder.trim()
export const DEFAULT_SCENARIO = defaultScenario.trim()
export const PLANNER_SYSTEM_PROMPT = plannerSystem.trim()

export function buildStateRules(maxStateStringChars: number): string {
  return fill(stateRulesTemplate, { maxStateStringChars }).trim()
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

export function buildNewAdventureBootstrap(scenario: string): string {
  return fill(newAdventureBootstrapTemplate, { scenario }).trim()
}
