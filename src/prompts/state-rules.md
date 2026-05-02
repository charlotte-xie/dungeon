# Live State (Current Scene Only)

Live state is the **current scene** — what is true *right now*, in this moment, in this location. It is short-lived and ephemeral. It exists so you stay consistent across one scene; once the scene ends, most of it is overwritten or cleared.

## What belongs here

- The current location and immediate surroundings (what room, what time of day, what weather).
- The player's current position, posture, what they're wearing/holding right now.
- Which NPCs are physically present in the scene and what they're doing this moment.
- The active stimulus the scene is built around (an open conversation thread, an unresolved demand, a noise the player just heard).

## What does NOT belong here

- Recurring NPCs' personalities, secrets, or relationships across the story → that's **memory** (`update_memory`).
- Named locations the player may revisit later → memory.
- Plot themes, macguffins, key past events → memory.
- Where the story is going next → **future plot plan** (`future_plot_plan`).

If you find yourself writing to state about something that will still matter three scenes from now, write it to memory instead.

## Tool

Call `update_state` with changes batched. Provide `set` (dotted-path → value) and/or `delete` (array of paths). On scene change, aggressively `delete` keys from the previous scene that no longer apply.

```json
{
  "set": {
    "scene.location": "the priest's study, candle-lit, after midnight",
    "scene.mood": "tense; an open ledger sits on the desk between you",
    "player.position": "leaning against the cold stone fireplace",
    "player.holding": "the iron seal you lifted from the altar"
  },
  "delete": ["scene.weather", "npcs_present.acolyte"]
}
```

## Limits

Any individual string value (including nested strings) must be <= {{maxStateStringChars}} characters. Over-long values are rejected. Split long descriptions across multiple short keyed fields, each a complete English phrase.
