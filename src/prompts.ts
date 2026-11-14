import dmSystem from './prompts/dm-system.md?raw'
import plotterSystem from './prompts/plotter-system.md?raw'
import stateRules from './prompts/state-rules.md?raw'
import memoryRules from './prompts/memory-rules.md?raw'
import plotRules from './prompts/plot-rules.md?raw'
import oocRules from './prompts/ooc-rules.md?raw'
import turnReminder from './prompts/turn-reminder.md?raw'
import plotterTurn from './prompts/plotter-turn.md?raw'
import nsfw from './prompts/nsfw.md?raw'
import summarizer from './prompts/summarizer.md?raw'
import summarizerInputs from './prompts/summarizer-inputs.md?raw'
import defaultScenario from './prompts/default-scenario.md?raw'
import newAdventureBootstrap from './prompts/new-adventure-bootstrap.md?raw'
import reviser from './prompts/reviser.md?raw'
import continueDirectiveFile from './prompts/continue-directive.md?raw'
import type { TurnKind } from './engine/types'
import { isOutOfCharacterOnly } from './engine/steering'

// Every prompt file as shipped, by name. Developer mode's Prompts tab can
// override any of them in the browser. The default scenario isn't among them:
// it is the brief a new adventure starts from, edited in the New adventure
// dialog.
export const PROMPT_DEFAULTS = {
  'dm-system.md': dmSystem,
  'plotter-system.md': plotterSystem,
  'plotter-turn.md': plotterTurn,
  'turn-reminder.md': turnReminder,
  'state-rules.md': stateRules,
  'memory-rules.md': memoryRules,
  'plot-rules.md': plotRules,
  'ooc-rules.md': oocRules,
  'nsfw.md': nsfw,
  'summarizer.md': summarizer,
  'summarizer-inputs.md': summarizerInputs,
  'reviser.md': reviser,
  'continue-directive.md': continueDirectiveFile,
  'new-adventure-bootstrap.md': newAdventureBootstrap,
} as const

export type PromptFile = keyof typeof PROMPT_DEFAULTS
export const PROMPT_FILES = Object.keys(PROMPT_DEFAULTS) as PromptFile[]

export function isPromptFile(name: string): name is PromptFile {
  return Object.hasOwn(PROMPT_DEFAULTS, name)
}

// The player's edits to the prompt files. Every prompt is read through
// promptText when it is used, so an edit applies from the next request.
const overrides = new Map<PromptFile, string>()

export function promptText(file: PromptFile): string {
  return overrides.get(file) ?? PROMPT_DEFAULTS[file]
}

// The edits by file name, only for files that have one.
export function promptOverrides(): Record<string, string> {
  return Object.fromEntries(overrides)
}

// Replaces every edit. Names that aren't prompt files are dropped, and an
// edit that matches its default is no edit.
export function setPromptOverrides(next: Readonly<Record<string, string>>) {
  overrides.clear()
  for (const [file, text] of Object.entries(next)) {
    if (isPromptFile(file) && text !== PROMPT_DEFAULTS[file]) overrides.set(file, text)
  }
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const v = vars[key]
    return v === undefined ? match : String(v)
  })
}

// A prompt file holding several short prompts, each under a `## name`
// heading, so wording that belongs together sits in one file.
function sections(template: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const part of template.split(/^## /m).slice(1)) {
    const end = part.indexOf('\n')
    found.set(part.slice(0, end).trim(), part.slice(end + 1).trim())
  }
  return found
}

// The sections of a file's default that this text lacks. The code reads each
// section by name, so an edit has to keep them all.
export function missingSections(file: PromptFile, text: string): string[] {
  const kept = sections(text)
  return [...sections(PROMPT_DEFAULTS[file]).keys()].filter((name) => !kept.has(name))
}

// Reads a section by name, filled with its variables. An edit made before its
// default gained a section reads that section from the default; a section
// missing from the default is a bug.
function sectionReader<Name extends string>(file: PromptFile) {
  return (name: Name, vars: Record<string, string | number> = {}): string => {
    const text = sections(promptText(file)).get(name) ?? sections(PROMPT_DEFAULTS[file]).get(name)
    if (text === undefined) throw new Error(`${file} has no "## ${name}" section`)
    return fill(text, vars)
  }
}

