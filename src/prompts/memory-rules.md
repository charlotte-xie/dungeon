# Long-Term Memory

This is your canonical record of NPCs, locations, plot themes, and key past events that should persist across scenes — the things that make the world feel coherent over time. It is for your eyes only; never read it aloud or list it for the player.

## Shape

Top-level keys are **entity names**. Each value is a JSON object of fields describing that entity. Examples:

```json
{
  "Lady Veyra": {
    "title": "spymaster of the Crimson Court",
    "appearance": "tall, hawk-eyed, gloved hands always",
    "disposition": "openly hostile to the player after the dock confrontation",
    "secret": "the cipher she carries is a forgery"
  },
  "the Abbey": {
    "location": "atop the cliffs north of Greyford",
    "layout": "central nave, two flanking cloisters, crypt beneath",
    "mood": "abandoned, wind-haunted, but recently disturbed"
  },
  "betrayal at Greyford": {
    "kind": "key past event",
    "what": "the player's mentor handed them to the Crimson Court",
    "consequences": "blood-debt with the mentor's family; player wanted in three counties"
  },
  "the Cipher of Ash": {
    "kind": "plot theme",
    "what": "an encrypted ledger of Court informants",
    "stakes": "whoever decodes it controls half the city's bribes"
  }
}
```

## What belongs here

- **NPCs** that may recur: name, role, appearance, disposition toward the player, motivations, secrets.
- **Locations** that may be revisited or referenced: where they are, what they look like, what's there.
- **Plot themes**: the over-arching threads, secrets, conflicts, and macguffins.
- **Key past events**: things that materially shape later scenes — betrayals, deaths, oaths, revelations.

## What does NOT belong here

- The current scene's location, weather, or moment-by-moment state. That is `update_state`'s job.
- The player's current position, what they're holding right now, what they just said. That is `update_state`'s job.
- A list of every door the player has walked through. Routine motion is not memory.
- Future intentions. Those go in the **future plot plan**, not memory.

## Tool: `update_memory`

Use the `update_memory` tool to write or revise entries. It mirrors `update_state`: provide `set` (a map of dotted-path → value) or `delete` (an array of dotted paths). Deletes apply first.

```json
{
  "set": {
    "Lady Veyra.disposition": "openly hostile after the dock confrontation",
    "Lady Veyra.last_seen": "fleeing the abbey on horseback",
    "the Abbey.mood": "scorched and abandoned after the fire"
  },
  "delete": ["Old Mill", "minor_courier_npc"]
}
```

## When to delete

Delete an entity ONLY when it is genuinely no longer relevant to the story going forward — a one-off NPC who has fully exited the narrative, a location that's been destroyed and won't be referenced again, a plot theme that's been resolved and closed. Do **NOT** delete on scene change. Memory persists; that's its purpose.

## Memory vs. State (decision rule)

- "Will this still matter three scenes from now?" → memory.
- "Is this only true for the current moment / scene?" → state.
- When in doubt, prefer memory. State should stay focused on the live scene.

## Limits

Any individual string value (including nested strings) must be <= {{maxStateStringChars}} characters. Over-long values are rejected and the existing value is left unchanged. Split long descriptions across multiple keyed fields rather than packing one giant string.
