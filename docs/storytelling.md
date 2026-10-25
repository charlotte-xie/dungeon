# Storytelling requirements

Prompt changes are checked against these.

## Narrator

- Does the writing. Nothing else.
- No reasoning, no tools. It writes from the story, its story updates and its notes for the reply.
- A story update stays in its history: the memories recalled for the reply, as they stood then, and the player's OOC instructions when they change. An entry it already holds is brought up to date when the records change, so its view never goes stale.
- The notes for the reply are for that reply only: the scene as it stands and the steer. Past steers don't stay in view to be copied or repeated, and the Plotter's record-keeping stays out of sight.
- Follows the steer.
- The player's character does only what the player's input says or implies.
- Never decides what the player's character thinks, feels, says or chooses.
- The player's emotions and interiority are their own: never written for them, alone or shared ("something neither of you has named").
- Opens by narrating what the player did and said, briefly, then plays out what follows: it reads as a story.
- Uses the player's exact words when given; narrates the gist of their speech without inventing a quote.
- British/international English, second person, present tense.
- Stays in the story: the player hears from the world, never from the DM.
- Clean, vivid prose: no telegraphic fragments, adjectives used as adverbs, stock clichés or purple prose.
- No recapping: a remembered fact is mentioned only when the moment makes it newly relevant.
- Writes fiction, not explanation: what happens and what people do and say, with motives, meaning and mood left to show through them, never named.
- Fresh each reply: a question, tactic, gesture, image or phrase used once is spent.
  - Atmosphere comes from fresh, specific detail. A detail of the setting already given stays in the background unless something changes it: rain came back harder in six replies running, often as the last line.

## Plotter

- Runs before the narrator. A few seconds is fine.
- Has its own system prompt: it directs the story and keeps the records, replying with tool calls alone, and never writes the story. With the narrator's brief as its system prompt, it sometimes wrote the scene itself, or typed its steer out as text, instead of steering.
- Injects plot ideas.
- Reminds the narrator of key memories.
- Stops the narrator being boring or repetitive.
- Keeps the records: state, memory, plot plan, OOC preferences.
- Steers every reply: what happens in the world, such as an NPC pursuing a goal, a transition to the next scene, or the consequences of a player action.
- Maintains continuity by reminding the narrator of key details
- Memory holds durable facts about people, places and things, each a single complete present-tense sentence that means something on its own, with no implied context: no fragments. The current scene stays out.
- Characters' appearance and what they are wearing are recorded. Secrets are a map, one per secret, so each goes once the story reveals it.
- Facets that gather facts (knowledge, possessions, relationships) are maps of short items, each an important, plot-relevant point: not every observation, and not one long string recounting every scene.
- The player's memory entry has no wants or bond: the player's intent is theirs.
- The player's character always has a name in the records: the scenario's or the player's, or, when neither gives one, a name that fits the scenario, which the Plotter gives them as it sets up the records at the opening. Their entry says they are the player's character. Steers call them "you", as the story does, and nothing calls them "the player". "The player" in the records leaked into dialogue ("Sam, keep the player on it") and narration ("She stops at the player's table"), and keying them `you` until named was a needless special case.
- The plot plan is a private list of long-term story ideas only, never revealed. It changes when the story takes a different direction.
- The next step goes in the steer, never the plan.
- Plan changes are optional: the Plotter inserts a good idea that improves the story, and removes an entry once it is completed or abandoned.
  - Insert and remove only: rewriting entries in place turned medium-term directions into notes on the current scene.
  - Not a labelled structure: Promise, Question, Stakes and Payoff planned the player's decision, which waited in the plan and came back as NPC ultimatums.
- The plan and steers are about the world: an NPC pursues a goal, a transition to a new scene, the important consequences of the player's last action. They never set up a choice for the player.
- Secrets stay hidden until the story reveals them.
- Sets up what each NPC wants from the opening, so they have something to pursue.
- Plan entries are developments someone will bring about, not themes ("A slow-burn attraction develops").
- Records only what is important for future continuity: catalogued details came back as repetition.
- Steers include the player's character only as the player's input says or implies, and leave their feelings to the player.
- Steers say what the reply should achieve: what happens and what changes, as plain outcomes in the world, with no reasons or commentary ("to gain time for himself", "This advances the deadline pressure"). They may give mood or style guidance; the narrator shows it and never names it.
- The narrator fills in the telling: the words people say and the details of the scene. Steers that scripted every line were copied word for word, leaving the Plotter writing the dialogue, and a weather line added to every steer became rain in every reply.

## Story

- The player's pace, focus and interest come first. What is meaningful depends on the player and what they engage with: when they dwell on a moment and give it detail, it plays out with them at that depth; when they skim past something or skip ahead, the story moves on with them. Different players want different amounts of detail.
  - Without this, an intimate scene the player was dwelling on was cut short twice ("you have sex… Afterwards…"), with the same NPC knocking at the door each time. With the player's OOC request for detail, the same move played out in full.
