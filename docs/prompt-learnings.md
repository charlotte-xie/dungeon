# Prompt learnings

What play has shown about how the models read their prompts and requests, and the wordings that led them astray. [storytelling.md](storytelling.md) says what the story must be and lists the failures seen in play; this file records what caused them, so a prompt change can be checked against what has already been tried.

Most of it comes from play on grok-4.3, with the narrator's reasoning off and the Plotter's low. Most changes were tried in one or two short runs, so a result marked "one run" may be chance.

## The models take wording literally

Low-reasoning models act on the plainest reading of each phrase, everywhere it could apply, rather than on the intent behind it.

- "Stop when the development has landed or the next move is the player's" gave one gesture in close-up and a stop. "Stop as soon as the development lands" gave replies of 44–81 words, and fights that moved one blow per reply.
- On a Continue, "their character carries on as before" read as leave to act: when the last reply ended on an NPC's request, the Plotter had the player's character carry it out. "Carries on only with what the player last had them doing" holds.
- A steer saying what the reply should "achieve" made the outcome the player's character's to bring about, and on Continue the narrator wrote the detective's questions (two Continues of two).
- "Record important events" became a log of the player's actions, set again on 9 turns of 11. "The story covers immediate events" became a status line rewritten every turn.
- An order line naming every record tool read as calls to make in that order every turn, and on a Continue the Plotter appended a copy of the OOC list. Naming them as alternatives, "for each record you change", stopped it.
- An optional field is filled every time: a `long_term` field on the steer, "only when direction changes", was filled every turn.
- "Show the world and its effect on them" licensed writing the player's feelings ("something neither of you has named yet", three times in one run). Removing the phrase fixed it; a rule added on top would not have.
- "With the truth behind each mystery settled" gave placeholders ("protecting something…") in three runs of three, and the line is gone.

## What the models read, they write with

Wording in a prompt, a record or the history comes back out, often word for word.

- Worked examples of prose are copied in shape: a tavern scene in the narrator's brief came back beat for beat in a new scene, and a plan example's bargain "struck or broken" came back almost verbatim.
- The opening reply is the strongest example of all: later replies copy its length, its ending, and whether it closes on a question.
- Examples set the style of what is recorded: fragment chains taught telegraphic memory, and "the player" in the memory example spread to steers and then into dialogue ("keep the player on it").
- Bare verb phrases in an example ("answers a question with a question") read as instructions, likely to become tics acted out in every scene. A sentence with its subject ("Hesta is brisk and sharp-tongued…") describes.
- An example in a tool description is taken as data: the OOC tool's "replies of about two short paragraphs" turned up in steers, and under "a bit shorter" replies shrank from 236 words to 46.
- A key term the prompt leans on comes back out: a summariser prompt built around threads gave entries opening "The theft thread continues", and steers began "moving the debt arc forward".
- Lines in the Plotter's own steps are relayed into the steer: "Keep to 1-4 paragraphs, British English", "End at a point where [the character] can respond", "Do not decide the player's actions or feelings". The opening's writing instructions came back as "Keep the narration high quality".
- Scripted lines in a steer are used word for word by the narrator, and a weather line in every steer became rain in every reply.
- Text fed back gets repeated: the Plotter's stray prose, returned to it, was copied word for word, and past steers left in the narrator's history were patterns to follow.

Examples still earn their place where copying is the point, as in a record's format: a JSON5 memory example with a comment on each facet did better than the rules it replaced. Such an example has to work when copied verbatim, and holds only what a scenario would give.

## Naming a thing invites it

- Choice words pull towards choices. With "decision", "choice", "bargain" and "options" in the prompts, NPCs ended replies on X-or-Y ultimatums ("Step inside, or drown where you stand."), every NPC bargained, and steers asked for "a natural pause for decision". "Challenge" in a steer became an ally-or-rival ultimatum. With the words gone and NPCs pursuing their own goals, ultimatums fell from two or three per six replies to none in the relic hunter, though a few came back in a later run's emotional dialogue. A test keeps the words out.
- Each explicit instruction on how a reply ends bred a new habit:
  - "a story development for the player to respond to" had the models write the cue out ("waiting for your answer");
  - ending on a line of dialogue or an action by someone other than the player cleaned up the endings, but put ultimatums in NPCs' mouths in 4 replies of 6, and turned a fight into seven replies each ending on the next attack.
  Asking for the consequences to play out, including the next meaningful development, let the fight end within two replies.
- What the narrator may not say itself, it gives to an NPC: told to bring the story to a point the player can take on "without asking or prompting them", it had a character ask instead, and in one run 10 replies of 13 ended on someone putting a question to the player.
- Arcs worded as events ("will reach the bakery, and what Hesta hides there will come out") landed in the next reply, one the steer never mentioned. The heading "Where the story is heading" invited getting there. Worded as ongoing threads, "a quarrel… growing sharper", they developed over many replies.

## What a step asks for, every output holds

A step that says what its output must contain gets that in every output, whether or not it suits the moment. A clause added to fix one play test becomes a rule that is wrong elsewhere.

- "Who is trying to do what" put every character in motion every turn, and the story ran too fast.
- Asking each steer to say who acts, what they are after and how the scene turns gave steers with three to five characters acting and a formulaic turn at the end.
- A list of the kinds of steer had steers pick from the list, and its example "let the scene breathe" was copied into them; the story slowed.
- "Each steer moves one [arc] on a little" had the Plotter rewrite an arc nearly every turn, until it was a running note on the current scene; with the line gone, arcs changed about once in six turns. An `update` operation plus "update the plan" did the same to the plan.
- Each "and" in such a step is one more thing every output holds.
- Clauses added one fix at a time grew the Plotter's per-turn steps to about 350 words that contradicted each other: a Continue "moves on" in one place and is "how the people in it respond" in another.

