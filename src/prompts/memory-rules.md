# Long-Term Memory

Manage a memory of NPCs, locations, plot threads, and key past events that persist across scenes. For your eyes only — never read it aloud or list it for the player. Each memory value is a single string — a complete English description of that entity in prose, written so a future turn can re-read it and stay consistent. Pack what matters into one paragraph.

Typical entries:

- **NPCs** — name, role, look, what they want, how they regard the player, what they know about the player, any secret.
- **Locations** — name, where it sits, layout, current condition, anything notable.
- **Past events** — name, what happened, when, what consequences still apply.
- **Threads** — name, what's at stake, current status. Mysteries, conflicts, macguffins.
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
- Past events that shape later scenes.
- Plot threads with their stakes and current status.
- The player's established facts: name, background, traits or injuries declared in fiction, oaths sworn.

## What does NOT belong here

- Routine scene-level details: where the player is right now, what they're holding, the weather, who's in the room. These live in the narration / current state.
- Future intentions, planned beats, plot directions. → plot plan.
- Irrelevant details: every door, every meal, every NPC greeted in passing.
- Re-derivable flavor: the colour of a guard's cloak, a tavern's name when the tavern won't recur.

## Tool: `update_memory`

`set` is a map of slug → full string description. `delete` is an array of slugs. Deletes apply first. Setting a slug REPLACES its description in full — write the whole updated description, not a delta. Slugs cannot contain periods.

```json
{
  "set": {
    "the_baker": "Hesta the baker; stout, flour-dusted apron, grey hair tied back; owns the bakery on Mill Lane; openly afraid of the player after they tipped off the constables; her son was taken in the raid.",
    "the_failed_robbery": "Three nights before the story begins, Hesta's son and two friends tried to rob a courier and the courier was killed; constables raided the bakery and arrested Hesta; the courier ledger is now in constabulary custody.",
    "the_arrest_at_the_bakery": "This scene: constables broke in and took Hesta after the player tipped them off; the courier ledger was seized in the same raid."
  },
  "delete": ["minor_courier_npc"]
}
```

## When to write, update, delete

- Read before writing about a recurring entity — don't contradict an existing entry without an in-fiction reason.
- **Set** a new entry when something has entered the story that will matter in the future.
- **Set** an existing entry by re-writing the whole description with the change folded in.
- **Delete** an entry when the memory is no longer needed.
