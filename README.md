# AI Dungeon Master

A browser tabletop RPG narrator: you type an action, an LLM DMs the world’s response.

## Play

**Latest deployment:** [https://charlotte-xie.github.io/dungeon/](https://charlotte-xie.github.io/dungeon/)

Open Settings, enter an API key (and optionally base URL / model), then start playing. Keys stay in your browser (`localStorage`); there is no server of your data.

Pushes to `master` update that site via GitHub Pages.

## Story direction and steering

The plotter maintains six labelled entries in the existing private plot notebook: **Promise, Question, Stakes, Intentions, Next, and Payoff**. This is a prompt-guided structure using the existing tool and save format, with no extra model call. Existing hook lists are reorganised by the plotter on subsequent turns. Narration takes initiative with NPC actions and consequences, compresses routine steps, and lets scenes conclude while leaving the player's decisions open. Brief replies and Continue do not reject the established story; incidental offers can fade away, and explicit redirection takes priority.

Under the latest reply, **Retry** writes it again from the same action, **Rewrite** writes it again following an instruction you type (your action stays the same, and the instruction applies to that reply only), and **Undo** takes the turn back. After an undo, **Redo** restores it. To steer the next reply, add an `(OOC: ...)` note to your action. Standing preferences live in **Inspect › OOC**, where you can add, edit, or clear them without revealing private plot plans; they apply from the next turn, belong to the current adventure, and are included in saves. They require **Include OOC instructions** in Settings.

## Develop locally

See [AGENTS.md](./AGENTS.md) for setup, scripts, architecture, and contributor notes.
