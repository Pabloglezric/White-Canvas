# White Canvas — pre-launch audit

Date: 2026-11-24. Scope: the whole product (client, database, server functions, hosting).

## How it was audited

| Track | Method |
| --- | --- |
| Security | Independent code review against four attackers: a malicious collaborator, an anonymous attacker, a hostile embed or file, a leaked agent token. Server-side claims were then verified against the live database. |
| Graphics and architecture | Independent review of every per-frame code path, plus a benchmark on the production build (boards of 1,000 / 5,000 / 10,000 items). |
| Functional QA | Hands-on testing of every tool on desktop and at the three Fold-sized touch viewports, including 300 random rapid actions and undo/redo consistency checks. |
| Platform | Lighthouse (mobile and desktop) on the live site, database query plans, Supabase advisors. |

Totals: 20 security findings, 28 graphics/architecture findings, 25 functional bugs, 15 polish issues, 10 accessibility issues.

## Measured results

Benchmark on the production build, headless Chromium, software rendering. Frame time is the interval between animation frames; 16.7 ms is 60 fps.

| Scenario | Before | After |
| --- | --- | --- |
| Show a whole 5,000-item board | 16,396 ms | 36 ms |
| Show a whole 10,000-item board | 57,272 ms | 44 ms |
| Zoom with 5,000 items on screen (median frame) | 109.3 ms | 16.7 ms |
| Zoom with 10,000 items on screen (median / worst frame) | 209.7 / 1,810 ms | 17.4 / 27.3 ms |
| Pan with 10,000 items on screen (median frame) | 79.3 ms | 19.4 ms |
| Zoom with 1,000 items on screen (median frame) | 24.1 ms | 16.7 ms |
| Pan / drag at 100% zoom, 10,000-item board (95th percentile) | 18.0 / 17.2 ms | 17.5 / 16.9 ms |

Lighthouse on the live site (mobile / desktop profile):

| Category | Before | After |
| --- | --- | --- |
| Performance | 100 / 100 | 99 / 100 |
| Accessibility | 80 / 80 | 100 / 100 |
| Best practices | 100 / 100 | 100 / 100 |
| SEO | 91 / 91 | 100 / 100 |

First contentful paint is 0.8 s on the mobile profile and 0.2 s on desktop; the initial transfer is about 228 KB.

Database: a 1,000-row page of one board through row-level security takes about 21 ms. The page query previously scanned the primary key of the whole table (cost grows with every board in the system); it now uses an index scoped to the board.

Automated tests added: 56 unit tests and 19 end-to-end tests, run in CI on every push.

Verified against the live backend after the fixes, with two temporary accounts (since removed): live sync in both directions, in-progress text reaching the server before editing ends, a commenter refused on every edit and comment-rewrite attempt, access removal closing an open board and wiping its local copy, profile privacy, sign-out purging local data, the link-preview function refusing nine internal-address variants and the public key, expired agent tokens refused, and both rate limits (exactly 120 and 30 requests allowed per minute).

## Launch blockers found and fixed

| # | Finding | Fix |
| --- | --- | --- |
| S1 | Stored XSS: board previews were injected as markup on every member's dashboard. An owner could also add any account to a board, so this could spread. | Previews render as images. Membership can only be created by opening a share link. |
| S2–S4 | Item fields (colours, text) reached generated SVG and a same-origin print window unescaped; text extraction executed image error handlers. | All incoming item data passes one validation layer; output is escaped; text is extracted in an inert document; the print view has no script. |
| S6 / G1 | One malformed row blanked the board for every member, permanently. A commenter could do it. | Validation at every entry point, a database shape check, and an error boundary around each item and each page. |
| G2 | Zoomed-out large boards froze for seconds, then ran at 5–10 fps. | Crowded views are painted on one canvas with exact stacking order and geometric hit-testing; the detailed renderer takes over as you zoom in. |
| Q1 | Right-click never opened the item menu. | Fixed (pointer capture no longer steals the event). |
| Q2 | Locked items could not be unlocked by any advertised route. | Click or long-press a locked item to select it and unlock. |
| Q3 | Text typed just before a reload or tab close was lost. | In-progress text is saved locally and checkpointed to the server; everything is flushed when the page is hidden. |
| Q4 | A dotted connector made every SVG and PNG export fail. | Fixed (duplicate attribute). |

