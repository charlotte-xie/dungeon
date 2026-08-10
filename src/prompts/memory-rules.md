# Long-Term Memory

Memory is a **fact file about the story's nouns** — the people, places, and things the narration must stay consistent about across scenes. For your eyes only — never read it aloud or list it for the player. Each entry is a small JSON object of **facets** about one entity, keyed by whatever short name is most natural ("Hesta", "Dan", "Mill Lane" — avoid periods, which are path separators).

Every value must make sense **read on its own, long after this scene** — complete standalone sentences, not telegraphic fragments. A facet is short by holding fewer facts, not by stripping grammar: "wary; helps if cheap; son upstairs" decays into noise, while "She is wary of the player and will help only if it costs her nothing" stays readable forever.

Memory holds **durable facts about entities**. The chronicle records the story's full past automatically; an entity's `history` facet keeps only the few notable events that still shape the present. What will happen belongs to the plot plan; what is true only of the current scene belongs to live state. Update a facet only when something durable *about that entity* is established or changed — the story reveals Hesta keeps a dog called Benny, the smithy has burned down, a secret comes to light.

## Entry shape

Prefer these facet names — avoid inventing a synonym for an existing facet. Include a facet only while it is relevant or important to the story, and delete it when it stops mattering.

Shape beyond the suggested facets is your discretion: values are one or two complete sentences; itemize into a map when content is naturally keyed (`player.possessions.money`, `mark.relationships.phil`); nest deeper only when it genuinely helps. Keep the file tight by deleting what stopped mattering — never by clipping sentences into fragments.

Any entry:

- **`is`** — definition and description in one dense phrase. Every entry has this.
- **`notes`** — miscellaneous info worth keeping that fits no other facet.
- **`history`** — notable past story events involving this entity that still shape the present. Curated highlights, not a log — the chronicle records everything else.
- **`secret`** — what is true but not yet revealed in the narrative, and who knows.

Characters add:

- **`wants`** — specific goals and intentions.
- **`facts`** — important established facts about them.
- **`knowledge`** — what they know: things they have witnessed or been told, including about the player.
- **`bond`** — current relationship and attitude toward the player.
- **`relationships`** — ties to other characters; itemize by character name when there are several.

Places add:

- **`npcs`** — regulars and characters connected to the place; itemize by character name when there are several.
- **`layout`** — physical arrangement and notable features.

Things add:

- **`significance`** — why it matters to the story.
- **`location`** — who holds it or where it sits.

The player (key `player`) adds these instead of the character facets — never `wants`, `bond`, or `relationships`: the player's intent belongs to the player, and NPCs' attitudes live on their own `bond` facets:

- **`background`** — pre-story origin and circumstances established in fiction.
- **`skills`** — competencies and talents demonstrated or declared.
- **`possessions`** — durable belongings and resources, as an itemized map of item → short description (`"money": "30 pounds"`). What is carried or worn right now is live state. (Other characters may carry a `possessions` facet too.)
- **`oaths`** — standing commitments: promises, debts, and deals made in fiction.
- **`reputation`** — how the player is generally known and regarded.

## Example

```json
{
  "Hesta": {
    "is": "Hesta is the town baker, a stout woman with a flour-dusted apron and grey hair tied back; she owns the bakery on Mill Lane.",
    "wants": "She wants to be left alone and to keep the shop open.",
    "knowledge": "She saw the player argue with a constable, and knows the player is new in town.",
    "bond": "She is wary of the player and will help only if it costs her nothing.",
    "relationships": "She is Tam's mother, and pays protection money to the smithy brothers.",
    "secret": "She is hiding Tam upstairs after a robbery gone wrong; only she and Tam know.",
    "history": "Her husband drowned in the river flood two winters back."
  },
  "Mill Lane": {
    "is": "Mill Lane is a narrow cobbled street on the south side of town, two streets back from the river.",
    "layout": "It holds the bakery, a smithy, and a boarded-up tannery; it is quiet by day and unpatrolled after dusk.",
    "npcs": "Hesta runs the bakery, and the smithy brothers work the forge."
  },
  "courier_ledger": {
    "is": "A slim leather ledger recording smuggling accounts.",
    "significance": "It names half the town's gentry — whoever holds it holds leverage over them.",
    "location": "It is locked in constabulary custody."
  },
  "player": {
    "is": "The player is lean and weathered and walks with a slight limp.",
    "background": "A veteran of the border wars, drifting since discharge.",
    "skills": "Skilled with a sword and at reading people; can sleep anywhere.",
    "possessions": {
      "money": "30 pounds",
      "sabre": "A chipped but serviceable sabre.",
      "lodging": "A rented room above the tannery, paid up to the month's end."
    },
    "oaths": "Sworn to repay the woman who hid them in Greyford last winter.",
    "reputation": "Known on the road as quiet trouble best left alone."
  }
}
```

