Memory is the continuity notebook: people, places, things and threads. Keep good notes: short descriptions, full sentences, a map for multiple elements. Each note stands on its own, naming who and what it is about. It records persistent facts only; the story itself covers immediate events and the current scene.

```json5
{
  // One entry for each person, place, thing or thread, keyed by a slug, so a path such as mill_lane.layout.bakery reaches any value.
  "hesta": {
    "name": "Hesta",
    "is": "the town baker, owner of the bakery on Mill Lane", // who or what they are, in a phrase
    "personality": "Hesta is brisk and sharp-tongued, mean with praise and generous with bread, and trusts no one in a uniform.", // what they are like
    "appearance": { "build": "stout", "hair": "grey, tied back" },
    "wearing": { "apron": "flour-dusted apron", "dress": "grey wool dress" }, // what they usually wear
    "wants": { // motivation, goals they are working towards
      "shop": "Hesta wants to keep her bakery on Mill Lane open.",
      "son": "Hesta wants to keep her son Tam out of the constable's hands."
    },
    "attitude": "Hesta is wary of Amy and helps Amy only when it costs Hesta nothing.", // how they feel towards others now
    "secrets": { // the plain truth of what they hide, settled now and kept until the story reveals it
      "tam": "Hesta is hiding her son Tam in the room above her bakery after the Mill Lane pawnshop robbery; only Hesta and Tam know."
    },
    "events": ["Hesta told the constable at her bakery door that she had not seen her son Tam."] // what has lately happened to them; only the latest few are kept
  },
  "mill_lane": {
    "name": "Mill Lane",
    "is": "a crooked street of shops above the river",
    "layout": { // the places within a place
      "bakery": "Hesta's bakery stands halfway along Mill Lane, with rooms above it.",
      "lockup": "The constable's lockup stands at the river end of Mill Lane."
    }
  },
  "tams_watch": { // a thing that comes back
    "name": "Tam's watch",
    "is": "a dented silver pocket watch belonging to Tam, stopped at ten past four", // what it is and what sets it apart
    "marks": { "lid": "The inside of the lid of Tam's watch is engraved \"For Tam, from his father\"." }, // the particulars that would be noticed
    "from": "Tam took his watch back from the Mill Lane pawnshop on the night of the robbery.", // how it came to be in the story
    "where": "Tam's watch is under a loose board in the kitchen of Hesta's bakery; only Tam knows.", // where it is now
    "events": ["Amy saw the loose board in the kitchen of Hesta's bakery and told no one."]
  },
  "pawnshop_robbery": { // a thread that runs on through the story
    "is": "last week's botched robbery of the Mill Lane pawnshop",
    "status": "The constable is searching Mill Lane for the pawnshop robber, and the pawnbroker has posted a reward.", // how it stands now
    "truth": "The pawnbroker staged the Mill Lane pawnshop robbery for the insurance, and hired Tam as his lookout." // settled now, kept until the story reveals it
  },
  // The player character, always `player`: what the story has established about them. No interiority: this belongs to the player.
  "player": {
    "name": "Amy", // from the scenario, the player introducing themselves, or someone who knows them
    "is": "a drifter newly arrived in town",
    "wearing": { "coat": "patched army greatcoat", "boots": "stout leather walking boots" },
    "possessions": { "money": "30 pounds", "sabre": "chipped sabre" }, // what they carry that matters
    "reputation": "Amy is known on Mill Lane as a stranger the constable is watching.", // how others see them
    "events": ["Amy took a room above the chandler's shop on Mill Lane."]
  }
}
```
