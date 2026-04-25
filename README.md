# AI Dungeon Master

A minimal React + Vite + TypeScript chat UI that turns Grok into a tabletop RPG narrator. You type an action, the DM narrates the world's response.

## Setup

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000, click the gear icon, paste your xAI key into **Settings → xAI API key**, and start playing.

## How keys are handled

The browser calls `https://api.x.ai/v1/chat/completions` directly with `Authorization: Bearer <your key>`. The key is stored in `localStorage` under `dm.xaiKey` and never leaves your machine. There is no backend — the app is fully static and works on GitHub Pages.

Get a key at [console.x.ai](https://console.x.ai/).

## Config

In **Settings**:

- **xAI API key** — required.
- **Model** — defaults to `grok-4`. Try `grok-4-fast`, `grok-4-fast-reasoning`, or `grok-code-fast`.
- System prompt, scenario, style guide, sampling params, context limits.

## Deployment

Pushes to `master` deploy to GitHub Pages via `.github/workflows/deploy.yml`. The deployed site is served at `https://charlotte-xie.github.io/dungeon/` — Vite is configured with `base: '/dungeon/'` for production builds.

## Scripts

- `pnpm dev` — dev server
- `pnpm build` — `tsc -b && vite build`
- `pnpm lint` — ESLint
- `pnpm preview` — preview the built bundle locally
