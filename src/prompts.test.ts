import { describe, expect, it } from 'vitest'
import {
  buildNewAdventureBootstrap,
  buildPlotRules,
  buildSummarizerPrompt,
  buildTurnReminder,
  DEFAULT_SYSTEM_PROMPT,
} from './prompts'

describe('capability-aware prompts', () => {
  it('mentions only enabled maintenance tools', () => {
    const reminder = buildTurnReminder({
      worldState: false,
      plotOutline: true,
      memory: false,
    })

    expect(reminder).toContain('`future_plot_plan`')
    expect(reminder).not.toContain('`update_state`')
    expect(reminder).not.toContain('`update_memory`')
  })

  it('does not demand a specific tool during bootstrap', () => {
    const bootstrap = buildNewAdventureBootstrap()

    expect(bootstrap).toContain('available story-management tools')
    expect(bootstrap).not.toMatch(/update_state|future_plot_plan|update_memory/)
  })

  it('defines progression as causal change without random escalation', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Progression Without Churn')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Prefer the next consequence of an established cause')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('not random escalation')

    const reminder = buildTurnReminder({
      worldState: false,
      plotOutline: false,
      memory: false,
    })
    expect(reminder).toContain('advance one existing cause into a new consequence')
    expect(reminder).toContain('Prefer concrete progression')
  })

  it('prevents semantically duplicate future plot beats', () => {
    const rules = buildPlotRules(10, 500)
    expect(rules).toContain('same dramatic function')
    expect(rules).toContain('never preserve and replay it')
  })

  it('treats the summary length as a ceiling rather than a quota', () => {
    const prompt = buildSummarizerPrompt(500)
    expect(prompt).toContain('This is a ceiling, not a target')
    expect(prompt).toContain('Details whose removal would not affect a later decision')
  })
})
