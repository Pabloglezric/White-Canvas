# White Canvas — project state

Last updated: 2026-11-24

## Live

- App: https://white-canvas-three.vercel.app (Vercel project `white-canvas`, team `pabloglezrics-projects`)
- Supabase project: `sypmrdvuimessucfeflo` (White Canvas, eu-west-1)
- Agent server: `https://sypmrdvuimessucfeflo.supabase.co/functions/v1/mcp`
- Repo branch: `claude/pensive-shannon-zym778` (repo was empty, so this became the default and Vercel production branch)

## Decisions

- Own engine (DOM + SVG items inside one transformed world layer, viewport culling), no third-party whiteboard SDK.
- One Postgres row per item (`board_items.data` jsonb, `rev` for last-write-wins). Soft delete.
- Realtime: broadcast channel `ops:<board>` for peer edits, `board:<board>` for presence and cursors (private channels,
  RLS on `realtime.messages`), Postgres changes for writes made by the agent server.
- Offline: IndexedDB cache and outbox per board; device-only boards (`local-…`) need no account.
- Assets in private bucket `board-assets/<board_id>/…`, signed URLs.
- Share links require sign-in; opening one calls `join_board` and adds a membership (no anonymous enumeration).
- Agent access through hashed personal tokens (`api_tokens`), edge function uses the service role.
- Own visual identity; no reference-product branding or assets.

## Verified (automated browser runs)

Desktop editing, touch on 411×960, 960×411 and 859×954 viewports, cloud save and reload, link sharing between two
accounts, live edits and cursors, agent tools writing live to an open board, uploads (image, CSV, IFC), IFC viewer and
picking, PNG/SVG export.

## Not built yet

Lasso select, shape recognition, mind-map auto layout, video chat and recordings, private mode, built-in AI,
per-element IFC visibility, line jumps on connectors, email invitations, anonymous view-only links, native apps.

## Needs the owner

- Supabase → Authentication → URL Configuration: set Site URL to the Vercel URL (email confirmation links).
- Optional: custom SMTP (built-in mailer only reaches project members), leaked-password protection.
- Flex mode on the Fold could not be emulated; needs a check on the device.