## Restraint wording makes the model passive

- "If it helps, steer the reply", with a steer tool that said "Skip it when… the reply [is] clear", gave a steer in 1 call of 11. Its ideas went into the private plan the narrator never sees. Asked to steer every reply, it steered in 4 of 4.
- "Change it only when that improves the story" left the plan untouched after the opening in four runs.
- "Update the records where the last reply changed how things stand", beside "update a record only where something changed", recorded nothing for 11 turns.

A limit the story needs still has to be said, plainly. A rewrite into positive wording dropped "leave what the player's character does to the player", and on the next Continue the narrator acted for them ("You slash at the reaching arm"); a vague positive line, "something in motion for them to answer", did not replace it. "Only what the player's input says or implies" holds. When that line left the Plotter's steer step, a steer acted for the player within two turns.

## Rules get ticked off; a description gets written to

- A narrator brief of about 1,835 words of rules, with a ten-point turn reminder just before the reply, gave reasoning that ticked the rules off one by one ("I will not call tools during the narration"). Rewritten as a description of the story wanted, at about 550 words, the reasoning wrote the story.
- Each record's rules, as separate system messages near the top, were largely ignored by the Plotter: vague plan entries, group entries, invented wants for the player's character. In the description of the tool that keeps the record, with an example, the same rules held: one entry per person, and concrete secrets for the first time in five runs.

## Position matters

- The last thing a model reads outweighs its brief. "Narrate the player's move first" in the brief did nothing while the steer and the turn reminder pointed past the move; in the reminder it worked in 3 replies of 3. Side effect: short actions are echoed almost verbatim, and once a reminder phrase leaked into the story.
- The opening step's last line, "where the story is heading in the medium and long term", outweighed the rewritten plan rules, and the plan came out as themes.
- The model's own recent replies, right where it writes, outweigh a rule deep in the system prompt. A freshness rule only in the Plotter's steps never fired, and the narrator reused its own endings ("The corner of her mouth lifts" in four replies).
- Order within a list carries meaning: "what each person wants and keeps hidden, and the player's character" gave the player's character invented wants in four runs. With the player's character first, none in three.

## Give each role only what it acts on

Whatever a role reads, it treats as its business.

- The Plotter, opening with the narrator's brief, wrote the scene itself or typed its steer out as text (3 turns of 21). With a prompt of its own and a required tool call, none in about 40 turns.
- Given the style guide, the Plotter put a tone note on every steer ("Keep it grounded and claustrophobic"). Asked to help fix the narration, it wrote craft notes. Asked "how to develop the story", it wrote writing advice; asked "what happens in the world", it wrote events.
- Reply length and British English in the default OOC list were treated as the player's direction: copied into steers, the number changed once, and the list added again on a Continue. In the narrator's prompt only, no steer mentioned them.
- The opening and Continue, sent as out-of-character direction, were saved as standing instructions. As plain "Begin." and "Continue." inputs, with the steps saying what each means, they are not.
- The narrator, carrying 2,700 words of bookkeeping rules and a plan a turn out of date, did the director's job before writing: 4–5k reasoning tokens a reply. With the Plotter planning first and the narrator writing from its steer, replies took a few seconds, in clean prose.
- The summariser, given memory written later in the story, leaked names and secrets into summaries of earlier turns. Without a view of the wider story, it logged trivia. Given the earlier summaries instead, it leaked nothing.
- A note explaining the narrator's calls repeated its system prompt and was ignored. Calls named for what the narrator does with them (`recall_memories`, `get_steer`) need no note.

## What the history replays becomes the story

- Memory entries resent whole whenever one facet changed filled the narrator's view with "four days", which then appeared in 7 replies of 7. Sending only what changed, 2 of 6, both asked for by steers.
- Catalogued trivia comes back as repetition: details the Plotter recorded were fed back into steers, and an NPC repeated her confession.
- A detail that escalates counts as new to the model: "the rain drums harder", "drives harder", "beats harder", past a freshness rule.
- A plan entry holding a standing pressure (a deadline, fog thickening) is pushed by steers every reply, and escalates. Not solved.
- Standing OOC direction relayed into every steer becomes a tic: asked to keep a character comic, the Plotter added the same joke to every steer, and it appeared in every reply for ten turns. Not solved.

## Tools and record formats

- The example's shape beats the described mechanics. With entry names holding spaces, the Plotter wrote nested objects under `set` and wiped facets, and never used `merge`. With slug keys, a `name` facet and a dotted path in the example, updates kept everything.
- A facet named `status` is replaced; one worded as a running account is appended to.
- Facets that gather facts stay short as maps with one item per fact; as one string they grow into a recounting of every scene.
- Free text beside tool calls is no channel: the Plotter left it empty in 11 calls of 11. What must reach the narrator goes in a tool field.
- A reminder that is ignored needs `tool_choice: required`, and the stray prose it answers must not be fed back.

## Reasoning

- The narrator, with reasoning off, read "the next move is the player's" at its most literal and stopped on a single gesture.
- The summariser, written straight off with reasoning off, got facts wrong when it had to pick out what matters; with low reasoning its summaries stay true to the turns.

## Judging a change

- Look for what recurs across turns and runs. A single hand-back or odd ending is not a finding.
- A fix often moves a failure rather than removing it: the ending rule that stopped prompting endings started ultimatums. After a change, look for the new habit as well as the old one.
- Several changes tried at once can't be told apart.
- Check the request as it will be posted (Inspect), not a summary of it.
