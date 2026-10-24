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
  it('keeps the turn reminder to a pointer at the latest input', () => {
    expect(buildTurnReminder()).toBe("Reply to the player's latest input.")
  })

  it('keeps the opening and Continue directives to the player’s short request', () => {
    expect(buildNewAdventureBootstrap()).toBe('(OOC: Begin the story.)')
    expect(CONTINUE_DIRECTIVE).toBe(
      '(OOC: Continue: move the story on to its next meaningful development, in a full turn.)',
    )
  })

  it('keeps the story moving through consequences grown from what is in play', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Developments grow out of what is already in play')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('what is set up pays off')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('the story moves on to its consequences')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Stop on the moment it lands')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('The last sentence is something a camera would see.')
    // NPCs press in their own words rather than offering the player a menu.
    expect(DEFAULT_SYSTEM_PROMPT).toContain("leave the player's options to the player")
  })

  it('measures length preferences against a full reply', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('any length preference is measured against that')
  })

  it('keeps choice framing out of the prompts', () => {
    // Choice and decision wording pulls models towards ending on a choice.
    const texts = [DEFAULT_SYSTEM_PROMPT, buildPlotRules(10, 500), CONTINUE_DIRECTIVE]
    for (const text of texts) expect(text).not.toMatch(/decision|choice|decide|choose/i)
    // So does framing the ending as the player's cue to respond.
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/respond to|up to them/i)
  })

  it('prevents semantically duplicate future plot beats', () => {
    const rules = buildPlotRules(10, 500)
    expect(rules).toContain('one entry per dramatic function')
    expect(rules).toContain('replace it with its consequence')
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
