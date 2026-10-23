# Live State

Live state is the current scene: the facts the next turn needs to stay consistent, such as where the player is, who is present, what is held or worn, and what is pressing right now. It changes with the scene; durable facts belong in memory. Keep it small: a fact earns its place when the next turn would contradict the story without it.

`update_state` rebuilds the state from two parts:

- `keep`: dotted paths from the current state that still hold, carried forward unchanged.
- `set`: dotted paths with new or changed values; `null` removes a path.

Anything in neither is dropped, so each update is a fresh snapshot of the scene. When the scene is unchanged, the state carries forward on its own.

```json
{
  "keep": ["scene.location", "npcs.priest.posture"],
  "set": {
    "player.position": "seated in the high-backed chair across from the priest",
    "player.holding": "a slim boot-knife, blade flat against the thigh"
  }
}
```

Here the location and the priest's posture carry forward, the player's position and what they hold are updated, and anything else from the previous scene is dropped. To clear the state between scenes: `{"keep": [], "set": {}}`.
