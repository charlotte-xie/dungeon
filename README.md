# AI Dungeon Master

A minimal React + Vite + TypeScript chat UI that turns Grok into a tabletop RPG narrator. You type an action, the DM narrates the world's response.

## Setup

```bash
pnpm install
cp .env.local.example .env.local
# edit .env.local and paste your xAI key
pnpm dev
```

Open http://localhost:3000.

## How the key stays secret

The xAI key is loaded by `vite.config.ts` with `loadEnv` (no `VITE_` prefix, so it is never bundled into the browser). The dev server proxies `/api/xai/*` to `https://api.x.ai/v1/*` and injects the `Authorization` header server-side. The browser only ever talks to its own origin.

## Config

`.env.local` variables:

| Var            | Default                     | Notes                                     |
| -------------- | --------------------------- | ----------------------------------------- |
| `XAI_API_KEY`  | _(required)_                | Your xAI key.                             |
| `XAI_MODEL`    | `grok-4`                    | Injected at build via `define`.           |
| `XAI_BASE_URL` | `https://api.x.ai/v1`       | Swap for a compatible endpoint if needed. |

## Status

**Dev-only.** `vite build` produces static assets with no backend — the `/api/xai` proxy only exists under `vite dev`. Shipping to production requires a serverless function (Vercel / Cloudflare Workers / etc.) that forwards to xAI with the key attached.

## Scripts

- `pnpm dev` — dev server with API proxy
- `pnpm build` — `tsc -b && vite build`
- `pnpm lint` — ESLint
- `pnpm preview` — preview the built bundle (API calls will 404; dev-only caveat above)
