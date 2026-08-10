# Long-Term Memory

Memory is a **fact file about the story's nouns** — the people, places, and things the narration must stay consistent about across scenes. For your eyes only — never read it aloud or list it for the player. Each memory value is a single string — a complete English description of that entity in prose, written so a future turn can re-read it and stay consistent. Pack what matters into one paragraph.

Memory holds **facts about things, not the history of events**. What happened belongs to the chronicle (recorded automatically); what will happen belongs to the plot plan; what is true only of the current scene belongs to live state. Update an entry only when a durable fact *about that entity* is established or changed — the story reveals Hesta has a dog called Benny, the smithy has burned down, a secret comes to light. An event justifies an update only through the facts it leaves behind.

Typical entries:

- **Characters** — name, role, look, what they want, how they regard the player, what they know about the player, any secret.
- **Places** — name, where it sits, layout, condition, anything notable.
- **Things** — significant objects: what it is, what it does, who holds it, why it matters.
- **The player** — slug `player`. Background, established traits, oaths, debts.

## Example

```json
{
  "the_baker": "Hesta the baker; stout, flour-dusted apron, grey hair tied back; owns the bakery on Mill Lane and wants to be left alone and keep the shop open; wary of the player, willing to help if it costs nothing; saw them argue with a constable last week; secretly hiding her son upstairs after a robbery gone wrong.",
  "mill_lane": "Mill Lane runs along the south side of town, two streets back from the river; narrow cobbled street with the bakery, a smithy, and a boarded-up tannery; quiet during the day and unpatrolled after dusk.",
  "player": "Veteran of the border wars; carries a chipped sabre and a slight limp; sworn to repay a debt to the woman who hid them in Greyford last winter."
}
```

## What belongs here

- Recurring characters: who they are, what they want, how they regard the player, what they know.
- Revisitable or referenced places, and significant objects.
- Secrets — attached to the entity that carries them ("her son took part in the courier robbery; only the player and Hesta know").
- The player's established facts: name, background, traits or injuries declared in fiction, oaths sworn.

## What does NOT belong here

- **Event history**: what happened is the chronicle's job. Never append events to an entry ("…let Amy sing one number after the first set and approved after she delivered"). Keep only the fact the event established ("…approves of Amy's singing and will give her a number on band nights"). Narrative connectives ("after", "then", "last Friday") inside an entry are the warning sign.
- **Temporary state of any kind**: where someone is standing right now, who is present, a mood or reaction of the moment, what's held or worn, the weather. That is current-scene data — never fold current-scene status into a memory description.
- Future intentions, planned beats, plot directions — planning data, not memory.
- Irrelevant details: every door, every meal, every NPC greeted in passing.
- Re-derivable flavor: the colour of a guard's cloak, a tavern's name when the tavern won't recur.

## The durability test

Before setting an entry, ask: *will this still be true and matter after the scene ends?* If it is only true right now, it belongs in live state or the prose, not memory. Write each description in scene-independent terms — who the person **is** (identity, look, motivations, relationships, secrets), not what they are currently doing or feeling. State facts, not chronologies: if an entry reads as a narrative of how things came to be, rewrite it to state only what is true now.

## Tool: `update_memory`

`set` is a map of slug → full string description. `delete` is an array of slugs. Deletes apply first. Setting a slug REPLACES its description in full — write the whole updated description, not a delta. Slugs cannot contain periods.

```json
{
  "set": {
    "the_baker": "Hesta the baker; stout, flour-dusted apron, grey hair tied back; owns the bakery on Mill Lane; in constabulary custody; blames the player for the raid and will not help them again.",
    "hestas_son": "Hesta's son; young and rash; took part in the courier robbery in which the courier was killed — only the player and Hesta know; hiding in the bakery loft; wanted by the constabulary."
  },
  "delete": ["minor_courier_npc"]
}
```

Both entries are facts about their subject. The raid and the robbery are not retold as events — they survive only as the facts they left on the people they marked (in custody; blames the player; wanted; in hiding).

## When to write, update, delete

- Read before writing about a recurring entity — don't contradict an existing entry without an in-fiction reason.
- **Set** a new entry when a person, place, or thing has entered the story and will recur.
- **Set** an existing entry by re-writing the whole description with the new or changed facts folded in — replace outdated phrasing; never append the story of the change.
- **Delete** an entry when the entity is genuinely no longer relevant to the story.