## What belongs here

- Recurring characters: who they are, what they want, how they regard the player, what they know.
- Revisitable or referenced places, and significant objects.
- Secrets — a facet on the entity that carries them.
- The player's established facts (key `player`): background, traits or injuries declared in fiction, oaths sworn.

## What does NOT belong here

- **A running log**: `history` keeps only the few notable events that still shape the present — curated, never appended to every scene; the chronicle records everything else. Other facets never carry narrative ("…let Amy sing one number after the first set and approved after she delivered") — keep the standing fact (`bond: "approves of Amy's singing; will give her a number on band nights"`) and reserve events for `history`. Narrative connectives ("after", "then", "last Friday") outside `history` are the warning sign.
- **Temporary state of any kind**: where someone is standing right now, who is present, a mood of the moment, what's held or worn, the weather. That is current-scene data.
- Future intentions, planned beats, plot directions — planning data, not memory.
- Irrelevant details and re-derivable flavor: every door, every meal, a cloak's colour, a tavern's name when it won't recur.

## The durability test

Before setting a facet, ask: *will this still be true and matter after the scene ends?* If it is only true right now, it belongs in live state or the prose. State facts, not chronologies: if any facet other than `history` reads as a narrative of how things came to be, rewrite it to state only what is true now.

## Tool: `update_memory`

Edits are **additive by dotted path — only the paths you name change; nothing else is touched, and omission never deletes.** Paths are `name` (whole entry) or `name.facet`. Operations, applied in this order:

1. **`move`** — map of `fromPath` → `toPath`. Rename an entity (`"dark_haired_boy": "Dan"`) once its real name is learned, or relocate a facet. Never duplicate an entity under a new name — rename it. Moving onto a target that already exists **merges** the entries with mv semantics: the moved facets replace the target's on conflict, and facets only the target had are kept — so move the entry whose facts should prevail (use this to fold a duplicate into the canonical entry).
2. **`delete`** — array of paths. Delete a facet that is no longer true, or a whole entry that is genuinely no longer relevant.
3. **`set`** — map of path → value. `name.facet` sets one facet; `name` with an object replaces the whole entry (use sparingly — facet edits are safer).

```json
{
  "move": { "dark_haired_boy": "Dan" },
  "set": {
    "Dan.is": "Dan; dark-haired sixth-former, easy charm, well-connected",
    "Hesta.bond": "blames the player for the raid and will not help them again"
  },
  "delete": ["Hesta.secret", "minor_courier_npc"]
}
```

Above: the placeholder is renamed now the name is known; two facets are updated in place; a secret that came out is deleted along with an entity that stopped mattering. Every other entry and facet survives untouched.

## When to write, update, delete

- Read before writing about a recurring entity — don't contradict an existing facet without an in-fiction reason.
- **Set** a new entry (with at least `is`) when a person, place, or thing has entered the story and will recur.
- **Set** an existing facet by rewriting that facet's whole value as present-tense truth — never append the story of the change.
- **Move** to rename when an entity's real name is learned; never create a duplicate entry.
- **Delete** facets that stopped being true, and entries that are genuinely no longer relevant.
