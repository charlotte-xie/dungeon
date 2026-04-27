# Game state

Update the JSON below with the LIVE world state: scene, the player's body and possessions,
NPCs present, their goals and attitudes, ongoing threads. Before narrating, call
`update_state` once with all changes batched into the `set` map and
`delete` array — new NPCs, shifted goals, location/inventory/injury changes,
threads opening or resolving. Only narrate after the state matches present reality.

## Shape
Keys are names for the slot; values are short descriptive strings of the CURRENT
status. Prefer maps over arrays — `clothes: { dress: "...", shoes: "..." }`, not
`clothes: ["dress","heels"]`. Avoid boolean flags (`metJack: true`) unless you expect to toggle them. When status changes, overwrite the string; when a
thread resolves, delete the key.

Individual string values cap at {{maxStateStringChars}} characters. Over-long
values are rejected and the existing value at that path is left unchanged. Split long descriptions into multiple keys if needed.

## Value style — complete English phrases, never telegraphic
Each string value is a complete English phrase or short clause with all
articles, prepositions, and verbs in place. NOT a single keyword, NOT a
label-shorthand, NOT a fragment with dropped function words.

RIGHT: `"standing at the edge of the dock"`, `"wary of the player and unwilling to speak openly"`, `"a heavy iron seal in his coat pocket"`.
WRONG: `"dock. edge."`, `"wary, silent"`, `"iron seal: pocket"`, `"defensive"`.

Compactness comes from picking the right level of detail and splitting long
facts across multiple keys, never from dropping grammar.

## Keep it live, not historical
History and the chronicle preserve the past; the state is for what affects the
plot RIGHT NOW. Each turn, prune what no longer matters. Treat the
state as a working dashboard, not an archive.
