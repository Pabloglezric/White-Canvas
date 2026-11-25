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
- Updates: every build stamps a unique id into `index.html` (`meta[name=wc-build]`) and into the service worker
  (`buildStamp` in `vite.config.ts`). The changed worker file is the only way an installed app notices a deploy, so it must
  never be identical between builds. An open app is offered the new build and reloads by itself once it is in the
  background (`src/main.tsx`); tests in `tests/e2e/update.spec.ts`. Only the production branch reaches installed apps;
  every other branch gets a preview URL.
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
- Cursors: every cursor packet states where the pointer is now (`bus.pointer()`, asked for at send time) or that it is
  off the board (`off`). Never send "no news" for a pointer: a missed packet would strand a cursor on other screens.
  A finger counts as a pointer only while it is down. A device that leaves presence is dropped at once.
- Board previews are real pictures (`boardPreview` in `src/board/export.ts`: the image-export renderer, 640×400 WebP,
  under the 262,144-character database limit). Plain-box SVGs are only the no-canvas fallback; `isOldPreview` marks
  those for redrawing (on opening the board, and from the dashboard). A preview is drawn when leaving a board with
  unpictured edits, not only on the timer.
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
Merged into the production branch on 2026-11-25 (pull requests 1, 3 and 5, with 2 for app updates). Pull request 4, merged
earlier the same day, covered a subset (one avatar per person, list refresh on focus); the fuller versions replaced it.

Duplicated cloud boards get their own files (`adoptAssets` in `src/lib/boards.ts`, `copyAsset` in `src/board/assets.ts`):
anything that puts items into a cloud board from elsewhere should go through `adoptAssets`. Branch `claude/loving-bohr-s5ikwd`,
built on top of the sync fixes.

## Bluebeam research (2026-11-25)

Research only, nothing built. Report: `reports/Bluebeam capabilities for White Canvas.md`; sourced notes in
`research_notes/Bluebeam capabilities for White Canvas/`.

- Direction recommended: build drawing review natively, exchange data with Bluebeam through standard PDF annotations.
- Three foundations gate the rest: a retained vector PDF sheet, per-sheet scale with point-list geometry, cross-type item metadata.
- Open decision for the owner: the Bluebeam Developer Terms restrict building similar features, so API sign-up is not a default.
- Untested: whether Revu honours a `/Measure` dictionary written by another tool. Needs a hands-on test in a licensed copy.

## Project board and direction (2026-11-25)

- Owner decision: no reliance on Bluebeam. Build our own drawing review, read and write standard PDF files, never sign up
  for their developer programme. The aim is to beat it by learning from its mistakes, not to copy it.
- The project is tracked on a White Canvas board, not in documents: decisions due, questions both ways, tools with estimates,
  lessons, the app's own screens ("inception window") and a code map. The owner comments on the board.
- `scripts/project-board.mjs` builds the board as a `.whitecanvas.json` file (drop it on any board). The plan lives in that
  script until a live board exists. Options: `--graph <graph.json>` adds the code map, `--shots <dir>` adds screenshots.
- Going live needs an agent token for Claude: a network secret on the `white-canvas` cloud environment for the agent server host.
  Until then the board is rebuilt and sent as a file.
- Graphify (`graphifyy` on PyPI, Apache-2.0) maps the code locally in about 4 seconds with no AI cost: `graphify update .`
  Used to draw the code map, to trace what a change touches, and to save reading whole files. The graph is rebuilt per
  session, not stored in the repository. No hooks or assistant integration are installed yet (owner decision pending).
- Cards show their whole description (the three-line cut was removed in `src/index.css`). A card's date field is a real date;
  estimates go in tags until cards get an estimate field.
- The app refuses to be framed, itself included (`frame-ancestors 'none'` in `vercel.json`), so the inception window uses screenshots.

## Tests

- `npm run test:unit` — 75 tests (geometry, store, validation, sync, previews).
- `npm run test:e2e` — 31 tests on the production build: device-only boards on desktop and two Fold touch sizes, app
  updates, and "live" tests with two signed-in devices on one board. The live tests run against a second build
  (`dist-live`) pointed at a stand-in backend, `tests/e2e/backend.ts` (REST answers plus a realtime hub with presence
  and broadcast). Use it for anything that only shows with an account or a second device.
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
