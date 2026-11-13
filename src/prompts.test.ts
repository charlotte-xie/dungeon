import { afterEach, describe, expect, it } from 'vitest'
import { UPDATE_MEMORY_TOOL } from './engine/tools'
import {
  buildMemoryRules,
  buildNewAdventureBootstrap,
  buildOocRules,
  buildPlotRules,
  buildStateRules,
  buildSummarizerInputs,
  buildTurnReminder,
  contentStance,
  continueDirective,
  narratorSystemPrompt,
  plotterSystemPrompt,
  reviserSystemPrompt,
  summarizerSystemPrompt,
  plotterTurnText,
  missingSections,
  promptOverrides,
  PROMPT_DEFAULTS,
  setPromptOverrides,
} from './prompts'

// The prompts as shipped: no test here sets an edit.
const CONTINUE_DIRECTIVE = continueDirective()
const DEFAULT_SYSTEM_PROMPT = narratorSystemPrompt()
const PLOTTER_SYSTEM_PROMPT = plotterSystemPrompt()
const NSFW_ON_PROMPT = contentStance(true)
const NSFW_OFF_PROMPT = contentStance(false)
const REVISER_SYSTEM_PROMPT = reviserSystemPrompt()
const SUMMARIZER_SYSTEM_PROMPT = summarizerSystemPrompt()

// The prompts' wording is the maintainer's to change. These tests check only
// what the code relies on, and guard against wording that play showed pulls
// the models the wrong way.
describe('prompts', () => {
  it('fills every template variable', () => {
    const texts = [
      DEFAULT_SYSTEM_PROMPT,
      PLOTTER_SYSTEM_PROMPT,
      REVISER_SYSTEM_PROMPT,
      SUMMARIZER_SYSTEM_PROMPT,
      buildStateRules(),
      buildMemoryRules(),
      buildPlotRules(10, 500),
      buildOocRules(8, 300),
      buildTurnReminder(),
      buildTurnReminder('player'),
      buildTurnReminder('player', '(OOC: more of the pub)'),
      buildTurnReminder('continue'),
      buildTurnReminder('bootstrap'),
      CONTINUE_DIRECTIVE,
      buildNewAdventureBootstrap(),
      NSFW_ON_PROMPT,
      NSFW_OFF_PROMPT,
      plotterTurnText('nudge-steer', { steer: 'steer' }),
      plotterTurnText('nudge-rejected'),
    ]
    for (const text of texts) {
      expect(text.trim()).not.toBe('')
      expect(text).not.toMatch(/\{\{\w+\}\}/)
    }
  })

  it('gives each kind of turn its reminder', () => {
    const reminder = buildTurnReminder()
    // The opening has a reminder of its own: its input only marks the turn.
    expect(buildTurnReminder('bootstrap')).not.toBe(reminder)
    // After the player's own input, the reply opens by telling their move.
    expect(buildTurnReminder('player')).not.toBe(reminder)
    expect(buildTurnReminder('player')).toContain(reminder)
    // On a Continue the last move was already told.
    expect(buildTurnReminder('continue')).not.toBe(reminder)
    // Out-of-character direction alone has no move to tell.
    expect(buildTurnReminder('player', 'I wave. (OOC: slowly)')).toBe(buildTurnReminder('player'))
    const direction = buildTurnReminder('player', '(OOC: more of the pub)')
    expect(direction).not.toBe(buildTurnReminder('player'))
    expect(direction).not.toBe(reminder)
  })

  it('marks the opening and Continue with plain inputs, not the player’s direction', () => {
    // Sent as out-of-character direction, the opening was kept as a standing
    // instruction.
    for (const directive of [buildNewAdventureBootstrap(), CONTINUE_DIRECTIVE]) {
      expect(directive).not.toMatch(/[([]/)
    }
  })

  it('keeps out wording that pulled the models the wrong way', () => {
    const story = [DEFAULT_SYSTEM_PROMPT, PLOTTER_SYSTEM_PROMPT, buildPlotRules(10, 500), CONTINUE_DIRECTIVE]
    // Choice and decision wording pulled models towards ending on a choice,
    // and a multiple-choice game's wording towards pressing for an answer.
    for (const text of story) expect(text).not.toMatch(/decision|choice|decide|choose|bargain|option/i)
    // Framing the ending as the player's cue had the prompt written out.
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/respond to|up to them/i)
    // Scripting the last line turned a fight into attack after attack.
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/closes? on|camera|last line/i)
    // Labelled plan entries came back as ultimatums, and so did a sample
    // entry that was a bargain; the sample now is something the world does,
    // and the choice wording above stays out.
    expect(buildPlotRules(10, 500)).not.toMatch(/question|promise|stakes|payoff/i)
    // "The player" in the records leaked into dialogue.
    expect(buildMemoryRules()).not.toMatch(/saw the player|wary of the player|The player is lean/)
  })

  it('keeps the narrator’s writing brief out of the Plotter’s', () => {
    // With the narrator's brief, the Plotter sometimes wrote the scene itself.
    expect(PLOTTER_SYSTEM_PROMPT).not.toMatch(/You are the (DM|narrator)|second person|paragraphs/i)
  })

  it('names a missing prompt section rather than sending an empty prompt', () => {
    expect(() => plotterTurnText('no-such-section' as never)).toThrow('plotter-turn.md has no "## no-such-section" section')
  })

  it('keeps the summariser system prompt byte-stable — the length rides with the inputs', () => {
    expect(buildSummarizerInputs('', '', [{ number: 1, text: 'DM: Rain falls.' }], 1500)).toContain('1,500')
    expect(SUMMARIZER_SYSTEM_PROMPT).not.toContain('1,500')
  })
})