- Dramatic story, not life sim.
- Keep the story moving: write to a point inviting the player to make real decisions, not react to minor annoyances or bookkeeping details.
  - Prompts express this without "decision" or "choice" wording, which pulls models towards ending on a choice (526c859).
- Play out consequences, including the next meaningful story development. While the player dwells on a moment, the development grows inside it: how the people in it respond, and what it changes between them.
- Leave the player an open opportunity for where to take the story next.
  - Prompts don't script how a reply ends. Closing on an NPC's line or action (8cbe3b8) turned a fight into attack after attack for seven replies.
- We never want to end on a choice ("Do X or Y?").
- Never end on a prompt for the player or hand the story back for them to settle: a question (an NPC's included), a list of options, someone or something waiting, or narration pointing at the player's turn. Bring the story to a point where the player can take it on.
  - Prompts avoid "for the player to respond to" framing, which led models to write the prompt out.
- Continue is a whole, full turn. Players press it when they think the story hasn't advanced enough: move faster to a meaningful development.
  - The player's last move was played out in the last reply: Continue carries on from where that reply ended, advancing the story, and never retells it.
- Continuity is very important. If the player is carrying a dagger in one scene, it shouldn't transform into an axe without a good reason
- Deliver the kind of story the scenario and style guide promise, in their register.
- Developments grow out of what's already in play, not new threats from nowhere.
- Once a planned development happens, it gives way to its consequence; it is never replayed.
- Once the player has answered a question or met a situation, let it pass with a Continue, or not engaged with it, it's settled: the story moves on to what that brings, and no NPC asks again or repeats the same move.
- What the player passes over takes a clause; a simple task doesn't sprout a chain of errands.
- Quiet scenes are fine when something moves beneath them.
- Respect the player's steering: explicit redirection wins, and a thread they turn away from stays dropped rather than returning in disguise. Brief replies and Continue aren't rejection.

## People

- NPCs follow their own goals, with their own personality and subtext, and keep the initiative. The world doesn't wait for the player; antagonists push on over objections.
- NPCs speak in their own voice, obliquely. They never explain the plot, recap, or list the player's options.
- NPCs know only what they would naturally know; their ignorance can show.

## OOC

- OOC direction, in (parentheses) or [brackets], is authoritative and applied without mention in the story.
- "NEXT REPLY ONLY" guidance applies to one reply. Standing preferences hold until the player changes them.
- The OOC list holds only direction the player has given, each as a standing preference ("Don't have NPCs ask repetitive questions").
  - A length example on the OOC tool led the Plotter to record the brief's own "two or three paragraphs" as a preference the player never gave.

## Prompts

- As simple as possible: storytelling, not mechanics.
- Context, not strict rules to be analysed.
- Instruct positively, not "avoid".
- Revisit the whole prompt; don't just add lines or rules. Overall "gist" is important
- Principles, not worked examples: models copy an example's shape.
  - The plan example's bargain, "struck or broken", came back as NPC ultimatums.
- Storytelling wording, not a multiple-choice adventure game.
  - "Bargain" and "the player's options" in the brief came back as NPCs pressing the player for an answer.
- Never bust the prefix cache.
- Prompts guide; code enforces only safety. Size limits are soft hints, never caps.
- A switched-off record is never mentioned in any prompt.
- Not tied to xAI: any OpenAI-compatible provider.

## Anti-patterns seen in play

If these are observed regularly, the prompt or tools probably need tweaking

- Ending on a choice: "Take the key or back away?"
- Ending on a prompt: "…waiting for your answer", "urging you to step through or turn back", "as though the vault itself is pressing you to decide".
- NPCs using dialogue to present an X-or-Y choice: "Name yourself or bleed.", "Answer, or return what you hold."
- The same choice re-offered for six turns.
- An NPC repeating a move the player has already met: Thorne steering them away from the same passage four replies running.
- An NPC repeating a move the player ignored: Theo knocking three times after "I ignore the footsteps".
- Replies ending on "…waiting".
- Handing back: "leaves the choice entirely yours", "The first step is yours.", "The Vaults wait.", "a pause, the kind that invites reply", or an NPC's "Walk back with me?" as the last line.
- Micro actions: a fight running reply after reply, each ending on the next attack.
- Cutting short a moment the player is dwelling on: an intimate scene compressed to "Afterwards…", then an NPC knocking at the door.
- Naming the mood instead of showing it: "The psychological tension sharpens.", often repeated.
- Explaining instead of telling: "It sounds like a practical offer. It also sounds like an invitation…", "…if you leave him, the creature will be on you next."
- The same closing image reply after reply: "Outside, a bus hisses… Inside, the evening has narrowed to…".
- The same detail escalating reply after reply: "The rain drums harder", "drives harder", "beats harder".
- The player's character moved, or given feelings, beyond their input: "You turn left.", "neither of you is in a hurry to leave".
- Third-person narration copied from a steer written about the player: "They finish the drinks".
- Foreshadowing that never delivers.
- Replies shrinking every turn under "keep replies a bit shorter".
- The Plotter writing prose instead of steering.
