import { describe, expect, it } from 'vitest'
import {
  buildMemoryRules,
  buildNewAdventureBootstrap,
  buildPlotRules,
  buildSummarizerLengthNote,
  buildTurnReminder,
  CONTINUE_DIRECTIVE,
  DEFAULT_SYSTEM_PROMPT,
  PLOTTER_SYSTEM_PROMPT,
  SUMMARIZER_SYSTEM_PROMPT,
} from './prompts'

describe('capability-aware prompts', () => {
  it('opens on the player’s move only when there is one', () => {
    expect(buildTurnReminder('continue')).toBe(
      'Carry on from where the last reply ended, advancing the story to its next meaningful development.',
    )
    expect(buildTurnReminder('player')).toBe(
      'Open with what the player did, briefly, and what they said, in their exact words. Play out what follows, including the next meaningful story development.',
    )
  })

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

  it('follows the player’s pace, focus and interest first', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Their focus and interest come first: what is meaningful is what they engage with')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('When they dwell on a moment and give it detail, play it out with them at that depth')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('when they skim past something or skip ahead, move on with them')
  })

  it('keeps the story moving through consequences grown from what is in play', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Developments grow out of what is already in play')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('what is set up pays off')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('the story moves on from it')
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      'play out the consequences, including the next meaningful story development',
    )
    // The player's move is told first, so the reply reads as a story.
    expect(DEFAULT_SYSTEM_PROMPT).toContain('When the player acts or speaks, open by telling it, briefly')
    // Scripting the last line turned a fight into attack after attack.
    expect(DEFAULT_SYSTEM_PROMPT).not.toMatch(/closes? on|camera|last line/i)
    // People follow their own goals rather than waiting on the player.
    expect(DEFAULT_SYSTEM_PROMPT).toContain('follow their own goals, with their own personality and subtext')
  })

  it('leaves the player’s character to the player, and keeps each reply fresh', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain("They do only what the player's input says or implies")
    // Shared feelings too: "something neither of you has named yet".
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      'never write them for the player, alone or as something they share with someone else',
    )
    expect(DEFAULT_SYSTEM_PROMPT).toContain('a question, tactic, gesture, image or phrase used once is spent')
    // Rain came back harder in six replies running.
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      'a detail of the setting already given stays in the background until something changes it',
    )
    // Fiction, not explanation.
    expect(DEFAULT_SYSTEM_PROMPT).toContain('let motives, meaning and mood show through it, never named or explained')
    // An answered question or met situation is settled, not re-asked.
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      'or the player has answered it, let it pass or left it alone, the story moves on from it',
    )
  })

  it('measures length preferences against a full reply', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('any length preference is measured against that')
  })

  it('brings the story to where the player can take it on, without handing it back', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain(
      'bring the story to a point where they can take it on, without asking or prompting them',
    )
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
    expect(rules).toContain('private notebook of long-term story ideas')
    // Next-step beats belong in the steer, not the plan.
    expect(rules).toContain('the next step goes in your steer, not the plan')
    expect(rules).toContain('Each entry is a long-term development the world will bring about')
    // Changes are optional: only a good idea that improves the story.
    expect(rules).toContain('change it only when that improves the story')
    // Labelled entries and a worked example planned the player's decision,
    // which came back as NPC ultimatums.
    expect(rules).not.toMatch(/example|question|promise|stakes|payoff/i)
  })

  it('records the player’s character by name, as a fact of the story', () => {
    const rules = buildMemoryRules()
    // Always a name: keying them `you` until named was a needless special case.
    expect(rules).toContain("The player's character always has a name, and their entry is keyed by it")
    expect(rules).toContain('give them a name that fits the scenario as you set up the records at the opening')
    expect(rules).toContain('"is": "Amy is the player\'s character, a drifter newly arrived in town."')
    expect(rules).not.toMatch(/`you` until|key `player`/)
    // The story still calls them "you"; so do the Plotter's steers.
    expect(DEFAULT_SYSTEM_PROMPT).toContain('in the story they are always "you", whatever name others know them by')
    expect(PLOTTER_SYSTEM_PROMPT).toContain('In the records they go by their name; in your steers, as in the story, they are "you".')
    // "The player" in the records leaked into dialogue.
    expect(rules).not.toMatch(/saw the player|wary of the player|The player is lean/)
  })

  it('keeps gathered facts as short items, each one that will matter later', () => {
    const rules = buildMemoryRules()
    // One long knowledge string recounting every scene was the failure.
    expect(rules).toContain('is a map with one short item for each fact')
    expect(rules).toContain('It holds only points that matter to the plot, not every observation.')
    expect(rules).toContain('"constable": "Hesta saw Amy argue with a constable."')
    // Single complete sentences, never fragments ("30 pounds").
    expect(rules).toContain('a single complete present-tense sentence that names its subject')
    expect(rules).toContain('"money": "Amy has 30 pounds."')
    expect(rules).toContain('`appearance`, `wearing`')
    expect(rules).toContain('`secrets` (a map')
  })

  it('gives the Plotter a brief of its own, for directing rather than writing', () => {
    expect(PLOTTER_SYSTEM_PROMPT).toContain('You are the Plotter of an interactive story')
    // With the narrator's writing brief, it sometimes wrote the scene itself.
    expect(PLOTTER_SYSTEM_PROMPT).toContain('You never write the story yourself; you reply with tool calls alone')
    expect(PLOTTER_SYSTEM_PROMPT).not.toMatch(/You are the DM|second person|paragraphs/)
    expect(PLOTTER_SYSTEM_PROMPT).toContain("Follow the player's pace, focus and interest first")
    expect(PLOTTER_SYSTEM_PROMPT).toContain(
      'Your steer gives the narrator the development for the next reply: the one that does most for the story at this point',
    )
    expect(PLOTTER_SYSTEM_PROMPT).toContain('carried by the world and its people')
    expect(PLOTTER_SYSTEM_PROMPT).toContain(
      "the words people say and the details of the scene are the narrator's to write",
    )
    // What the player ignores doesn't come back: Theo knocked three times.
    expect(PLOTTER_SYSTEM_PROMPT).toContain(
      'Whatever the player has answered, let pass or not engaged with is settled, and it doesn\'t come back or repeat.',
    )
    expect(PLOTTER_SYSTEM_PROMPT).not.toMatch(/decision|choice|decide|choose|bargain|option/i)
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
