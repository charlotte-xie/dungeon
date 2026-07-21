# AI Dungeon Master

A minimal React + Vite + TypeScript chat UI that turns an LLM into a tabletop RPG narrator. You type an action, the DM narrates the world's response.

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

## Config

In **Settings**:

- **API key** — required by hosted providers; local servers may accept a placeholder.
- **Base URL** — an OpenAI-compatible API root such as `https://api.x.ai/v1`, `https://api.openai.com/v1`, or your local server.
- **Model** — defaults to `grok-4`; choose a model exposed by the configured endpoint.
- System prompt, scenario, style guide, sampling params, context limits.

Provider transport and response repair are isolated under `src/engine/model`. Game orchestration consumes provider-neutral messages and tool calls. The normalizer handles native tool calls as well as common malformed text forms, while refusing calls for tools that were not advertised in the request.

## Deployment

Pushes to `master` deploy to GitHub Pages via `.github/workflows/deploy.yml`. The deployed site is served at `https://charlotte-xie.github.io/dungeon/` — Vite is configured with `base: '/dungeon/'` for production builds.

## Scripts

- `pnpm dev` — dev server
- `pnpm test` — internal Vitest unit tests
- `pnpm build` — `tsc -b && vite build`
- `pnpm lint` — ESLint
- `pnpm preview` — preview the built bundle locally
