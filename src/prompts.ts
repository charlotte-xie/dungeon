import dmSystem from './prompts/dm-system.md?raw'
import stateRulesTemplate from './prompts/state-rules.md?raw'
import memoryRulesTemplate from './prompts/memory-rules.md?raw'
import plotRulesTemplate from './prompts/plot-rules.md?raw'
import oocRulesTemplate from './prompts/ooc-rules.md?raw'
import turnReminder from './prompts/turn-reminder.md?raw'
import summarizerTemplate from './prompts/summarizer.md?raw'
import defaultScenario from './prompts/default-scenario.md?raw'
import newAdventureBootstrapTemplate from './prompts/new-adventure-bootstrap.md?raw'
import reviserSystem from './prompts/reviser.md?raw'
import continueDirective from './prompts/continue-directive.md?raw'
import type { TurnKind } from './engine/types'

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const v = vars[key]
    return v === undefined ? match : String(v)
  })
}

export const DEFAULT_SYSTEM_PROMPT = dmSystem.trim()
export const DEFAULT_SCENARIO = defaultScenario.trim()
export const REVISER_SYSTEM_PROMPT = reviserSystem.trim()
// Synthetic user input sent when the player presses Continue (skips their turn).
export const CONTINUE_DIRECTIVE = continueDirective.trim()

// The last thing the narrator reads before writing, so it points at the
// player's input and nothing more: the system prompt carries the story's
// guidance. Restating it here would invite a rule-by-rule check every turn,
// and this tail is never cached.
// After the player's own input, the reply opens by telling what they did
// and said. On a Continue their last move was told in the last reply, so the
// story carries on from there; an opening has no move to tell.
export function buildTurnReminder(kind?: TurnKind): string {
  const reminder = turnReminder.trim()
  if (kind === 'player') {
    return `Open with what the player did, briefly, and what they said, in their exact words. ${reminder}`
  }
  if (kind === 'continue') {
    return 'Carry on from where the last reply ended, advancing the story to its next meaningful development.'
  }
  return reminder
}

export const NSFW_ON_PROMPT =
  'The player is a consenting adult who agrees to dark, mature or NSFW themes. Include these if appropriate to the story.'
export const NSFW_OFF_PROMPT = 'Keep descriptions and developments suitable for a general audience.'

export function buildStateRules(): string {
  return stateRulesTemplate.trim()
}

export function buildMemoryRules(): string {
  return memoryRulesTemplate.trim()
}

export function buildPlotRules(maxPlotItems: number, maxPlotItemChars: number): string {
  return fill(plotRulesTemplate, { maxPlotItems, maxPlotItemChars }).trim()
}

export function buildOocRules(maxOocItems: number, maxOocItemChars: number): string {
  return fill(oocRulesTemplate, { maxOocItems, maxOocItemChars }).trim()
}

export const SUMMARIZER_SYSTEM_PROMPT = summarizerTemplate.trim()

// The length budget rides with the inputs rather than in the system prompt,
// so every summariser call — including the parallel folds of one drain
// event — shares one byte-identical system prefix.
export function buildSummarizerLengthNote(targetChars: number): string {
  const maxChars = Math.ceil(targetChars * 1.5)
  return `Length budget: use at most ${targetChars.toLocaleString()} characters where possible. HARD MAXIMUM: ${maxChars.toLocaleString()}.`
}

export function buildNewAdventureBootstrap(): string {
  return newAdventureBootstrapTemplate.trim()
}
