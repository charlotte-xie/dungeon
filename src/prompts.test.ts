import { describe, expect, it } from 'vitest'
import {
  buildMemoryRules,
  buildNewAdventureBootstrap,
  buildOocRules,
  buildPlotRules,
  buildStateRules,
  buildSummarizerLengthNote,
  buildTurnReminder,
  CONTINUE_DIRECTIVE,
  DEFAULT_SYSTEM_PROMPT,
  PLOTTER_SYSTEM_PROMPT,
  NSFW_OFF_PROMPT,
  NSFW_ON_PROMPT,
  REVISER_SYSTEM_PROMPT,
  SUMMARIZER_SYSTEM_PROMPT,
  narratorNotesText,
  plotterTurnText,
} from './prompts'

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
      buildTurnReminder('continue'),
      CONTINUE_DIRECTIVE,
      buildNewAdventureBootstrap(),
      NSFW_ON_PROMPT,
      NSFW_OFF_PROMPT,
      plotterTurnText('nudge-steer', { steer: 'steer' }),
      plotterTurnText('nudge-rejected'),
      ...(['intro', 'close', 'memory', 'plot', 'state', 'ooc'] as const).map((name) => narratorNotesText(name)),
      narratorNotesText('story-update', { storyUpdate: 'story_update' }),
      narratorNotesText('reply-notes', { replyNotes: 'reply_notes' }),
    ]
    for (const text of texts) {
      expect(text.trim()).not.toBe('')
      expect(text).not.toMatch(/\{\{\w+\}\}/)
    }
  })

  it('gives each kind of turn its reminder', () => {
    const reminder = buildTurnReminder()
    expect(buildTurnReminder('bootstrap')).toBe(reminder)
    // After the player's own input, the reply opens by telling their move.
    expect(buildTurnReminder('player')).not.toBe(reminder)
    expect(buildTurnReminder('player')).toContain(reminder)
    // On a Continue the last move was already told.
    expect(buildTurnReminder('continue')).not.toBe(reminder)
  })

  it('sends the opening and Continue as the player’s out-of-character direction', () => {
    for (const directive of [buildNewAdventureBootstrap(), CONTINUE_DIRECTIVE]) {
      expect(directive).toMatch(/^\(OOC: [\s\S]+\)$/)
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
    // Labelled plan entries and a worked example came back as ultimatums.
    expect(buildPlotRules(10, 500)).not.toMatch(/example|question|promise|stakes|payoff/i)
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

  it('keeps the summariser system prompt byte-stable — the budget rides with the inputs', () => {
    const note = buildSummarizerLengthNote(500)
    expect(note).toContain('500')
    expect(note).toContain('750')
  })
})
