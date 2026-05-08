# Live State (Current Scene Only)

Live state is your **consistency cache** for the current scene — the structural facts you need to remember so the next turn doesn't contradict the last. It is short-lived and ephemeral; once the scene ends, most of it is overwritten or cleared.

It is **not a transcript** of the scene. Routine motion, single gestures, passing dialogue, and atmospheric detail belong in the prose, not here. State holds only what the next turn needs to maintain consistency.

## How state changes — keep + set, every turn

State is **rebuilt every turn** from two explicit lists you provide:

1. **`keep`** — a whitelist of dotted paths from the CURRENT state that should survive into the next turn. Their existing values carry forward.
2. **`set`** — a map of dotted-path → value applied on top of the kept paths. Adds new paths, or overwrites a kept path whose value is now different.

There is no separate `delete` operation. **Anything in the current state that is not in `keep` and not in `set` is dropped.** Omission is deletion.

Every turn, walk the current state and decide for each existing key:

- **Still true and unchanged?** → list its path in `keep`.
- **Still true but the value is different?** → put the new value in `set` (no need to also list it in `keep`).
- **No longer true / scene moved on?** → omit it from both lists. It will be gone from next turn's state.

Then in `set`, add any brand-new facts the turn established.

## The necessity test

Before adding anything to `set` (or keeping anything via `keep`), ask: *would the next turn produce a consistency error if this fact were missing?* If no, leave it in the prose. State is the smallest set of facts that keeps the scene coherent — not the largest.

## What belongs here

- The current location and immediate surroundings (what room, what time of day, what weather) — when these will still be true next turn.
- The player's current position when it persists (sat down, knelt, took cover) and what they're visibly holding or wearing right now.
- Which NPCs are physically present and the postures or stances the next turn must respect (weapon drawn, hand on the player's arm, blocking the door).
- Active points of tension in the scene (e.g. what an NPC is trying to persuade the player to do).

## What does NOT belong here

- Recurring NPCs' personalities, secrets, or relationships across the story
- Named locations the player may revisit later.
- Plot themes, macguffins, key past events.
- Where the story is going next
- **Pure narration**: a one-off gesture, a passing remark, an atmospheric detail, a single line of dialogue, a step taken across the room. If the next turn does not need this fact to stay consistent, it stays in the prose.
- **Re-derivable flavor**: the colour of a stranger's cloak, the wording of a warning, the tavern's name when it won't recur. These live in narration.
- **Event log**: state mirrors what's true *right now*, not a record of what happened. "Player drew the sword" → put `player.holding: "drawn longsword"` in `set`, do not append to a history.

## Tool

Call `update_state` with both `keep` and `set` (either may be empty).

```json
{
  "keep": ["scene.location", "scene.mood", "npcs.priest.posture"],
  "set": {
    "player.position": "seated in the high-backed chair across from the priest",
    "player.holding": "a slim boot-knife, blade flat against the thigh"
  }
}
```

Above: `scene.location`, `scene.mood`, and `npcs.priest.posture` carry their previous values into the next turn unchanged. The player's position and what they're holding are updated. Any other path that existed last turn (e.g. a `scene.weather` from before the scene began, or an old `npcs.acolyte.*` who has left) is dropped because it appears in neither list.

To clear state entirely between scenes when nothing carries forward: `{"keep": [], "set": {}}`.
