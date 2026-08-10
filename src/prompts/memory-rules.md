# Long-Term Memory

Memory is a **fact file about the story's nouns** — the people, places, and things the narration must stay consistent about across scenes. For your eyes only — never read it aloud or list it for the player. Each entry is a small JSON object of short string **facets** about one entity, keyed by a lowercase underscore slug.

Memory holds **durable facts about entities**. The chronicle records the story's full past automatically; an entity's `history` facet keeps only the few notable events that still shape the present. What will happen belongs to the plot plan; what is true only of the current scene belongs to live state. Update a facet only when something durable *about that entity* is established or changed — the story reveals Hesta keeps a dog called Benny, the smithy has burned down, a secret comes to light.

## Entry shape

Use these facet names — never invent a synonym for an existing facet. Include a facet only while it is relevant or important to the story, and delete it when it stops mattering.

Any entry:

- **`is`** — definition and description in one dense phrase. Every entry has this.
- **`notes`** — miscellaneous info worth keeping that fits no other facet.
- **`history`** — notable past story events involving this entity that still shape the present. Curated highlights, not a log — the chronicle records everything else.
- **`secret`** — what is true but not yet revealed in the narrative, and who knows.

Characters add:

- **`wants`** — specific goals and intentions.
- **`facts`** — important established information, including what they know about the player.
- **`bond`** — current relationship and attitude toward the player.
- **`relationships`** — ties to other characters, by name.

Places add:

- **`npcs`** — regulars and characters connected to the place.
- **`layout`** — physical arrangement and notable features.

Things add:

- **`significance`** — why it matters to the story.
- **`location`** — who holds it or where it sits.

Maximum {{maxFacets}} facets per entry, {{maxFacetChars}} characters per facet.

## Example

```json
{
  "the_baker": {
    "is": "Hesta the baker; stout, flour-dusted apron, grey hair tied back; owns the bakery on Mill Lane",
    "wants": "to be left alone and keep the shop open",
    "facts": "saw the player argue with a constable; knows the player is new in town",
    "bond": "wary of the player; will help only if it costs nothing",
    "relationships": "mother of Tam; pays protection to the smithy brothers",
    "secret": "hiding Tam upstairs after a robbery gone wrong",
    "history": "her husband drowned in the river flood two winters back"
  },
  "mill_lane": {
    "is": "narrow cobbled street on the south side of town, two streets back from the river",
    "layout": "bakery, smithy, and a boarded-up tannery; quiet by day, unpatrolled after dusk",
    "npcs": "Hesta's bakery; the smithy brothers work the forge"
  },
  "courier_ledger": {
    "is": "a slim leather ledger of smuggling accounts",
    "significance": "names half the town's gentry; whoever holds it holds leverage",
    "location": "locked in constabulary custody"
  },
  "player": {
    "is": "veteran of the border wars; carries a chipped sabre and a slight limp",
    "history": "hidden by a woman in Greyford last winter; sworn to repay that debt"
  }
}
```

## What belongs here

- Recurring characters: who they are, what they want, how they regard the player, what they know.
- Revisitable or referenced places, and significant objects.
- Secrets — a facet on the entity that carries them.
- The player's established facts (slug `player`): background, traits or injuries declared in fiction, oaths sworn.

## What does NOT belong here

- **A running log**: `history` keeps only the few notable events that still shape the present — curated, never appended to every scene; the chronicle records everything else. Other facets never carry narrative ("…let Amy sing one number after the first set and approved after she delivered") — keep the standing fact (`bond: "approves of Amy's singing; will give her a number on band nights"`) and reserve events for `history`. Narrative connectives ("after", "then", "last Friday") outside `history` are the warning sign.
- **Temporary state of any kind**: where someone is standing right now, who is present, a mood of the moment, what's held or worn, the weather. That is current-scene data.
- Future intentions, planned beats, plot directions — planning data, not memory.
- Irrelevant details and re-derivable flavor: every door, every meal, a cloak's colour, a tavern's name when it won't recur.

## The durability test

Before setting a facet, ask: *will this still be true and matter after the scene ends?* If it is only true right now, it belongs in live state or the prose. State facts, not chronologies: if any facet other than `history` reads as a narrative of how things came to be, rewrite it to state only what is true now.

## Tool: `update_memory`

Edits are **additive by dotted path — only the paths you name change; nothing else is touched, and omission never deletes.** Paths are `slug` (whole entry) or `slug.facet`. Operations, applied in this order:

1. **`move`** — map of `fromPath` → `toPath`. Rename an entity's slug (`"dark_haired_boy": "daniel"`) once its real name is learned, or relocate a facet. Never duplicate an entity under a new slug — rename it. Moving onto a target that already exists **merges** the entries with mv semantics: the moved facets replace the target's on conflict, and facets only the target had are kept — so move the entry whose facts should prevail (use this to fold a duplicate into the canonical slug).
2. **`delete`** — array of paths. Delete a facet that is no longer true, or a whole entry that is genuinely no longer relevant.
3. **`set`** — map of path → value. `slug.facet` sets one facet string; `slug` with an object replaces the whole entry (use sparingly — facet edits are safer).

```json
{
  "move": { "dark_haired_boy": "daniel" },
  "set": {
    "daniel.is": "Daniel; dark-haired sixth-former, easy charm, well-connected",
    "the_baker.bond": "blames the player for the raid and will not help them again"
  },
  "delete": ["the_baker.secret", "minor_courier_npc"]
}
```

Above: the placeholder slug is renamed now the name is known; two facets are updated in place; a secret that came out is deleted along with an entity that stopped mattering. Every other slug and facet survives untouched.

## When to write, update, delete

- Read before writing about a recurring entity — don't contradict an existing facet without an in-fiction reason.
- **Set** a new entry (with at least `is`) when a person, place, or thing has entered the story and will recur.
- **Set** an existing facet by rewriting that facet's whole value as present-tense truth — never append the story of the change.
- **Move** to rename when an entity's real name is learned; never create a duplicate entry.
- **Delete** facets that stopped being true, and entries that are genuinely no longer relevant.
