# AI Dungeon Master

A browser tabletop RPG narrator: you type an action, an LLM DMs the world’s response.

## Play

**Latest deployment:** [https://charlotte-xie.github.io/dungeon/](https://charlotte-xie.github.io/dungeon/)

Open Settings, enter an API key (and optionally base URL / model), then start playing. Keys stay in your browser (`localStorage`); there is no server of your data.

Pushes to `master` update that site via GitHub Pages.

## Story direction and steering

The plotter keeps the story's arcs: what is ongoing in the story and where each is heading. It sets them up, moves one on a little with each reply, and revises or removes them as the story turns. Narration takes initiative with NPC actions and consequences, compresses routine steps, and lets scenes conclude while leaving the player's decisions open. Brief replies and Continue do not reject the established story; incidental offers can fade away, and explicit redirection takes priority.

Under the latest reply, **Retry** writes it again from the same action, **Rewrite** writes it again following an instruction you type (your action stays the same, and the instruction applies to that reply only), and **Undo** takes the turn back. After an undo, **Redo** restores it. To steer the next reply, add an `(OOC: ...)` note to your action. Standing preferences live in the **Adventure** tab, where you can add, edit, or clear them; they apply from the next turn, belong to the current adventure, and are included in saves. The same tab holds the scenario brief and style guide, and the story arcs, which stay hidden until you reveal them because they give away where the story is heading.

**Developer mode** in Settings adds the State and Context tabs, the trace beside each reply, and the technical settings. It is off by default and remembered in your browser.

## Develop locally

See [AGENTS.md](./AGENTS.md) for setup, scripts, architecture, and contributor notes.
