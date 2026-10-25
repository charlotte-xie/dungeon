import dmSystem from './prompts/dm-system.md?raw'
import plotterSystem from './prompts/plotter-system.md?raw'
import stateRulesTemplate from './prompts/state-rules.md?raw'
import memoryRulesTemplate from './prompts/memory-rules.md?raw'
import plotRulesTemplate from './prompts/plot-rules.md?raw'
import oocRulesTemplate from './prompts/ooc-rules.md?raw'
import turnReminder from './prompts/turn-reminder.md?raw'
import plotterTurn from './prompts/plotter-turn.md?raw'
import narratorNotes from './prompts/narrator-notes.md?raw'
import nsfw from './prompts/nsfw.md?raw'
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

// A prompt file holding several short prompts, each under a `## name`
// heading, so wording that belongs together sits in one file. Reads a
// section by name, filled with its variables; a missing section is a bug.
function sectionReader<Name extends string>(file: string, template: string) {
  const sections = new Map<string, string>()
  for (const part of template.split(/^## /m).slice(1)) {
    const end = part.indexOf('\n')
    sections.set(part.slice(0, end).trim(), part.slice(end + 1).trim())
  }
  return (name: Name, vars: Record<string, string | number> = {}): string => {
    const text = sections.get(name)
    if (text === undefined) throw new Error(`${file} has no "## ${name}" section`)
    return fill(text, vars)
  }
}

// The Plotter's per-turn steps, the line on the order of its calls, and the
// reminders it gets when it stops short.
export type PlotterTurnSection =
  | 'intro'
  | 'opening-setup'
  | 'opening-plan'
  | 'opening-recall'
  | 'opening-steer'
  | 'record'
  | 'develop'
  | 'develop-continue'
  | 'recall'
  | 'steer'
  | 'order'
  | 'done'
  | 'nudge-steer'
  | 'nudge-rejected'
export const plotterTurnText = sectionReader<PlotterTurnSection>('plotter-turn.md', plotterTurn)

// The narrator's note on reading its own calls, and its line for each record.
export const narratorNotesText = sectionReader<
  'intro' | 'story-update' | 'reply-notes' | 'close' | 'memory' | 'plot' | 'state' | 'ooc'
>('narrator-notes.md', narratorNotes)

const turnReminderText = sectionReader<'default' | 'player' | 'continue'>('turn-reminder.md', turnReminder)
const nsfwText = sectionReader<'on' | 'off'>('nsfw.md', nsfw)

export const DEFAULT_SYSTEM_PROMPT = dmSystem.trim()
// The Plotter's own brief: it directs the story and keeps the records, and
// never writes the story, so it never reads the narrator's writing brief.
export const PLOTTER_SYSTEM_PROMPT = plotterSystem.trim()
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
  if (kind === 'player') return turnReminderText('player')
  if (kind === 'continue') return turnReminderText('continue')
  return turnReminderText('default')
}

export const NSFW_ON_PROMPT = nsfwText('on')
export const NSFW_OFF_PROMPT = nsfwText('off')

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