// The Plotter's per-turn steps, the line on the order of its calls, and the
// reminders it gets when it stops short.
export type PlotterTurnSection =
  | 'intro'
  | 'opening-setup'
  | 'opening-arcs'
  | 'opening-recall'
  | 'opening-steer'
  | 'record'
  | 'develop'
  | 'develop-continue'
  | 'recall'
  | 'steer'
  | 'order'
  | 'order-records'
  | 'done'
  | 'nudge-steer'
  | 'nudge-rejected'
export const plotterTurnText = sectionReader<PlotterTurnSection>('plotter-turn.md')

const turnReminderText = sectionReader<'opening' | 'default' | 'player' | 'ooc' | 'continue'>('turn-reminder.md')
const nsfwText = sectionReader<'on' | 'off'>('nsfw.md')

export function narratorSystemPrompt(): string {
  return promptText('dm-system.md').trim()
}

// The Plotter's own brief: it directs the story and keeps the records, and
// never writes the story, so it never reads the narrator's writing brief.
export function plotterSystemPrompt(): string {
  return promptText('plotter-system.md').trim()
}

export const DEFAULT_SCENARIO = defaultScenario.trim()

export function reviserSystemPrompt(): string {
  return promptText('reviser.md').trim()
}

// The input that marks a Continue turn, when the player presses Continue: a
// plain message, so it isn't taken for the player's direction.
export function continueDirective(): string {
  return promptText('continue-directive.md').trim()
}

// The last thing the narrator reads before writing, so it points at the
// player's input and nothing more: the system prompt carries the story's
// guidance. Restating it here would invite a rule-by-rule check every turn,
// and this tail is never cached.
// Input that is only out-of-character direction has no move to tell, and on a
// Continue the player's last move was told in the last reply, so the story
// carries on from there. The opening and Continue inputs only mark the turn:
// what to do with it is said here, and in the Plotter's steps.
export function buildTurnReminder(kind?: TurnKind, input?: string): string {
  if (kind === 'player') return turnReminderText(input && isOutOfCharacterOnly(input) ? 'ooc' : 'player')
  if (kind === 'continue') return turnReminderText('continue')
  if (kind === 'bootstrap') return turnReminderText('opening')
  return turnReminderText('default')
}

// The content stance both roles are given.
export function contentStance(allowMature: boolean): string {
  return nsfwText(allowMature ? 'on' : 'off')
}

export function buildStateRules(): string {
  return promptText('state-rules.md').trim()
}

export function buildMemoryRules(): string {
  return promptText('memory-rules.md').trim()
}

export function buildPlotRules(maxPlotItems: number, maxPlotItemChars: number): string {
  return fill(promptText('plot-rules.md'), { maxPlotItems, maxPlotItemChars }).trim()
}

export function buildOocRules(maxOocItems: number, maxOocItemChars: number): string {
  return fill(promptText('ooc-rules.md'), { maxOocItems, maxOocItemChars }).trim()
}

export function summarizerSystemPrompt(): string {
  return promptText('summarizer.md').trim()
}

const summarizerInputsText = sectionReader<'scenario' | 'story' | 'story-start' | 'turns' | 'turn' | 'length' | 'instruction'>(
  'summarizer-inputs.md',
)

// The summariser's input: the scenario, the last summary (or word that the
// story starts with these turns), the run of turns that follow it, each headed
// by its number in the log, the length its story so far aims for, then what to
// write. The length rides here rather than in the system prompt, which stays
// the same for every call.
export function buildSummarizerInputs(
  scenario: string,
  previousSummary: string,
  turns: { number: number; text: string }[],
  targetChars: number,
): string {
  const body = turns.map((t) => summarizerInputsText('turn', { number: t.number, text: t.text })).join('\n\n')
  return [
    ...(scenario.trim() ? [summarizerInputsText('scenario', { scenario: scenario.trim() })] : []),
    previousSummary
      ? summarizerInputsText('story', { story: previousSummary })
      : summarizerInputsText('story-start'),
    summarizerInputsText('turns', { count: turns.length, turns: body }),
    summarizerInputsText('length', { chars: targetChars.toLocaleString('en-GB') }),
    summarizerInputsText('instruction'),
  ].join('\n\n')
}

// The input that marks the opening turn, likewise plain.
export function buildNewAdventureBootstrap(): string {
  return promptText('new-adventure-bootstrap.md').trim()
}
