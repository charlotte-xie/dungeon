# AI Dungeon Master — agent / contributor notes

A minimal React + Vite + TypeScript chat UI that turns an LLM into a tabletop RPG narrator. You type an action, the DM narrates the world's response.

Players use the [GitHub Pages deployment](https://charlotte-xie.github.io/dungeon/). This file is for local development and agent context.

## Setup

```bash
pnpm install
pnpm dev
```

Open http://localhost:3003, open **Settings**, then enter a model, API key, and base URL.

## How keys are handled

The browser calls the configured OpenAI-compatible Chat Completions endpoint directly. The default is `https://api.x.ai/v1`, but the base URL can point at OpenAI or a local server that implements `/chat/completions` and `/models`. The key is stored in `localStorage` under `dm.xaiKey`; there is no backend.

Because requests originate in the browser, a local or hosted endpoint must allow browser CORS requests. Never use a valuable unrestricted API key on a public/shared browser profile.

Get a key at [console.x.ai](https://console.x.ai/).

## Settings reference

In **Settings**:

- **API key** — required by hosted providers; local servers may accept a placeholder.
- **Base URL** — an OpenAI-compatible API root such as `https://api.x.ai/v1`, `https://api.openai.com/v1`, or your local server.
- **Narrator model / reasoning** — defaults to `grok-4.7` with low reasoning.
- **Plotter model / reasoning** — defaults to `grok-4.3` with low reasoning.
- **Summariser model / reasoning** — defaults to `grok-4.3` with reasoning off.
- Leave a plotter or summariser model blank to use the narrator model. Reasoning remains independently configurable. Choose **Provider default** to omit the reasoning parameter for other providers.
- The **Use Grok 4.7 narrator + 4.3 plotting** button applies these choices, selects Responses, and disables the reviser. Click **Save** to apply it. Existing browser settings retain their previous routing until you change them; the preset preserves your adventure and API key.
- System prompt, scenario, style guide, sampling params, context limits.

New settings default to the Responses API. Grok 4.7 supports low, medium, high, and extra-high reasoning, but cannot turn reasoning off. Model IDs and effort levels are editable for each role; select levels supported by your endpoint. The plotter currently receives the same conversation context as the narrator, so selecting the same model lets you compare shared-prefix caching against a separate plotting model.

Provider transport and response repair are isolated under `src/engine/model`. Game orchestration consumes provider-neutral messages and tool calls. The normaliser handles native tool calls as well as common malformed text forms, while refusing calls for tools that were not advertised in the request.

## Context efficiency

Request assembly in `src/engine/request.ts` is laid out for prefix-cache hits: stable system/adventure material first, then append-only turn history, then per-turn reminder and context injection. Prefer changes that keep the stable prefix byte-stable and avoid rewriting earlier messages. Trace usage events surface prompt vs cached token counts so cache behavior is visible in the UI.

## Deployment

Pushes to `master` deploy to GitHub Pages via `.github/workflows/deploy.yml`. The live site is [https://charlotte-xie.github.io/dungeon/](https://charlotte-xie.github.io/dungeon/) — Vite is configured with `base: '/dungeon/'` for production builds.

## Scripts

- `pnpm dev` — dev server
- `pnpm test` — internal Vitest unit tests
- `pnpm build` — `tsc -b && vite build`
- `pnpm lint` — ESLint
- `pnpm preview` — preview the built bundle locally
