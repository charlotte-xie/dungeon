Memory is the continuity notebook: people, places, things and threads. Each note is a lasting fact the story has established, worded so it stays true as the story moves on. Keep good notes: short descriptions, full sentences, a map for multiple elements. Each note stands on its own, naming who and what it is about.

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
    "relationships": { // ongoing connections with other people
      "tam": "Hesta is Tam's mother and has raised him alone.",
      "constable": "Hesta and the Mill Lane constable went to school together."
    },
    "secrets": { // the plain truth of what they hide, settled now and kept until the story reveals it
      "tam": "Hesta hid her son Tam in the room above her bakery after the Mill Lane pawnshop robbery; only Hesta and Tam know."
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
    "from": "Tam took his watch back from the Mill Lane pawnshop on the night of the robbery and hid it under a loose board in the kitchen of Hesta's bakery.", // how it came into the story
    "events": ["Amy saw the loose board in the kitchen of Hesta's bakery and told no one."]
  },
  "pawnshop_robbery": { // a thread that runs on through the story
    "is": "last week's botched robbery of the Mill Lane pawnshop",
    "truth": "The pawnbroker staged the Mill Lane pawnshop robbery for the insurance, and hired Tam as his lookout." // settled now, kept until the story reveals it
  },
  // The player character, always `player`: what the story has established about them. No interiority: this belongs to the player.
  "player": {
    "name": "Amy", // from the scenario, the player introducing themselves, or someone who knows them
    "is": "a drifter who served as a cavalry trooper",
    "wearing": { "coat": "patched army greatcoat", "boots": "stout leather walking boots" },
    "possessions": { "sabre": "Amy's chipped cavalry sabre from her army days" }, // the important things they own
    "reputation": "Amy is known on Mill Lane as the stranger who stood up to the constable on her first night.", // how others see them
    "events": ["Amy took a room above the chandler's shop on Mill Lane."]
  }
}
```
