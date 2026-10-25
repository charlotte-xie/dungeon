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
| After 1f6cf63: memory keys the character by name, else `you` | not reached | The opening ended on the world for the first time ("…ripples that vanish into the dark"), though at one paragraph. A named variant ("Kestrel, a lone relic hunter with a debt to pay…") keyed memory "Kestrel", steers said "Kestrel", and the narration stayed "you"; the rival stayed "the stranger" until named. One line gave the character a feeling ("The debt you carry feels heavier here"). |
| After 5c1bd4c: the reply opens with the player's move | not reached | The opening ended on the world ("The lantern flame gutters once…"). The first action was retold almost word for word ("You light your lantern and wade in towards the sound, sword in hand.") before the scene moved on. |
| After 5c1bd4c: memory as single complete sentences, with `appearance`, `wearing` and a `secrets` map | not reached | Thorne's entry came out as complete sentences naming him, with `appearance`, `wearing`, `wants` and `bond`, a `secrets` item ("Thorne's satchel contains a clinking relic…") and `knowledge` set item by item. Still: one `knowledge` item was a passing observation ("Thorne heard the measured splash… but dismissed it as settling stones"), and Thorne's entry said "the player" rather than "you". |
| After 5c1bd4c: an answered or passed situation is settled; next-step beats go in the steer | 0 of 4 | The rival answered the player's question once and never re-asked or repeated a tactic, and each Continue moved the world (Elias wounded, firing, the chain hauling the guardian back). But across three Continues Elias pushed the same request each time ("Box is straight on—left arch—go!", "Take it—now!", "Seal's on the left—press it!"), and the last reply ended on a dilemma ("…Elias may be lost with it, yet the bronze box is suddenly within reach"). The Plotter still put next-step beats in the plan, framed as the player's decision ("…must decide whether to seize it or aid Elias"), even with the rules, the tool and the per-reply instruction all saying the next step goes in the steer. Twice, the Plotter request after a plea scene ran for more than two minutes without returning; a fresh adventure went through normally meanwhile. |
| After 5c1bd4c: the plan holds long-term story ideas only | 0 of 3 | The opening set three long-term entries (the first relic waking its guardians, the rising flood, the order's secret), and the plan stayed unchanged through the rival's arrival and two Continues: no next-step entries. Mira's lines didn't repeat ("Back off. These bones are spoken for.", "Left flank—unless you'd rather drown alone.", "Behind you!"), and each reply ended on the world. Steers still framed choices ("must either fight together or against each other") and on the second Continue moved the player ("Mira Voss and the player engage the skeletal guardian"), though the narration didn't turn either into a choice. |
| After bfac15f: the steer carries the one development that does most for the story, as narrative direction, with words and detail left to the narrator (uncommitted) | 2 of 4 | Every Continue reached a real development: through the arch into a rune-lit corridor, a many-jointed thing surging out of the flood, then the dais guardian rising after the bold sword-thrust landed. No reply was a small beat. Steers carried no dialogue. The character was named Riven at the opening, "Riven is the player's character", with "their" in the records. Still: 4 of 7 replies ended on an NPC's line pressing the player, including the corpse's "Prove you are not thieves… or drown with the rest."; one steer framed a choice ("a step closer to deciding whether to proceed together") and named Riven rather than "you"; the narrator copied one prose-like steer word for word; Elara was named in narration before she gave her name; replies ran 95–182 words. |
