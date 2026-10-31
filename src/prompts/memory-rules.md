Memory is the continuity notebook: people, places and things. Keep good notes: short descriptions, full sentences, a map for multiple elements. It records persistent facts only; the story itself covers immediate events.

```json5
{
  // One entry for each person, place or thing, keyed by name.
  "Hesta": {
    "is": "the town baker, owner of the bakery on Mill Lane", // who or what they are, in a phrase
    "appearance": { "build": "stout", "hair": "grey, tied back" },
    "wearing": { "apron": "flour-dusted apron", "dress": "grey wool dress" }, // what they usually wear
    "wants": { // motivation, goals they are working towards
      "shop": "keep the bakery open",
      "son": "keep her son out of the constabulary's hands"
    },
    "attitude": "Hesta is wary of Amy and helps only when it costs her nothing.", // how they feel towards others now
    "secrets": { // the plain truth of what they hide, settled now and kept until the story reveals it
      "tam": "Hesta is hiding her son Tam upstairs after the robbery went wrong; only she and Tam know."
    }
  },
  "Mill Lane": {
    "is": "a crooked street of shops above the river",
    "layout": { // the places within a place
      "bakery": "Hesta's bakery, with rooms above",
      "lockup": "the constabulary lockup at the river end"
    }
  },
  // The player character, always `player`: what the story has established about them. No interiority: this belongs to the player.
  "player": {
    "name": "Amy", // from the scenario, the player introducing themselves, or someone who knows them
    "is": "a drifter newly arrived in town",
    "wearing": { "coat": "patched army greatcoat", "boots": "stout leather walking boots" },
    "possessions": { "money": "30 pounds", "sabre": "chipped sabre" }, // what they carry that matters
    "reputation": "Amy is known on Mill Lane as a stranger the constable is watching." // how others see them
  }
}
```
