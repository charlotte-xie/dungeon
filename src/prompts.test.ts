import { describe, expect, it } from 'vitest'
import {
  buildNewAdventureBootstrap,
  buildPlotRules,
  buildSummarizerLengthNote,
  buildTurnReminder,
  CONTINUE_DIRECTIVE,
  DEFAULT_SYSTEM_PROMPT,
  SUMMARIZER_SYSTEM_PROMPT,
} from './prompts'

describe('capability-aware prompts', () => {
  it('keeps the turn reminder to one storytelling line', () => {
    expect(buildTurnReminder()).toBe(
      'Play out what follows, including the next meaningful story development.',
    )
  })

  it('keeps the opening and Continue directives to the player’s short request', () => {
    expect(buildNewAdventureBootstrap()).toBe('(OOC: Begin the story.)')
    expect(CONTINUE_DIRECTIVE).toBe(
      '(OOC: Continue: carry the story on to its next meaningful development.)',
    )
  })

  it('keeps the story moving through consequences grown from what is in play', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Developments grow out of what is already in play')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('what is set up pays off')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('the story moves on from it')
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      'play out the consequences, including the next meaningful story development',
    )
    // Scripting the last line turned a fight into attack after attack.
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/closes? on|camera|last line/i)
    // People follow their own goals rather than waiting on the player.
    expect(DEFAULT_SYSTEM_PROMPT).toContain('follow their own goals, with their own personality and subtext')
  })

  it('measures length preferences against a full reply', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('any length preference is measured against that')
  })

  it('keeps choice framing out of the prompts', () => {
    // Choice and decision wording pulls models towards ending on a choice.
    const texts = [DEFAULT_SYSTEM_PROMPT, buildPlotRules(10, 500), CONTINUE_DIRECTIVE]
    for (const text of texts) expect(text).not.toMatch(/decision|choice|decide|choose/i)
    // So does the wording of a multiple-choice game.
    for (const text of texts) expect(text).not.toMatch(/bargain|option/i)
    // So does framing the ending as the player's cue to respond.
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/respond to|up to them/i)
  })

  it('prevents semantically duplicate future plot beats', () => {
    const rules = buildPlotRules(10, 500)
    expect(rules).toContain('one short entry for each thread')
  })

  it('keeps the plan a list of where the story is heading, with no structure to copy', () => {
    const rules = buildPlotRules(10, 500)
    expect(rules).toContain('in the medium and long term')
    expect(rules).toContain('Each entry is a direction for the world')
    // Changes are optional: only a good idea that improves the story.
    expect(rules).toContain('change it only when that improves the story')
    // Labelled entries and a worked example planned the player's decision,
    // which came back as NPC ultimatums.
    expect(rules).not.toMatch(/example|question|promise|stakes|payoff/i)
  })

  it('treats the summary length as a ceiling rather than a quota', () => {
    expect(SUMMARIZER_SYSTEM_PROMPT).toContain('This is a ceiling, not a target')
    expect(SUMMARIZER_SYSTEM_PROMPT).toContain(
      'Details whose removal would not affect a later consequence',
    )
  })

  it('keeps the summariser system prompt byte-stable — the budget rides with the inputs', () => {
    expect(SUMMARIZER_SYSTEM_PROMPT).not.toContain('{{')
    const note = buildSummarizerLengthNote(500)
    expect(note).toContain('500')
    expect(note).toContain('750')
  })
})
