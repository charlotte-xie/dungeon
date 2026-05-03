# Live State (Current Scene Only)

Live state is your **consistency cache** for the current scene — the structural facts you need to remember so the next turn doesn't contradict the last. It is short-lived and ephemeral; once the scene ends, most of it is overwritten or cleared.

It is **not a transcript** of the scene. Routine motion, single gestures, passing dialogue, and atmospheric detail belong in the prose, not here. State holds only what the next turn needs to look up.

## The necessity test

Before recording anything, ask: *would the next turn produce a consistency error if this fact were missing?* If no, leave it in the prose. State is the smallest set of facts that keeps the scene coherent — not the largest.

## What belongs here

- The current location and immediate surroundings (what room, what time of day, what weather) — when these will still be true next turn.
- The player's current position when it persists (sat down, knelt, took cover) and what they're visibly holding or wearing right now.
- Which NPCs are physically present and the postures or stances the next turn must respect (weapon drawn, hand on the player's arm, blocking the door).
- The active stimulus the scene is built around (an open conversation thread, an unresolved demand, a noise the player just heard).

## What does NOT belong here

- Recurring NPCs' personalities, secrets, or relationships across the story → that's **memory** (`update_memory`).
- Named locations the player may revisit later → memory.
- Plot themes, macguffins, key past events → memory.
- Where the story is going next → **future plot plan** (`future_plot_plan`).
- **Pure narration**: a one-off gesture, a passing remark, an atmospheric detail, a single line of dialogue, a step taken across the room. If the next turn does not need this fact to stay consistent, it stays in the prose.
- **Re-derivable flavor**: the colour of a guard's cloak, the wording of a warning, the tavern's name when it won't recur. These live in narration only.
- **Event log**: state is a mirror of what's true *right now*, not a record of what happened. "Player drew the sword" → set `player.holding: "drawn longsword"`, do not append to a history.

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
