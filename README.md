# AI Dungeon Master

A browser tabletop RPG narrator: you type an action, an LLM DMs the world’s response.

## Play

**Latest deployment:** [https://charlotte-xie.github.io/dungeon/](https://charlotte-xie.github.io/dungeon/)

Open Settings, enter an API key (and optionally base URL / model), then start playing. Keys stay in your browser (`localStorage`); there is no server of your data.

Pushes to `master` update that site via GitHub Pages.

## Story direction and steering

The plotter maintains six labelled entries in the existing private plot notebook: **Promise, Question, Stakes, Intentions, Next, and Payoff**. This is a prompt-guided structure using the existing tool and save format, with no extra model call. Existing hook lists are reorganised by the plotter on subsequent turns. Narration takes initiative with NPC actions and consequences, compresses routine steps, and lets scenes conclude while leaving the player's decisions open. Brief replies and Continue do not reject the established story; incidental offers can fade away, and explicit redirection takes priority.

During an adventure, **Steer story** lets you give **Next reply only** guidance or save an **Until I change it** preference. Temporary guidance is added to your action box: press **Act** when ready. Standing preferences are saved immediately when you click Save and apply on the next turn, without a model call. You can edit or clear them in the same panel without revealing private plot plans. Standing guidance requires **Include OOC instructions** in Settings; it belongs to the current adventure and is included in saves. Ordinary `(OOC: ...)` directions still work.

## Develop locally

See [AGENTS.md](./AGENTS.md) for setup, scripts, architecture, and contributor notes.