## Security — remaining findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| S5 | Medium | Link-preview function could be pointed at internal addresses (DNS tricks) and accepted the public key as a login. | Fixed: every hop is resolved and checked; a signed-in user is required; rate limited. |
| S7 | Medium | Commenters could rewrite, forge or delete anyone's comments through the API. | Fixed in the database: replies append only, authorship and name are set server-side, only the author deletes a thread. |
| S8 | Medium | No limits on row size or count; a hostile revision number could block all later saves of an item. | Fixed: 1 MB per item, 50,000 items per board, bounded history, server-arbitrated revisions; refused saves are rolled back locally instead of retrying forever. |
| S9 | Medium | Embedded HTML ran scripts for every viewer; any site loaded automatically. | Fixed: pasted HTML is static only; unknown sites load on click (known providers and your own embeds load directly). |
| S10 | Medium | Agent tokens never expired and had no rate limit. | Fixed: expiry (90 days by default), 120 requests a minute, revoked on password change. Per-board scoping is still open. |
| S11 | Medium | Every account could list every user's name. | Fixed: profiles are visible to yourself and people you share a board with. |
| S12 | Medium | No Content-Security-Policy or framing protection. | Fixed: strict policy (scripts from the app only), no framing, nosniff, referrer and permissions policies. |
| S13 | Low | Access removal was not enforced on an open board; offline copies outlived sign-out. | Fixed: access is re-checked every minute and on return to the tab; offline copies are per account and purged on sign-out. |
| S14–S20 | Low | Viewer-sent "bring to me", style-based overlays in rich text, spreadsheet formula injection, service-worker caching of error pages, open redirect parameter on sign-in, error text leakage, storage cleanup. | Fixed. |

## Graphics and architecture — remaining findings

| # | Finding | Status |
| --- | --- | --- |
| G5 | Every pan frame re-ran connector routing for all mounted connectors. | Fixed: geometry keys are cached per store snapshot; wheel input is applied once per frame. |
| G7–G8 | IFC parsing blocked the UI thread; parsed models and their WebAssembly heaps were never released. | Fixed: parsing runs in a worker with transferable buffers; models are disposed when evicted. |
| G10 | Live updates sent whole items (including ink points and model previews) 16 times a second; bulk changes cost one full merge per row. | Fixed: live packets carry only changed fields; database changes are merged once per frame. |
| G12 | Full-resolution images were decoded at any zoom; links to stored files changed every session, defeating the browser cache. | Fixed: a small preview is generated on upload and used when the image is small on screen; links are stable for a week. |
| G14–G15 | Sticky text fitting forced layout on every resize frame; ink size changes had no effect until reload. | Fixed. |
| G18–G19 | Lost pointer-up left the canvas stuck; a palm could cancel a pen stroke; non-finite values could poison the camera. | Fixed: one recovery path for lost capture, blur and released buttons; palm contacts are ignored while a stylus is down; non-finite values are rejected. |
| G20–G22 | IFC picking re-uploaded the model each click; no handling of GPU context loss; PDF import leaked a canvas per page. | Fixed. |
| G3 | Every edit copies the item map (O(n)). | Accepted for now: measured at under 5 ms per frame at 10,000 items. A per-item store is the next step if boards grow past that. |
| G16 | Live ink recomputes the whole stroke each frame. | Accepted: fine for normal strokes; very long single strokes slow down progressively. |
| G26 | Reordering can reload embedded pages (stacking order is DOM order). | Open. |
| G28 | No tests, lint or CI. | Tests and CI added. Lint is still open. |

## Functional and polish

