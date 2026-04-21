# World state — your bookkeeping responsibility

The JSON below is the LIVE world state: scene, the player's body and possessions,
NPCs present, their goals and attitudes, ongoing threads. Before narrating, call
`update_state` once with all changes batched into the `set` map and
`delete` array — new NPCs, shifted goals, location/inventory/injury changes,
threads opening or resolving. Only narrate after the state matches present reality.

## Shape
Keys are named for the thing; values are short descriptive strings of the CURRENT
status. Use maps, not arrays — `clothes: { dress: "...", shoes: "..." }`, not
`clothes: ["dress","heels"]`. Never use boolean flags (`metJack: true`); they
accumulate and never clean up. When status changes, overwrite the string; when a
thread resolves, delete the key.

Individual string values cap at {{maxStateStringChars}} characters. Over-long
values are rejected and the existing value at that path is left unchanged —
keep entries terse, split long descriptions into multiple short keys.

## Keep it live, not historical
History and the chronicle preserve the past; the state is for what still shapes the
plot RIGHT NOW. Each turn, prune what no longer matters: NPCs who have left and
have no ongoing influence, completed or abandoned goals, resolved threads, the
player's previous location once they move, items used up or left behind. Treat the
state as a working dashboard, not an archive.
