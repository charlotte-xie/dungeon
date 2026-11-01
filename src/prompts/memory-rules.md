Memory is the continuity notebook: people, places, things and threads. Keep good notes: short descriptions, full sentences, a map for multiple elements. It records persistent facts only; the story itself covers immediate events and the current scene.

```json5
{
  // One entry for each person, place, thing or thread, keyed by a slug, so a path such as mill_lane.layout.bakery reaches any value.
  "hesta": {
    "name": "Hesta",
    "is": "the town baker, owner of the bakery on Mill Lane", // who or what they are, in a phrase
    "personality": "brisk and dry; answers a question with a question, counts change twice, and goes soft only over bread", // what they are like: their habits and the way they talk
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
  "mill_lane": {
    "name": "Mill Lane",
    "is": "a crooked street of shops above the river",
    "layout": { // the places within a place
      "bakery": "Hesta's bakery, with rooms above",
      "lockup": "the constabulary lockup at the river end"
    }
  },
  "pawnshop_robbery": { // a thread that runs on through the story
    "is": "last week's botched robbery of the Mill Lane pawnshop",
    "status": "The constable is searching the street, and the pawnbroker has posted a reward.", // how it stands now
    "truth": "The pawnbroker staged it for the insurance; Tam was his hired lookout." // settled now, kept until the story reveals it
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
