# Long-Term Memory

Memory is the story's fact file: what is true about its recurring people, places and things. It keeps the story consistent across scenes, and it is what you recall for the narrator.

Each entry is a small JSON object of facets about one entity, keyed by its most natural short name ("Hesta", "Mill Lane"). Write each value, and each item of a map, as a single complete present-tense sentence that names its subject and makes sense on its own, long after the scene, to a reader who has seen none of the story. An entry stays short by holding fewer facts.

Memory holds durable facts. The chronicle keeps the full past, the plot plan holds where the story is going, and the current scene (who is present, where everyone stands, the mood of the moment) lives in the story itself. An entity's `history` facet keeps only the few past events that still shape the present.

## Facets

- Any entry: `is` (what it is), `notes`, `history`, `secrets` (a map of what is true but not yet revealed in the story, and who knows).
- Characters: `appearance`, `wearing`, `wants`, `facts`, `knowledge` (what they know that matters to the plot, including about the player's character), `bond` (how they regard the player's character), `relationships`.
- Places: `npcs`, `layout`.
- Things: `significance`, `location`.
- The player's character: `appearance`, `wearing`, `background`, `skills`, `possessions` (a map, one item per thing they carry), `oaths`, `reputation`. Their intentions and feelings are the player's own, so the entry has no `wants` or `bond`; each NPC's attitude to them lives on that NPC's `bond`.

Key the player's character by their name once the scenario or the player gives one, and `you` until then, as the story calls them, and write about them the same way ("Rook is lean and weathered", "You are new in town"). The name is the player's to give. An older entry keyed `player` moves to the new key.

Use these names, and add a facet while it matters. A facet that gathers several facts (`knowledge`, `possessions`, `relationships`, `secrets`) is a map with one short item for each fact, so each can change or go on its own (`Hesta.knowledge.constable`, `Rook.possessions.money`). It holds only points that matter to the plot, not every observation.

## Example

```json
{
  "Hesta": {
    "is": "Hesta is the town baker and owns the bakery on Mill Lane.",
    "appearance": "Hesta is a stout woman with grey hair tied back.",
    "wearing": "Hesta wears a flour-dusted apron over a grey wool dress.",
    "wants": "Hesta wants to keep the shop open and her son out of the constabulary's hands.",
    "knowledge": {
      "constable": "Hesta saw Rook argue with a constable.",
      "newcomer": "Hesta knows Rook is new in town."
    },
    "bond": "Hesta is wary of Rook and helps only when it costs her nothing.",
    "secrets": {
      "tam": "Hesta is hiding her son Tam upstairs after a robbery went wrong; only she and Tam know."
    }
  },
  "Rook": {
    "is": "Rook is a drifter, newly arrived in town.",
    "appearance": "Rook is lean and weathered and walks with a slight limp.",
    "wearing": "Rook wears a patched army greatcoat.",
    "background": "Rook is a veteran of the border wars, drifting since discharge.",
    "possessions": {
      "money": "Rook has 30 pounds.",
      "sabre": "Rook carries a chipped but serviceable sabre."
    }
  }
}
```

## Keeping it current

Record a person, place or thing once it has entered the story and will recur. When something durable about it changes (a secret comes out, a bond sours, a possession is lost), rewrite that facet as the present truth. When an entity's real name is learned, rename its entry with `move`. Delete facets that are no longer true and entries that no longer matter, so the file stays lean. When recent story and memory disagree, the story is right: repair the memory.