Fixed: text-resize undo corruption, missing width handles on text, ghost empty text items, stray text from double-clicking handles, deleted table rows still showing, frames losing connectors on duplicate and delete, ballooning resized pen strokes, shape text spilling out, front/back shortcuts, Escape in card and code editors, comment field focus on touch, context menu taller than the screen, junk items from tiny drags, table Enter key, invalid embed input, timer stuck at 0:00, oversized zoom steps, dark theme hiding text and lines, selection bar overlapping the tool rail, Escape clearing the selection when closing a popover, inserts landing on top of existing content, fit hiding content under the toolbars, two template defects, presentation mode showing surrounding content, the phone keyboard covering the note being typed, native browser prompts.

Open (minor): pie-chart legend can clip in narrow charts; export drops inline bold and card chips; right-to-left text alignment follows the text direction but has no manual override; the sticky size control shows the maximum, not the fitted size.

## Accessibility

Fixed: every control has an accessible name; dialogs have roles, trap focus, close on Escape from inside a field and return focus; visible keyboard focus; Space and Enter work on focused buttons; Tab walks the items on the board; contrast of secondary text and the primary button now meets 4.5:1; touch targets are at least 44 px; pages have a main landmark and per-board titles; reduced-motion preference is respected; pinch-zoom is no longer disabled on ordinary pages.

Open: board items are reachable by keyboard but are not announced to screen readers item by item.

## Not verifiable in this environment

- Real devices: Galaxy Z Fold 8 (including Flex Mode), iOS Safari, a real on-screen keyboard, stylus pressure. All touch results come from emulation.
- GPU behaviour: frame times were measured with software rendering.
- The email sign-up flow (test accounts were created directly in the database).
- IFC files beyond a small sample; behaviour with models of tens of megabytes is untested.
- PDF export goes through the browser's print dialog and was only checked up to the print preview.

## Needs the owner before a public launch

1. Supabase → Authentication → URL Configuration: set the Site URL to the production address.
2. Supabase → Authentication: turn on leaked-password protection and "secure password change"; raise the minimum password length to 8.
3. Custom SMTP for sign-up email (the built-in mailer only reaches project members).
4. The Supabase free plan pauses a project after a week without activity and has no point-in-time recovery. Move to a paid plan before relying on it.
5. Privacy policy and terms, if anyone outside your team will sign up.
6. A custom domain, and `main` as the production branch.

## Follow-up: sync between devices (2026-11-25)

Four reports from use on two installed devices with one account. Each was reproduced or traced to its cause before it was changed.

| Report | Cause | Fix |
| --- | --- | --- |
| Not all boards appear on both devices | The account held one cloud board; the others were device-only boards (made before signing in), which never upload. The board list was also only read once, when the dashboard opened. | The dashboard says which boards live on this device only and moves them into the account in one click, files and saved versions included. The list refreshes when the app comes back into view or online, and when a board is created, renamed, trashed or deleted on another device. |
| The user's initials show twice | Presence is tracked per device, and the top bar drew one avatar per device. | One avatar per account; your own other devices are not listed. |
| Scrolling does not zoom an IFC model | The board's wheel handler ran before the viewer could stop the event, so the board zoomed (1× to 2.6× in six wheel notches) with the model inside it. | The viewer takes the wheel on the way down. Scrolling zooms toward the point under the pointer and can pass through walls. A model uploaded on its own opens straight away. |
| Resized preset sheets keep their ratio tag | The preset was written into the frame title ("16:9 2") and never revisited. | The preset is a separate tag that shows only while the frame has those proportions. Titles written by older versions are converted when read. |

Related gaps closed in the same pass:

- An open board now asks the server what changed (deletions included) when it goes live, comes back into view, comes back online or reconnects. Before, changes made while a device slept were missed until the board was reopened.
- A board opened offline from its saved copy now picks up its real title, role and content when the connection returns.
- "Copy to cloud" left device-only files (images, PDFs, models) behind, so they were broken on other devices. It is replaced by "Move to my account", which uploads them.

Checked with: 6 new unit tests, 2 new end-to-end tests (ratio tag, model zoom), and a signed-in run against a mocked backend for the dashboard move and the catch-up. Not exercised against the live backend: two real devices on one account, and live presence.

Still open:

- Duplicating a cloud board shares its files with the original, so deleting the original breaks the copy's images.
- Deleting or moving a device-only board does not free the device storage its files used.
