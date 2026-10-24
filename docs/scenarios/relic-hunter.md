# Relic hunter

Fantasy, action-led, with a rival who arrives uninvited. It exercises fights, an NPC with competing aims, and the plan across a run of fast-moving scenes.

## Brief

**Scenario brief** (the app's default):

> A lone adventurer arrives at the threshold of the Mouldering Vaults — an ancient, half-flooded crypt rumoured to hide the relics of a forgotten order. The air is cold, the stones are damp, and something older than death stirs within. The tone is gritty and atmospheric.

**Style guide:** empty.

## Script

1. Begin.
2. Go in and bring the rival in by OOC: `I light my lantern and wade in towards the sound, sword in hand. (OOC: bring in another relic hunter who got here first.)`
3. Answer the rival in character with a question, for example `"Spoken for by who?" I ask, keeping my eyes on the water behind him.`
4. Continue, ideally while a fight or threat is under way.
5. A bold action that turns the scene: seize the relic, slam a gate, break away from the rival.
6. Continue.

## What it exercises

- **Fights:** does a fight resolve and move on, or loop with each reply ending on the next attack?
- **The rival:** does the rival pursue their own goal by acting, or press the player with ally-or-enemy ultimatums ("take them from me—or with me… Decide quickly")?
- **Replayed developments:** the relic lost, found and lost again.
- **The plan:** does the rival's goal become a direction? Are finished fights and scenes removed? Do entries stay medium-term?
- **Continue:** does it reach a new scene or outcome?

## Results

| Commit | NPC replies ending on an ultimatum | Findings |
|---|---|---|
| 5b98c48 | not tested (no NPC) | Closing on "a moment a camera would see" looped one fight for seven replies, each ending on the next attack; replies one paragraph (56–100 words); the reliquary lost twice. |
| 88b4e73 | 2 of 3 | Replies two to four paragraphs and the fight resolved in two; the bound spirit's "Refuse, and the water takes us both" came from the plan's bargain example. |
| Plan principles, Question still in (uncommitted) | 4 of 4 | The plan's Question became "Will the player and Elias ally or become enemies?" and steers said "forces the next choice". |
| 80306b8 | 1 of 4 | Steers describe the world; Mirael mostly acts on her own ("starts forward without waiting for agreement"). The narrator wrote the player's move once ("You turn left."). |
| b850a0c | 0 of 3 | Marek answered with his own goal and subtext. The plan stopped drifting but never removed completed entries, and added scene events rather than directions. The opening ended "The first step is yours." |
| After 5da8176: NPC goals at the opening, records only for continuity, the player acts only from their input, fresh images | 1 of 4 | Eldric was the best rival yet: he wades on without waiting, explains the Warden on his own terms and misdirects the player. One "Stay close or don't—your choice." The encounter with the Warden's limbs ran four replies, and the plan inserted each beat as an entry ("forcing a desperate choice between fighting it off or leaping for the grate"); the steer then said "the player must leap" and the narrator wrote "You leap." on a Continue. Endings waited ("The Vaults wait.", "The Vaults hold their breath."), and replies grew to four or five paragraphs (up to 301 words). The Plotter first used `remove`, to rewrite an entry by removing and reinserting it. |
| After 13e83b1: the character named in records ("the adventurer"), always "you" in the story; no asking or prompting at the end | 1 of 3 | Records said "the adventurer". The opening still handed back ("The threshold waits. One more step, and the world above will close behind you."), as openings of this scenario have each time. Maren acted on her own goal throughout (climbing out, sprinting for the censer), and the bold action's consequences landed. But she laid out "Two choices… We go back together…, or we press on…" mid-reply, although the steer hadn't; the reply itself ended on the world. The plan first removed a finished entry properly, but still planned "forcing desperate choices over the relics", and steers still said "follow or flee" and "a split-second choice". |
