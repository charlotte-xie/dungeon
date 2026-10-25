# Long-Term Memory

Memory is the story's fact file: what is true about its recurring people, places and things. It keeps the story consistent across scenes, and it is what you recall for the narrator.

Each entry is a small JSON object of facets about one entity, keyed by its most natural short name ("Hesta", "Mill Lane"). A facet that can hold more than one thing is a map with one short key per thing, so each can change or go on its own (`Hesta.wants.shop`, `Amy.possessions.money`). Describe in short values, such as `wearing.coat`: "patched army greatcoat". Write facts as complete sentences that make sense on their own, long after the scene, to a reader who has seen none of the story: what someone knows, what happened, a secret, how one person stands with another. An entry holds only what matters to the story, and stays short by holding fewer things.

Memory holds durable facts. The chronicle keeps the full past, the plot plan holds where the story is going, and the current scene (who is present, where everyone stands, the mood of the moment) lives in the story itself. An entity's `history` facet keeps only the few past events that still shape the present.

## Facets

- Any entry: `is` (what it is), `notes`, `history`, `secrets` (a map of what is true but not yet revealed in the story, and who knows).
- Characters: `appearance`, `wearing`, `wants`, `facts`, `knowledge` (what they know that matters to the plot, including about the player's character), `bond` (how they regard the player's character), `relationships`.
- Places: `npcs`, `layout`.
- Things: `significance`, `location`.
- The player's character: `is` (which says they are the player's character), `appearance`, `wearing`, `background`, `skills`, `possessions` (a map, one item per thing they carry), `oaths`, `reputation`. Their intentions and feelings are the player's own, so the entry has no `wants` or `bond`; each NPC's attitude to them lives on that NPC's `bond`.

The player's character always has a name: their entry is keyed by it, and facts name them by it. Use the name the scenario or the player gives; when neither gives one, give them a name that fits the scenario as you set up the records at the opening, and keep it. If the player names them later, the entry moves to that name, and an older entry keyed `player` or `you` moves to the name too.

Use these names, and add a facet while it matters.

## Example

```json
{
  "Hesta": {
    "is": "the town baker, owner of the bakery on Mill Lane",
    "appearance": { "build": "stout", "hair": "grey, tied back" },
    "wearing": { "apron": "flour-dusted apron", "dress": "grey wool dress" },
    "wants": {
      "shop": "keep the bakery open",
      "son": "keep her son out of the constabulary's hands"
    },
    "knowledge": {
      "constable": "Hesta saw Amy argue with a constable.",
      "suspect": "Hesta knows the constable is looking for a stranger to blame for last night's robbery."
    },
    "bond": "Hesta is wary of Amy and helps only when it costs her nothing.",
    "secrets": {
      "tam": "Hesta is hiding her son Tam upstairs after the robbery went wrong; only she and Tam know."
    }
  },
  "Amy": {
    "is": "the player's character, a drifter newly arrived in town",
    "wearing": { "coat": "patched army greatcoat" },
    "possessions": { "money": "30 pounds", "sabre": "chipped sabre" },
    "reputation": "Amy is known on Mill Lane as the stranger who argued with the constable."
  }
}
```

## Keeping it current

Record a person, place or thing once it has entered the story and will recur. When something durable about it changes (a secret comes out, a bond sours, a possession is lost), rewrite that facet as the present truth. When a facet held as one string has come to hold several things, rewrite it as a map. When an entity's real name is learned, rename its entry with `move`. Delete facets that are no longer true and entries that no longer matter, so the file stays lean. When recent story and memory disagree, the story is right: repair the memory.