describe('edits to the prompts', () => {
  afterEach(() => setPromptOverrides({}))

  it('apply from the next use, and the default comes back once the edit is gone', () => {
    setPromptOverrides({ 'dm-system.md': 'Edited brief.' })
    expect(narratorSystemPrompt()).toBe('Edited brief.')
    setPromptOverrides({})
    expect(narratorSystemPrompt()).toBe(DEFAULT_SYSTEM_PROMPT)
  })

  it('reach a section read by name, and the tool description that carries a record’s rules', () => {
    const reminders = PROMPT_DEFAULTS['turn-reminder.md'].replace(/## player\n[^\n]*/, '## player\nEdited reminder.')
    setPromptOverrides({ 'turn-reminder.md': reminders, 'memory-rules.md': 'Edited rules.' })
    expect(buildTurnReminder('player')).toBe('Edited reminder.')
    expect(buildTurnReminder('continue')).toBe(sectionOf(PROMPT_DEFAULTS['turn-reminder.md'], 'continue'))
    expect(UPDATE_MEMORY_TOOL.description.startsWith('Edited rules.\n\n')).toBe(true)
  })

  it('keeps only edits to prompt files that differ from the default', () => {
    setPromptOverrides({ 'notes.md': 'x', 'reviser.md': PROMPT_DEFAULTS['reviser.md'], 'nsfw.md': '## on\nA\n## off\nB' })
    expect(promptOverrides()).toEqual({ 'nsfw.md': '## on\nA\n## off\nB' })
  })

  it('reads a section an older edit lacks from the default, so play carries on', () => {
    setPromptOverrides({ 'nsfw.md': '## on\nEdited stance.' })
    expect(contentStance(true)).toBe('Edited stance.')
    expect(contentStance(false)).toBe(sectionOf(PROMPT_DEFAULTS['nsfw.md'], 'off'))
  })

  it('names the sections an edit has dropped', () => {
    expect(missingSections('nsfw.md', '## on\nA')).toEqual(['off'])
    expect(missingSections('nsfw.md', PROMPT_DEFAULTS['nsfw.md'])).toEqual([])
    expect(missingSections('dm-system.md', 'Anything at all.')).toEqual([])
  })
})

function sectionOf(template: string, name: string): string {
  const start = template.indexOf(`## ${name}\n`) + `## ${name}\n`.length
  const end = template.indexOf('\n## ', start)
  return template.slice(start, end < 0 ? undefined : end).trim()
}
