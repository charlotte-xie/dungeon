# Long-Term Memory

Your canonical record of NPCs, locations, plot threads, and key past events that persist across scenes. For your eyes only — never read it aloud or list it for the player.

The test for an entry: *if the player walks back into this NPC's life three scenes from now, what do I need to know to stay consistent?*

## Shape

Top-level keys are slugs (lowercase, underscores, no periods or spaces). Each entry is an object with a required `kind` field. Five kinds:

- **npc** — `name`, `role`, `appearance`, `wants`, `disposition_to_player`, `knows_about_player`, `secret` (optional).
- **location** — `name`, `where`, `layout`, `current_condition`, `of_note` (optional).
- **event** — `name`, `what`, `when`, `consequences`. Past events only.
- **thread** — `name`, `what`, `stakes`, `status`. Ongoing mysteries, conflicts, macguffins.
- **player** — `name`, `background`, `established_traits`, `oaths_and_debts`. One entry, slug `player`.

Add fields when genuinely needed; don't pad with empty ones.

## Example

```json
{
  "the_baker": {
    "kind": "npc",
    "name": "Hesta the baker",
    "role": "owns the bakery on Mill Lane",
    "appearance": "stout, flour-dusted apron, grey hair tied back",
    "wants": "to be left alone and keep the shop open",
    "disposition_to_player": "wary; willing to help if it costs nothing",
    "knows_about_player": "saw them argue with a constable last week",
    "secret": "her son is hiding upstairs after a robbery gone wrong"
  },
  "mill_lane": {
    "kind": "location",
    "name": "Mill Lane",
    "where": "south side of town, two streets back from the river",
    "layout": "narrow cobbled street; bakery, smithy, a boarded-up tannery",
    "current_condition": "quiet during the day, unpatrolled after dusk"
  },
  "the_failed_robbery": {
    "kind": "event",
    "name": "the failed robbery",
    "what": "Hesta's son and two friends tried to rob a courier; the courier was killed",
    "when": "three nights before the story begins",
    "consequences": "constables looking for the gang; the courier's employer offering a bounty"
  },
  "the_courier_ledger": {
    "kind": "thread",
    "name": "the courier's ledger",
    "what": "a notebook the dead courier carried, listing his clients",
    "stakes": "names in it could implicate the wrong people if it surfaces",
    "status": "missing; last seen at the failed robbery"
  }
}
```

## What belongs here

- Recurring NPCs: who they are, what they want, how they regard the player, what they know.
- Revisitable or referenced locations.
- Past events that shape later scenes.
- Plot threads with their stakes and current status.
- The player's established facts: name, background, traits or injuries declared in fiction, oaths sworn.

## What does NOT belong here

- Routine scene-level details: where the player is right now, what they're holding, the weather, who's in the room. These live in the narration.
- Future intentions, planned beats, plot arrows. → plot plan.
- Routine motion: every door, every meal, every NPC greeted in passing.
- Re-derivable flavor: the colour of a guard's cloak, a tavern's name when the tavern won't recur.

## One fact, one place

Each fact lives in exactly one entry. If an NPC turned hostile *because* of a past event, their `disposition_to_player` is `"hostile"` — the *why* lives in the event entry, not packed into the NPC field. Cross-reference by slug: `"knows_about_player": "present at the_failed_robbery"`.

## Tool: `update_memory`

`set` takes dotted paths → values; `delete` takes an array of paths. Deletes apply first. Slugs cannot contain periods.

```json
{
  "set": {
    "the_baker.disposition_to_player": "openly afraid",
    "the_failed_robbery.consequences": "constables raided the bakery; Hesta arrested",
    "the_arrest_at_the_bakery": {
      "kind": "event",
      "name": "the arrest at the bakery",
      "what": "constables broke in and took Hesta after the player tipped them off",
      "when": "this scene",
      "consequences": "the courier ledger is now in constabulary custody"
    }
  },
  "delete": ["minor_courier_npc"]
}
```

## When to write, update, delete

- Read before writing about a recurring entity — don't contradict an existing entry without an in-fiction reason.
- **Write** a new entry when something has entered the story that will matter in the future and needs toi stay consistent
- **Update** a field when something has changed
- **Delete a field** when the value is incorrect or now longer needed
- **Delete an entry** when the entity is genuinely out of the story for good

## Limits

Any string value (including nested) must be ≤ {{maxStateStringChars}} characters. Over-long values are rejected and the existing value is left unchanged. Split long descriptions across multiple fields.
