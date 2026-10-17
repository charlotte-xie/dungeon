import { describe, expect, it } from 'vitest'
import {
  buildNewAdventureBootstrap,
  buildPlotRules,
  buildSummarizerLengthNote,
  buildTurnReminder,
  DEFAULT_SYSTEM_PROMPT,
  SUMMARIZER_SYSTEM_PROMPT,
} from './prompts'

describe('capability-aware prompts', () => {
  it('steers the narrator away from tools when any subsystem is enabled', () => {
    const reminder = buildTurnReminder({
      worldState: false,
      plotOutline: true,
      memory: false,
      ooc: false,
    })
    expect(reminder).toContain('Do not call tools while narrating')
    expect(reminder).toContain('Plotter pass')

    const bare = buildTurnReminder({
      worldState: false,
      plotOutline: false,
      memory: false,
      ooc: false,
    })
    expect(bare).not.toContain('Plotter pass')
  })

  it('keeps the turn reminder to a pointer at the latest input', () => {
    const bare = buildTurnReminder({ worldState: false, plotOutline: false, memory: false, ooc: false })
    expect(bare).toBe("Reply to the player's latest input.")

    const withTools = buildTurnReminder({ worldState: true, plotOutline: true, memory: true, ooc: true })
    expect(withTools.startsWith("Reply to the player's latest input.")).toBe(true)
    expect(withTools).not.toContain('{{')
  })

  it('does not demand a specific tool during bootstrap', () => {
    const bootstrap = buildNewAdventureBootstrap()

    expect(bootstrap).toContain('available story-management tools')
    expect(bootstrap).not.toMatch(/update_state|future_plot_plan|update_memory/)
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
