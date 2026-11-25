# White Canvas — project state

Last updated: 2026-11-25

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
- A cloud board only points at files in its own folder. Items that arrive with files from elsewhere (paste from
  another board, board JSON import) appear at once and are repointed when the copies land (`adoptForeignFiles` in
  `src/board/ops.ts`, also run when an editor opens the board and on reconnect). A failed copy keeps the old reference.
- Share links require sign-in; opening one calls `join_board` and adds a membership (no anonymous enumeration).
- Agent access through hashed personal tokens (`api_tokens`), edge function uses the service role.
- Own visual identity; no reference-product branding or assets.
- Device-only boards never upload on their own. A signed-in dashboard offers to move them into the account
  (`moveToAccount` in `src/lib/boards.ts`); nothing moves without that click, because a device can be shared.
- Presence is per device (client id); anything shown per person goes through `people()` in `src/board/store.ts`.
- An open cloud board catches up from the server (`catchUp` in `src/board/sync.ts`: rows changed since the newest one
  seen, deleted included) on going live, reconnect, coming back into view and coming back online.
- A frame's preset is a field (`preset`), shown as a tag only while the proportions match (`framePreset`). Titles never carry it.
- Anything inside the board that handles its own wheel must take the event in the capture phase with a native listener;
  a React handler runs after the board has already zoomed.

## Audit (2026-11-24)

Full pre-launch audit and fix pass: see `docs/AUDIT.md` for findings, measurements and what is still open.

- Incoming item data always goes through `src/board/validate.ts` (`normalizeItem`). Never render or export unvalidated data.
- Crowded views (more than 600 visible items) are painted by `src/board/overview.ts` on one canvas; fewer than 460 hands back to DOM.
- The server decides item revisions (`board_items_touch` trigger); clients adopt them.
- Comment integrity, size limits, item cap and rate limits are enforced in the database (`0002`, `0003` migrations).
- Embeds from unknown sites load on click; pasted HTML never runs scripts.
- Hosting sends a strict Content-Security-Policy (`vercel.json`). New third-party scripts need a deliberate policy change.

## Sync follow-up (2026-11-25)

Missing boards across devices, doubled initials, IFC scroll zoom and stale ratio tags: causes, fixes and what is still
open are in `docs/AUDIT.md` (last section). Migration `0004_catch_up_index.sql` is applied to the live database.
The fixes are on branch `claude/laughing-albattani-kmvv1g`; production updates when that is merged into the production branch.

Duplicated cloud boards get their own files (`adoptAssets` in `src/lib/boards.ts`, `copyAsset` in `src/board/assets.ts`):
anything that puts items into a cloud board from elsewhere should go through `adoptAssets`. Branch `claude/loving-bohr-s5ikwd`,
built on top of the sync fixes.

## Tests

- `npm run test:unit` — 72 tests (geometry, store, validation, sync).
- `npm run test:e2e` — 21 tests on the production build, device-only boards, desktop and two Fold touch sizes.
- CI: `.github/workflows/ci.yml` runs type-check, unit tests, build and end-to-end tests on every push.
- Profiling handle: set `localStorage["wc.debug"] = "1"` to expose `window.__wc`.

## Not built yet

Lasso select, shape recognition, mind-map auto layout, video chat and recordings, private mode, built-in AI,
per-element IFC visibility, line jumps on connectors, email invitations, anonymous view-only links, native apps,
per-board agent tokens.

## Needs the owner

- Supabase → Authentication → URL Configuration: set Site URL to the Vercel URL (email confirmation links).
- Supabase → Authentication: leaked-password protection, secure password change, minimum length 8.
- Custom SMTP (built-in mailer only reaches project members). Paid Supabase plan before relying on it (free projects pause).
- Real-device checks: Fold 8 including Flex Mode, iOS Safari, on-screen keyboard.
- After the sync fixes are live: on each device, press "Move them to my account" on the dashboard once, then confirm both devices list the same boards.
