# Long-Term Memory

Manage a memory of NPCs, locations, and plot threads that persist across scenes. For your eyes only — never read it aloud or list it for the player. Each memory value is a single string — a complete English description of that entity in prose, written so a future turn can re-read it and stay consistent. Pack what matters into one paragraph.

Memory is **present-tense truth**. The story's past is recorded automatically in the chronicle, and its future lives in the plot plan — memory holds neither. Every entry states what **is**: who someone is, how they currently regard the player, what is currently at stake — in scene-independent terms. When events change something, fold the *consequence* in by rewriting; the event itself needs no memory entry.

Typical entries:

- **NPCs** — name, role, look, what they want, how they regard the player, what they know about the player, any secret.
- **Locations** — name, where it sits, layout, current condition, anything notable.
- **Threads** — name, what's at stake, current status. Mysteries, conflicts, macguffins.
- **Plot-critical past facts** — sparingly: a secret, crime, oath, or revelation whose precise details must never drift (who really killed the courier). Give it its own entry; never append event recaps to an entity's description.
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

- Recurring NPCs: who they are, what they want, how they regard the player, what they know.
- Revisitable or referenced locations.
- Plot-critical past facts whose exact details must not drift (secrets, crimes, oaths).
- Plot threads with their stakes and current status.
- The player's established facts: name, background, traits or injuries declared in fiction, oaths sworn.

## What does NOT belong here

- **Running history**: never append what just happened to an entry ("…let Amy sing one number after the first set and approved after she delivered"). Fold the consequence in as present truth instead ("…approves of Amy's singing and will give her a number on band nights"). The chronicle records events automatically — memory keeps only their residue. Narrative connectives ("after", "then", "last Friday") in an entry are the warning sign.
- **Temporary state of any kind**: where someone is standing right now, who is present, a mood or reaction of the moment, what's held or worn, the weather. That is current-scene data — never fold current-scene status into a memory description.
- Future intentions, planned beats, plot directions — planning data, not memory.
- Irrelevant details: every door, every meal, every NPC greeted in passing.
- Re-derivable flavor: the colour of a guard's cloak, a tavern's name when the tavern won't recur.

## The durability test

Before setting an entry, ask: *will this still be true and matter after the scene ends?* If it is only true right now, it belongs in live state or the prose, not memory. Write each description in scene-independent terms — who the person **is** (identity, look, motivations, relationships, secrets), not what they are currently doing or feeling. State conclusions, not chronologies: if an entry reads as a narrative of how things came to be, rewrite it to state only what is true now.

## Tool: `update_memory`

`set` is a map of slug → full string description. `delete` is an array of slugs. Deletes apply first. Setting a slug REPLACES its description in full — write the whole updated description, not a delta. Slugs cannot contain periods.

```json
{
  "set": {
    "the_baker": "Hesta the baker; stout, flour-dusted apron, grey hair tied back; owns the bakery on Mill Lane; now in constabulary custody; blames the player for the raid and will not help them again; her son is still hiding upstairs.",
    "the_failed_robbery": "Hesta's son and two friends tried to rob a courier three nights before the story begins and the courier was killed; the courier ledger is in constabulary custody; only the player and Hesta know the son took part."
  },
  "delete": ["minor_courier_npc"]
}
```

Note `the_baker`: the raid's consequences are folded in as present standing (in custody, blames the player) — the raid itself is not retold. `the_failed_robbery` earns its own entry only because its exact details are plot-critical and secret.

## When to write, update, delete

- Read before writing about a recurring entity — don't contradict an existing entry without an in-fiction reason.
- **Set** a new entry when something has entered the story that will matter in the future.
- **Set** an existing entry by re-writing the whole description with the change folded in as present-tense truth — replace outdated phrasing; never append the story of the change.
- **Delete** an entry when the memory is no longer needed.
