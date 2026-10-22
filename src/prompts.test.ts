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
    expect(CONTINUE_DIRECTIVE).toBe('(OOC: Continue the story.)')
  })

  it('describes progression as causal change without random escalation', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Developments grow out of what is already in play')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('rather than new threats from nowhere')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('makes way for the next instead of being restated')
  })

  it('prevents semantically duplicate future plot beats', () => {
    const rules = buildPlotRules(10, 500)
    expect(rules).toContain('same dramatic function')
    expect(rules).toContain('never preserve and replay it')
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
