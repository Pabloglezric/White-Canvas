# White Canvas

An infinite online whiteboard: sticky notes, shapes, connectors, freehand markup, frames, comments, tables, cards,
charts, live website embeds, PDF pages and in-board 3D IFC models. Real-time collaboration, works offline, runs on
phones and foldables, and coding agents can read and edit boards through an MCP server.

## Stack

| Layer | Choice |
| --- | --- |
| App | Vite + React 19 + TypeScript, Tailwind v4, Zustand |
| Data | Supabase Postgres (one row per board item), Row Level Security, Storage bucket `board-assets` |
| Realtime | Supabase Realtime: broadcast for live edits and cursors, Postgres changes for agent/API writes |
| Offline | IndexedDB cache + outbox, service worker app shell, device-only boards |
| 3D | `web-ifc` (WASM) + three.js, lazy-loaded |
| Agents | Supabase Edge Function `mcp` (MCP Streamable HTTP, token auth) |
| Hosting | Vercel (static build + SPA rewrites) |

## Run locally

```bash
npm install
```

```bash
cp .env.example .env.local
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (the publishable key), then:

```bash
npm run dev
```

Without those variables the app still runs with device-only boards.

## Test

```bash
npm run test:unit
```

```bash
npm run build && npm run test:e2e
```

End-to-end tests run against the production build with device-only boards, so they need no account.
The audit behind the current hardening is in `docs/AUDIT.md`.

## Layout

- `src/board/` — the canvas engine: `store.ts` (state, undo, remote merge), `validate.ts` (the single gate for
  incoming item data), `interaction.ts` (pointer, touch, wheel, keyboard), `geometry.ts` (connector routing, shapes,
  snapping), `items/` (detailed renderers), `overview.ts` (canvas renderer for crowded views), `sync.ts` (load, save,
  realtime, offline), `importers.ts`, `export.ts`, `ifc/` (viewer and parsing worker), `ui/` (toolbars and panels).
- `src/pages/` — dashboard, sign-in, settings (profile and agent tokens), board page.
- `supabase/migrations/` — schema, RLS policies, storage and realtime policies.
- `supabase/functions/mcp` — agent server. `supabase/functions/unfurl` — link previews and frame-ability check.
- `docs/` — research on the reference product, user complaints and foldable devices.

## Connect a coding agent

Create a token in **Settings → Agent access**, then:

```bash
claude mcp add --transport http white-canvas https://YOUR-PROJECT.supabase.co/functions/v1/mcp --header "Authorization: Bearer wc_YOUR_TOKEN"
```

Tools: `list_boards`, `create_board`, `get_board`, `create_items`, `update_items`, `delete_items`, `create_diagram`,
`add_comment`, `search_board`. Edits show up live on open boards.

## Deploying the edge functions

```bash
supabase functions deploy mcp --no-verify-jwt
```

```bash
supabase functions deploy unfurl
```

Set the `APP_URL` function secret to the deployed site URL so links returned to agents point at it.
