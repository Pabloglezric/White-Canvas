# White Canvas codebase audit: current capabilities, architecture and extension points for construction-document review

Scope and method: read-only review of the repository at commit `2581a9c` (HEAD, 2026-11-25). Every citation is a repository-relative path with line numbers that were read in this pass (`path:line`). Nothing was run: `node_modules` is absent in this checkout, so `npm run test:unit` could not be executed. Two outside pages were consulted only to interpret dependencies (pdf.js API reference; nothing about the repository was sent). No reference-product (Bluebeam) research is included here.

## 1. Item model: types, validation, storage, rendering, sync, and what metadata exists

### Takeaway
A board is a flat map of 15 item types, each one Postgres row (`board_items.data` jsonb + server-arbitrated `rev`, whole-item last-write-wins), rendered as DOM+SVG inside one CSS-transformed world layer (a 2D canvas takes over above 600 visible items). World coordinates are unit-less CSS pixels at 100% zoom; there is no real-world scale, no layers, no status, no custom metadata and no per-item timestamps. Only `parent` (frame), `group`, `locked`, `z`, `by` (creator id) and `votes` exist as cross-type metadata, and the validation layer is a strict whitelist that silently drops any field it does not know.

### Cited Findings
**Types and fields**
- 15 item types: `sticky, text, shape, connector, draw, frame, image, embed, ifc, card, table, code, comment, file, chart` — `src/board/types.ts:3-5`.
- Shared base fields on every item: `id, type, x, y, w, h, rot, z, rev, parent? (containing frame), group?, locked?, by? (creator user id), votes?` — `src/board/types.ts:18-33`.
- Shared text style mixin (sticky/text/shape/table): `fontSize, color, align, valign, bold, italic, underline, strike, font ('sans'|'serif'|'mono'|'hand')` — `src/board/types.ts:35-45`.
- `sticky`: `html, fill, autoFit?, tags?, author?` — `src/board/types.ts:47-54`. `author` is rendered if present (`src/board/items/ItemView.tsx:78-82`) but the creation path sets it to `undefined` (`src/board/interaction.ts:660`); no code sets it.
- `text`: `html, fill?, autoW?` — `src/board/types.ts:56-61`.
- `shape`: `kind` (20 kinds: rect, round, ellipse, diamond, triangle, parallelogram, hexagon, star, pill, cylinder, cloud, callout, arrowRight, arrowLeft, pentagon, octagon, trapezoid, cross, document, predefined), `html, fill, stroke, strokeW, dash? ('solid'|'dashed'|'dotted'), opacity?` — `src/board/types.ts:7-10`, `:63-72`.
- `connector`: two ends `a`/`b` (`item?`, normalised anchor `ax/ay?`, free `x/y`), `route ('straight'|'elbow'|'curve')`, `capA/capB ('none'|'arrow'|'triangle'|'dot'|'diamond'|'bar')`, `stroke, strokeW, dash?, label?, color?, fontSize?` — `src/board/types.ts:12-14`, `:74-95`. A connector has exactly two ends; there are no intermediate vertices.
- `draw` (ink): `pts` (x,y,pressure triples relative to the item origin at `w0×h0`), `w0, h0, stroke, size, tool ('pen'|'highlighter')` — `src/board/types.ts:97-105`.
- `frame`: `title, fill, hidden?, preset?` — `src/board/types.ts:107-113`. Presets: Custom, 16:9 (1600×900), 4:3, A4 portrait 794×1123, A3 landscape 1587×1123, A1 landscape 3179×2245, Phone, Square — `src/board/defaults.ts:28-37`.
- `image`: `src ('asset:<path>' | 'data:' | 'https:')`, `thumb?, alt?, nw?, nh?` — `src/board/types.ts:115-122`. No opacity, tint, crop or page/source-document fields.
- `embed`: `url, src?, kind ('iframe'|'link'|'html'), html?, title?, desc?, thumb?, site?` — `src/board/types.ts:124-134`.
- `ifc`: `src, name, size?, cam? (pos xyz + target xyz), preview?, hiddenTypes?, section?` — `src/board/types.ts:136-145`.
- `card`: `title, desc?, status?, assignee?, due?, tags?, fill` — `src/board/types.ts:147-156`.
- `table`: `cells: string[][], colW, rowH, header?, fill?, stroke?` — `src/board/types.ts:158-166`. `code`: `code, lang, fontSize?, dark?` — `:168-174`. `file`: `src, name, mime?, size?` — `:184-190`. `chart`: `kind ('bar'|'line'|'pie'), title?, labels, values, fill?` — `:192-199`.
- `comment`: `thread: {id, by, name, text, at}[]`, `resolved?`, `fill?` — `src/board/types.ts:176-182`.
- Tools declared: select, hand, sticky, text, shape, connector, pen, highlighter, eraser, frame, comment, card, table, code, laser — `src/board/types.ts:205-207`. `laser` appears nowhere else in `src/` (grep), so it is declared but not implemented.
- Board-level settings (shared, jsonb): `grid, bg, snap, voting {open,max,title}, timer {endsAt,duration,paused}` — `src/board/types.ts:238-244`. Roles: `owner | editor | commenter | viewer` — `:213`.

**Validation (single gate, whitelist)**
- `normalizeItem` is "the single entry point for item data that did not originate in this tab: database rows, realtime messages, the offline cache, imported files, the clipboard and restored versions" — `src/board/validate.ts:1-4`; unknown `type` returns null — `:100-103`; each case builds a new object from named fields only and undefined keys are deleted — `:119-215`. A field that is not listed in the matching case does not survive a reload or a sync hop.
- Concrete example of that effect: `IfcItem.hiddenTypes` is declared (`src/board/types.ts:143`) but the `ifc` case does not copy it (`src/board/validate.ts:169-176`) and no other file references it (grep), so it is dropped.
- Bounds enforced: coordinates ±1e7, `w/h` 1…1e6, `z` ±1e9, rotation normalised to 0–360 — `src/board/validate.ts:12`, `:106-112`. Colours must be hex, `transparent` or `rgb()/rgba()` — `:11`. Ink is capped at 90,000 numbers (30,000 points) — `:139-147`. Rich text is sanitised to a tag list with `https?` links only — `:48-77`. Asset sources must be `asset:<uuid>/<name>`, `local:<id>`, small base64 raster data, or https — `:40-46`. Tables ≤300 rows × 40 columns; comment threads ≤500 entries of ≤4000 chars; charts ≤300 points — `:180-197`, `:204-210`.
- Frame presets are validated against the built-in preset labels — `src/board/validate.ts:13`, `:148-155`.

**Storage**
- `board_items (id uuid pk, board_id, data jsonb, rev, deleted bool, client_id text, updated_by uuid, updated_at timestamptz)` — `supabase/migrations/0001_init.sql:59-68`. Soft delete only (no delete policy; deletes are upserts with `deleted: true`) — `src/board/sync.ts:351`, `0001_init.sql:223-238`.
- Server-side: `rev` widened to bigint; `data` must be an object with a string `type` and ≤1,048,576 bytes; the trigger sets `updated_at`, `updated_by`, forces `board_id` to stay, decides the final `rev` (`greatest(old.rev+1, least(new.rev, old.rev+1000))`), and writes `id` and `rev` back into `data` — `supabase/migrations/0002_hardening.sql:8-14`, `:29-51`.
- 50,000 non-deleted items per board — `supabase/migrations/0002_hardening.sql:98-113`.
- Indexes: `(board_id, id) where not deleted` and `(board_id, updated_at)` — `0002_hardening.sql:4`, `supabase/migrations/0004_catch_up_index.sql:3`.
- Client loads the whole board in pages of 1,000 rows — `src/board/sync.ts:58-68`.
- Device-only boards (`local-…` ids) keep items and files in IndexedDB only — `src/board/sync.ts:116-153`, `src/board/assets.ts:35`, `:100-106`.
- Version history: `board_versions.snapshot` holds the full item array — `0001_init.sql:71-80`; automatic snapshot at most every 4 hours when an editor opens a changed board — `src/board/sync.ts:613-622`; pruned to 30 automatic + 200 named — `0002_hardening.sql:116-130`; restore replaces every item in one undoable patch — `src/board/ui/Panels.tsx:243-255`.

**Rendering**
- "Own engine (DOM + SVG items inside one transformed world layer, viewport culling), no third-party whiteboard SDK" — `PROJECT_BRAIN.md:14`. The world div gets `translate(x,y) scale(z)` — `src/board/Canvas.tsx:111`; items are absolutely positioned with `translate(...) rotate(...)` — `src/board/items/ItemView.tsx:333-341`, `src/index.css:77-78`.
- Culling: items whose bounds intersect the viewport plus a 35% margin are mounted — `src/board/Canvas.tsx:17-29`.
- Draw order: frames first, comments last, everything else between, then `z`, then id — `src/board/Canvas.tsx:9`, `:28`; export uses the same rule — `src/board/export.ts:16-17`. Stacking order is DOM order, and reordering can reload embedded pages (open issue G26) — `docs/AUDIT.md:87`.
- Overview renderer: above 600 visible items the board is painted on one 2D canvas, returning to DOM below 460 — `src/board/overview.ts:11-14`, `src/board/Canvas.tsx:34-42`; simplified painting per type (cards/tables/code/embeds/models/files/charts become a plain rectangle; ink is decimated to ~40 segments; images use ≤384 px bitmaps) — `src/board/overview.ts:27-49`, `:115-187`; geometric hit-testing replaces DOM hit-testing — `:204-249`. Canvas device-pixel ratio is capped at 2 — `src/board/Canvas.tsx:61`.
- Zoom range 0.02–8 — `src/board/store.ts:123-124`.
- Each item renders inside its own error boundary — `src/board/items/ItemView.tsx:319-323`.

**Units**
- Screen↔world conversion is `(s - cam)/z` and `w*z + cam` with no unit factor — `src/board/geometry.ts:47-48`. No unit, scale or calibration identifier exists anywhere in `src/` (grep for `calib`, `scale` as a data field, `unit` returned nothing relevant).

**Z-order, groups, locking, frames**
- Z-order: `reorder('front'|'back'|'forward'|'backward')` using fractional `z` — `src/board/ops.ts:283-308`.
- Groups: a shared `group` id; group/ungroup; selection and moves expand to group members, frame children and connectors with both ends in the set — `src/board/ops.ts:57-80`, `:255-270`.
- Lock: boolean per item, any editor can toggle; locked items cannot be moved, deleted, or marquee-selected, and are selectable by click to unlock — `src/board/ops.ts:85`, `:272-281`, `src/board/interaction.ts:296-297`, `:437`, `:708-712`.
- Frame membership: an item whose centre lands in a frame gets `parent`; re-evaluated after every move — `src/board/ops.ts:20-29`, `:41-44`, `:374-388`. Frames are ordered by geometry (rows, then left-to-right), not by an explicit index — `src/board/store.ts:353-357`.

**Author and time**
- `by` is filled by the client when an item is added (`raw.by ?? s.me.id`) — `src/board/ops.ts:39`. The server overrides it only for comment threads created by commenters — `0002_hardening.sql:77-79`.
- The row has `updated_at`/`updated_by` (`0001_init.sql:66-67`), but the client selects `id,board_id,data,rev,deleted,client_id,updated_at` and uses `updated_at` only as a catch-up cursor — `src/board/sync.ts:61`, `:211-213`. There is no `created_at` column on `board_items` and no timestamp inside item data, except `at` on each comment entry — `src/board/types.ts:176`.

**Sync**
- Channels: private broadcast `ops:<board>` (events `live`, `commit`, `summon`), private `board:<board>` for presence + cursor broadcast, and `postgres_changes` on `board_items`/`boards` — `src/board/sync.ts:392-454`, `:512-527`, `PROJECT_BRAIN.md:16-17`.
- In-flight edits: every 60 ms a packet with only the changed fields per item (large fields `pts`, `preview`, `thread` excluded; ≤80 patches) — `src/board/sync.ts:97-98`, `:317-335`. Commits broadcast whole items (≤80; ink with >1,500 numbers and model previews travel through the database stream instead) — `:348-357`.
- Merge rule: a remote item is accepted unless its `rev` is lower than the local one, it is tombstoned at that rev, or the item is mid-gesture locally — `src/board/store.ts:246-277`. Saves upsert the entire `data` object in batches of 150; rows the server refuses permanently are rolled back to the server copy — `src/board/sync.ts:259-300`.
- Catch-up: rows changed since the newest `updated_at` seen (15 s overlap), deletions included, on going live, reconnect, tab return, and coming online — `src/board/sync.ts:472-510`, `:526`, `:304-306`.
- Offline: per-account IndexedDB cache and outbox; the outbox is replayed on open unless the server revision moved on — `src/board/sync.ts:156-160`, `:215-241`, `:252-253`.
- Text being typed is checkpointed to the server every 2.5 s — `src/board/sync.ts:337-345`.
- Undo/redo: per client, in memory, 120 steps, one step per gesture — `src/board/store.ts:172-204`, `:228-243`.

### Inferences
- Because saves replace the whole `data` object and conflicts resolve per item by revision, two people changing different fields of the same item at commit time (for example one edits geometry while another sets a status) will produce one winner for the entire item. Field-level merging exists only for in-flight `live` packets (`src/board/sync.ts:430-441`).
- A4 and A1 frame presets match those paper sizes at 96 units per inch (794×1123 ≈ 210×297 mm at 96 dpi; 3179×2245 ≈ 841×594 mm at 96 dpi), so frames implicitly use "CSS px at 96 dpi" even though no unit is recorded. PDF pages are placed at a different implicit density (see section 2).
- Any new per-item field (layer, status, subject, measurement, custom metadata) requires a matching line in `normalizeItem`; otherwise it disappears after the first reload/sync even though TypeScript accepts it.
- New item types need no database migration (jsonb), but they do need: `ItemType`/`Item` union and `Tool` (`types.ts:3-5`, `:201-207`), a `normalizeItem` case and `TYPES` entry (`validate.ts:10`, `:119-212`), a `make.*` factory (`defaults.ts:50-86`), a branch in `ItemBody` (`ItemView.tsx:343-357`), `paintItem`/`hitOverview` (`overview.ts:115-249`), `itemSvg`/`thumbnailSvg`/`exportCsv` (`export.ts:20-43`, `:104-200`, `:294-311`), interaction mode/tool wiring (`interaction.ts:29-45`, `:254-283`, `:657-673`, `:1042`), toolbar/context bar, `rawText` for search (`Panels.tsx:31-46`), and the agent server's `describe`/`build`/`update_items` (`supabase/functions/mcp/index.ts:104-163`, `:344-368`).

### Gaps
- Not present: real-world scale or units; layers; per-item status (only `card.status` free text and `comment.resolved`); custom fields/metadata; created/updated timestamps on items; server-enforced authorship for non-comment items; polyline/polygon items; item-to-item or item-to-frame links.
- The on-disk shape of very large boards (close to the 50,000-item cap) was not measured in this pass; figures quoted are from `docs/AUDIT.md`.

## 2. PDF handling today

### Takeaway
PDFs are rasterised once at import: each of the first 40 pages becomes a JPEG image item (long side capped at 2,400 px, quality 0.9) inside one transparent frame named after the file. The original PDF is not stored, and no vector content, text layer, page label, page size in points, rotation or annotation is kept. Export back to PDF exists only as "print this SVG" through the browser's print dialog.

### Cited Findings
- `pdfjs-dist ^6.5.438` is a dependency — `package.json:21`. It is used in exactly one place, `importPdf` — `src/board/importers.ts:122-163` (grep for `pdfjs` finds only lines 123-126).
- Loading: dynamic `import('pdfjs-dist')`, worker from `pdfjs-dist/build/pdf.worker.min.mjs?url`, `getDocument({ data })` with no other options — `src/board/importers.ts:123-127`.
- Page limit: `Math.min(doc.numPages, 40)` with a toast when truncated — `src/board/importers.ts:128-129`.
- Raster resolution: `scale = Math.min(3, 2400 / Math.max(base.width, base.height))` where `base` is the scale-1 viewport — `src/board/importers.ts:140-142`; rendered to one reused canvas ("phones cap total canvas memory") and encoded `image/jpeg` at 0.9 — `:134-135`, `:143-145`.
- Each page is uploaded as `page-<n>.jpg`, plus a ≤512 px WebP preview — `src/board/importers.ts:147-149`, `src/board/assets.ts:163-178`.
- Item created per page: `make.image({ x, y, w: round(base.width*1.2), h: round(base.height*1.2), src, thumb, alt: '<file name> — page <n>', nw: canvas.width, nh: canvas.height })` — `src/board/importers.ts:150-151`. Pages are laid out left-to-right with a 40-unit gap — `:131-132`, `:152`.
- All pages are wrapped in a single frame titled with the file name, `fill: 'transparent'`, and each image gets `parent = frame.id` — `src/board/importers.ts:160-162`.
- The original file: in the PDF branch of `importFiles` only `importPdf` is called; `uploadAsset` is not called with the PDF itself — `src/board/importers.ts:190-193`. (Non-image, non-PDF, non-IFC files are uploaded as-is into a `file` item — `:212-216`.)
- Not called anywhere: `getTextContent`, `getOperatorList`, `getAnnotations`, `getPageLabels`, `getOutline`, or any `cMapUrl`/`standardFontDataUrl`/`wasmUrl` option (grep for `pdf` across `src/` returns only the import code and one UI string).
- Per-file limit 50 MB client-side and in the storage bucket — `src/board/importers.ts:176`, `supabase/migrations/0001_init.sql:267-268`; up to 30 files per drop — `src/board/importers.ts:172`; cloud boards refuse file imports while offline — `:168`.
- Display: an image item swaps to its small preview when narrower than 360 screen px — `src/board/items/ItemView.tsx:257-266`.
- UI copy describes the behaviour: "PDF (pages become markup-ready images)" — `src/board/ui/Panels.tsx:74`. A "Drawing review sheet" template (A1 frame, markup legend, action table, "Drop a drawing, PDF or IFC model here, then mark it up with the pen") exists — `src/board/templates.ts:109-123`.
- Export formats: SVG, PNG (1×/2×/4×/8×, optional transparent), print-to-PDF (one page per frame or single page), board JSON, CSV — `src/board/export.ts:1`, `src/board/ui/Panels.tsx:296-314`.
- In every export, image items are re-fetched and re-encoded to at most 2,200 px on the long side (PNG kept as PNG, otherwise JPEG 0.9) and embedded as data URLs — `src/board/export.ts:89-102`, `:144-149`.
- PDF export builds SVG pages, opens a blank window, writes them with an `@page { size: <first page w>px <first page h>px; margin: 0 }` rule and calls `window.print()` — `src/board/export.ts:267-287`. The audit records that this "goes through the browser's print dialog and was only checked up to the print preview" — `docs/AUDIT.md:108`.
- PNG export is limited to 8,192 px per side and 16 megapixels — `src/board/export.ts:241-254`.
- Comment items are excluded from SVG/PNG/PDF exports — `src/board/export.ts:105`, `:222`.
- The pdf.js API reference lists `cMapUrl`, `standardFontDataUrl`, `wasmUrl`/`useWasm` as optional `getDocument` parameters and documents `getOperatorList`, `getTextContent` and `getAnnotations` on pages — [pdf.js API: Module pdfjsLib](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).
- An earlier defect "PDF import leaked a canvas per page" was fixed (G20–G22) — `docs/AUDIT.md:84`.

### Inferences
- Effective raster density by sheet size (arithmetic from `importers.ts:141`, taking the scale-1 viewport as PDF points, 72 per inch): A4 (842 pt long side) → scale 2.85 → ≈205 dpi; A3 (1191 pt) → ≈145 dpi; ARCH D 24×36 in (2592 pt) → ≈67 dpi; A1 (2384 pt) → ≈72 dpi; A0 (3370 pt) → ≈51 dpi. Large-format construction sheets are therefore stored at roughly screen resolution.
- On-canvas sharpness: the item is `1.2 × points` wide in world units and the bitmap is 2,400 px on its long side, so the bitmap is shown 1:1 at zoom ≈ `2000 / long-side-points` — about 0.84 for A1 and 2.4 for A4. At the 8× maximum zoom an A1 page is upsampled about 9.5× (before device-pixel ratio).
- Implicit page scale: 1 PDF point = 1.2 world units, i.e. 86.4 world units per inch (≈3.40 per mm). This differs from the 96-per-inch implied by the A-series frame presets, so an A4 PDF page (≈714×1010 units) does not fill an "A4 portrait" frame (794×1123).
- Exported "vector" PDF contains vector board items but the PDF underlay comes back as a ≤2,200 px JPEG; the output is produced by the browser's print pipeline, so it carries no PDF annotations, and all pages use the first page's size (`export.ts:278`).
- Because `getDocument` is given no `cMapUrl`, `standardFontDataUrl` or `wasmUrl`, PDFs that rely on predefined CMaps, non-embedded standard fonts or wasm-backed image decoders may render with fallbacks; this was not tested here.
- Re-running a PDF through a better pipeline later is impossible for existing boards because the source file was never uploaded.

### Gaps
- Not verified by execution: actual rendering of fonts/JPEG2000/JBIG2 content under the current options and CSP; behaviour with 40-page large-format sets on phones.
- Not present: live (zoom-dependent) PDF rendering, tiling, text selection/search inside PDFs, page labels/bookmarks, retained source file, PDF annotation import or export.

## 3. IFC / 3D handling

### Takeaway
An `ifc` item shows a static JPEG preview until opened; opening lazy-loads three.js and a web-ifc worker that streams all meshes into colour-merged buffers. The viewer supports orbit, zoom-to-pointer, fit, x-ray, one horizontal section plane, and click-to-inspect property sets. There is no measurement, no per-element or per-type visibility, no model tree, and only one camera state per item.

### Cited Findings
- Dependencies `web-ifc ^0.0.81` and `three ^0.187.0` — `package.json:26-27`; the wasm binaries are copied to `public/wasm` at install — `scripts/copy-wasm.mjs:1-12`, `package.json:11`; served with a one-week cache — `vercel.json:19`.
- Worker: `SetWasmPath('/wasm/', true)`, `OpenModel(bytes, { COORDINATE_TO_ORIGIN: true })`, `StreamAllMeshes`, vertices transformed and merged into one buffer set per colour with `(expressID, firstIndex, indexCount)` part triples, returned as transferables — `src/board/ifc/ifc.worker.ts:21-83`.
- Properties on demand: `GetLine`, type name, `Name`/`ObjectType`, `GlobalId`, and `properties.getPropertySets` limited to 12 sets × 40 properties, reading Nominal/Length/Area/Volume/Count/Weight values — `src/board/ifc/ifc.worker.ts:91-110`.
- Viewer: `WebGLRenderer` with local clipping, hemisphere + directional light, 45° perspective camera, `OrbitControls` with damping, `MeshLambertMaterial` per bucket — `src/board/ifc/IfcViewer.tsx:46-58`, `:109-134`.
- Tools in the viewer UI: Fit, X-ray, Section cut with a 0–1 height slider, Close — `src/board/ifc/IfcViewer.tsx:338-344`. The section is one plane with normal (0,−1,0) positioned between the model's min and max Y — `:130`, `:182-188`.
- Picking: click without drag raycasts, maps the face to an element via binary search over parts, highlights its triangles and opens a property panel — `src/board/ifc/IfcViewer.tsx:84-95`, `:209-236`, `:345-357`.
- Wheel/pinch dolly toward the point under the pointer, handled in the capture phase so the board does not zoom — `src/board/ifc/IfcViewer.tsx:240-294`; decision recorded — `PROJECT_BRAIN.md:37-38`.
- Persisted per item: `cam` (6 numbers), `section`, and a ≤720 px JPEG `preview` written when the viewer closes (editors only, no undo step) — `src/board/ifc/IfcViewer.tsx:302-316`, `:333`; validation keeps `cam`, `preview` (<400 KB data URL), `section` — `src/board/validate.ts:169-176`.
- Resource handling: 2 parsed models cached (LRU), disposal of geometry and worker, GPU context loss/restore handling, pixel ratio up to 2.5 following board zoom — `src/board/ifc/IfcViewer.tsx:21-29`, `:71-75`, `:143`, `:161-165`.
- The viewer mounts only while the item is the one being edited; otherwise the preview image and an "Open 3D" button are shown — `src/board/items/Blocks.tsx:92-115`. A model added on its own opens immediately — `src/board/importers.ts:228-234`.
- Parsing off the main thread and disposal were audit fixes G7–G8 — `docs/AUDIT.md:79`.
- Limits: files ≤50 MB — `src/board/importers.ts:176`; "IFC files beyond a small sample; behaviour with models of tens of megabytes is untested" — `docs/AUDIT.md:107`.
- "per-element IFC visibility" is on the not-built list — `PROJECT_BRAIN.md:72`.
- In exports and in the crowded-view canvas an IFC item is its preview image or a grey card — `src/board/export.ts:144-149`, `src/board/overview.ts:177-184`.

### Inferences
- Because geometry is merged by colour with per-element index ranges already tracked (`byElement` map, `IfcViewer.tsx:47-64`), per-element hide/isolate and point-to-point measurement are feasible on the existing buffers, but neither exists.
- The 3D view is not collaborative while open: peers see only the saved preview and camera after the viewer closes.
- 2D markups cannot be anchored to 3D elements; ink drawn over an IFC item sits on the board above a static preview.

### Gaps
- Not present: measurement in 3D, arbitrary/multiple section planes, element/type visibility, spatial tree, saved viewpoints, property search, clash or model compare, 2D sheet generation from the model.
- No performance figures for real building models exist in the repository.

## 4. Drawing and markup tools, and editing operations

### Takeaway
The toolset is a general whiteboard set: pen/highlighter/whole-stroke eraser (perfect-freehand), 20 parametric shapes, two-ended connectors with caps and a label, text, sticky notes, frames with presets, images, embeds, cards, tables, code, charts, comments, and 10 built-in templates. Editing covers multi-select, group, lock, rotate, resize, align/distribute, z-order, duplicate, copy/paste, undo/redo and object-edge snapping. There are no construction primitives (revision cloud, leader callout, dimension, stamp, hatch, count), no polylines/polygons, no vertex editing, and no snapping to content inside an image.

### Cited Findings
- Toolbar: Select, Pan, Sticky, Text, Shape, Connector, Pen (pen/highlighter/eraser), Frame, Comment, Insert, Undo/Redo; double-click locks a tool — `src/board/ui/Toolbar.tsx:42-54`, `:66-93`. Flyouts: sticky colour, 20 shape kinds, connector route, pen colour/size and "Finger draws", frame presets — `:96-166`.
- Keyboard tool keys: V, H, N, T, S, R, O, L, X, P, E, F, C, K, Shift+H — `src/board/interaction.ts:1042-1052`.
- Pen: perfect-freehand `getStroke` with `thinning 0.55` (0 for highlighter), `smoothing 0.55`, `streamline 0.4`, simulated pressure unless a stylus reports it; coalesced pointer events; palm contacts ignored while a stylus is down — `src/board/interaction.ts:220-227`, `:256-263`, `:471-481`, `:601-611`, `src/board/items/ItemView.tsx:146-161`. Pen width is set in screen pixels and divided by zoom at creation — `src/board/interaction.ts:259`. Highlighter renders at 0.45 opacity with `mix-blend-mode: multiply` — `src/board/items/ItemView.tsx:163-170`.
- Eraser removes whole strokes only — `src/board/interaction.ts:613-633`.
- Shapes are generated by `shapePath(kind, w, h)`; `cloud` is a fixed five-lobe bezier outline scaled to the box and `callout` is a speech bubble with a fixed tail position — `src/board/geometry.ts:262-313`. Shape text is auto-fitted — `src/board/items/ItemView.tsx:112-140`.
- Connectors: straight, elbow (orthogonal, rounded corners) or curve routing between two ends; ends attach to an item side/anchor or float; caps arrow/triangle/diamond/dot/bar; dash; one label at the midpoint — `src/board/geometry.ts:186-258`, `src/board/items/ItemView.tsx:189-225`, `src/board/ui/ContextBar.tsx:113-126`. Connection dots create a linked copy — `src/board/interaction.ts:798-814`. "Line jumps on connectors" is not built — `PROJECT_BRAIN.md:72`.
- Text and sticky notes: contentEditable rich text sanitised on every input, plain-text paste — `src/board/items/RichText.tsx:51-110`; font size, bold/italic/underline/strike, alignment, vertical alignment, 4 font families, colour — `src/board/ui/ContextBar.tsx:127-169`.
- Frames: draw or preset; rename; presentation mode steps through frames in reading order with a mask — `src/board/ui/Toolbar.tsx:147-164`, `src/board/ui/Chrome.tsx:371-405`; frames outline panel — `src/board/ui/Panels.tsx:174-191`.
- Images (upload/paste/URL), embeds (known providers load directly, unknown sites load on click, pasted HTML is sandboxed static), files, CSV→table, JSON→code or board restore, MD/TXT→text — `src/board/importers.ts:33-80`, `:165-221`, `src/board/items/Blocks.tsx:21-88`.
- Cards with title/description/status/assignee/due/tags editor — `src/board/items/Blocks.tsx:119-149`. Tables with add/delete row/column and header toggle — `:196-233`, `src/board/ui/ContextBar.tsx:170-179`. Charts (bar/line/pie) from pasted data — `src/board/ui/Panels.tsx:92-105`.
- Templates (code-defined): kanban, retrospective, brainstorm, flowchart, mind map, SWOT, timeline, drawing review sheet, meeting notes, priority matrix — `src/board/templates.ts:23-141`. No user-saved templates exist (only this array).
- Comments: a 32×32 pin item with a thread; reply, resolve/reopen, delete thread (editor or thread author); resolved pins are hidden on the canvas; a panel lists threads newest-first with a "Resolved" toggle — `src/board/ui/Chrome.tsx:300-367`, `src/board/Canvas.tsx:23`, `src/board/ui/Panels.tsx:150-170`. Threading is one flat list per pin; no @mentions, no per-entry edit, no notification, and a pin stores a position, not a link to an item.
- Selection: click, shift/ctrl additive, marquee (frames must be fully enclosed), select all, Tab walks items — `src/board/interaction.ts:293-342`, `:431-443`, `:1005-1016`, `src/board/ops.ts:250-253`. "Lasso select" is not built — `PROJECT_BRAIN.md:71`.
- Move/resize/rotate: 8 handles + rotation handle for one item, 4 corner handles for a multi-selection (uniform scale), Shift constrains move axis, rotation snaps to 15° with Shift and to 45° multiples within 3° — `src/board/Canvas.tsx:168`, `:188-241`, `src/board/interaction.ts:448-470`, `:521-599`.
- Snapping: moving selection's box edges/centres snap to edges/centres of up to 160 other visible items (connectors, ink and comments excluded) within 6 screen px, with guides; Ctrl/Cmd suspends — `src/board/interaction.ts:501-533`, `src/board/geometry.ts:354-382`. The grid is a background only ("Snap to objects" is the sole snap setting) — `src/board/Canvas.tsx:117-123`, `src/board/ui/Chrome.tsx:138-139`.
- Align left/centre/right/top/middle/bottom, distribute, tidy into grid — `src/board/ops.ts:310-357`. Nudge with arrows — `:359-371`.
- Duplicate (Ctrl+D, Alt+drag), copy/cut/paste via a JSON text clipboard format, paste across boards with file adoption — `src/board/ops.ts:113-178`, `src/board/interaction.ts:420-423`, `:914-924`.
- Undo/redo — `src/board/store.ts:228-243`. Voting and a shared timer — `src/board/items/ItemView.tsx:283-315`, `src/board/ui/Panels.tsx:378-425`.
- Search panel: substring search over item text (notes, shapes, cards, tables, code, frame titles, embed titles/URLs, comments, connector labels, file/model names, image alt, chart labels), max 80 hits — `src/board/ui/Panels.tsx:25-46`, `:195-227`.
- Not built per project notes: "Lasso select, shape recognition, mind-map auto layout, video chat and recordings, private mode, built-in AI, per-element IFC visibility, line jumps on connectors, email invitations, anonymous view-only links, native apps, per-board agent tokens" — `PROJECT_BRAIN.md:69-73`.

### Inferences
- The only per-item style memory is "last used" preferences in localStorage (`penColor, penSize, hlColor, hlSize, stickyColor, shapeKind, connRoute` — `src/board/store.ts:13-38`); there is no saved-tool or preset concept to build a tool chest on beyond these.
- Selection handles assume a box (`x,y,w,h,rot`) or a two-ended connector (`Canvas.tsx:188-217`); any polyline/polygon/leader item needs a new handle model for vertices.
- A rectangle-shaped revision cloud fits the existing `shapePath` mechanism, but a correct one needs arc count to depend on perimeter (the current `cloud` stretches five lobes), and a polygon cloud needs a point-list item type.

### Gaps
- Not present: polyline, polygon, arc, dimension, leader callout, stamp, hatch/pattern fill, count marker, partial eraser, text highlight on underlying documents, item hyperlinks, user-defined templates or tool presets.

## 5. Collaboration and permissions; what a time-boxed review session would lack

### Takeaway
Collaboration is live (broadcast edits, presence, cursors, follow, "bring everyone to me") with four roles enforced by RLS, sign-in-required share links, and database-enforced comment integrity. A review-session concept is absent: there is no session entity, no invitations, no "edit only your own markups" permission, no activity log (only the latest state per item plus whole-board snapshots), and no close-out/flatten step.

### Cited Findings
- Roles: owner = `boards.owner_id`; members have `viewer | commenter | editor` — `supabase/migrations/0001_init.sql:39-46`, `:97-105`.
- Share link: `boards.link_access in ('none','view','comment','edit')`; opening a board you cannot see calls `join_board`, which (if signed in and the link allows) inserts a membership with `via_link = true` — `0001_init.sql:30`, `:119-140`, `src/board/sync.ts:166-172`. Turning the link off deletes link-joined members; changing it updates their role — `0001_init.sql:142-164`. Direct membership inserts were removed, so the link is the only way in — `supabase/migrations/0002_hardening.sql:132-133`. Sign-in is required for cloud boards — `src/pages/BoardPage.tsx:44`; sign-in is email + password — `src/pages/Login.tsx:27-31`.
- Share dialog: link-access select, copy link, member list with role select and remove (owner only) — `src/board/ui/Panels.tsx:324-374`, `src/board/ui/Chrome.tsx:122`.
- RLS on items: any role may read; owners/editors may insert/update any item; commenters may insert/update only rows whose `data->>'type' = 'comment'` — `0001_init.sql:223-238`. Client mirror of the rule — `src/board/store.ts:146-157`.
- Comment integrity (trigger, for signed-in writers): commenters cannot shorten a thread, edit existing entries, change other fields, or delete someone else's thread; new entries get the real `by`, profile display name and ≤4000 chars; threads ≤500 entries — `0002_hardening.sql:53-90`.
- Realtime authorisation: any board role may read `board:`/`ops:` topics and write `board:` (presence, cursors); only owner/editor may write `ops:` — `0001_init.sql:254-264`. `summon` travels on `ops:` so viewers cannot steer others — `src/board/sync.ts:92-95`, `0002_hardening.sql:156-157`.
- Presence and cursors: presence key per client id, cursor broadcast throttled to 60 ms with selection (≤30 ids) and camera; peers shown one avatar per account; click an avatar to follow — `src/board/sync.ts:392-426`, `:529-541`, `src/board/store.ts:359-374`, `src/board/ui/Chrome.tsx:101-117`. Peer selections and cursors are drawn in the overlay — `src/board/Canvas.tsx:248-269`. Realtime client is configured for 40 events/second — `src/lib/supabase.ts:13`.
- Access is re-checked every 60 s and on tab return; loss of access closes the board and wipes its local copy — `src/board/sync.ts:202-208`, `:543-566`.
- Limits: 1 MB per item, 50,000 items per board, title/thumbnail/settings size checks (`boards.settings` ≤16 KB, `profiles.settings` ≤16 KB) — `0002_hardening.sql:11-23`, `:98-113`.
- Rate limits: a `rate_limits` table and `rate_limit_hit` function usable only by the service role — `supabase/migrations/0003_rate_limits.sql:1-22`; applied to the agent server (120 requests/minute per token) and link previews (30/minute per user) — `supabase/functions/mcp/index.ts:34-39`, `supabase/functions/unfurl/index.ts:43-48`. No rate limit on direct item writes by signed-in clients appears in the migrations.
- Storage: private bucket `board-assets`, object path `<board_id>/<uuid>.<ext>`; read for any board role, write/update/delete for owner/editor — `0001_init.sql:266-292`, `src/board/assets.ts:100-113`. Signed URLs valid 7 days, remembered in localStorage — `src/board/assets.ts:10-33`, `:53-58`.
- Profiles are visible only to yourself and people you share a board with — `0002_hardening.sql:135-154`.
- Shared session-like primitives that exist: a countdown timer and voting stored in `boards.settings` (editors can start them), presentation mode, version snapshots — `src/board/ui/Panels.tsx:378-425`, `src/board/ui/Chrome.tsx:25-50`, `src/board/sync.ts:609-651`.
- Not built: "email invitations, anonymous view-only links" — `PROJECT_BRAIN.md:72`; custom SMTP is not configured ("built-in mailer only reaches project members") — `PROJECT_BRAIN.md:79`.

### Inferences
What a time-boxed review session with an activity log would need that is missing:
- A session record (name, board/sheets in scope, start, due/end, status, creator) and attendee rows. No table for this exists (tables are `profiles, boards, board_members, board_user_state, board_items, board_versions, api_tokens, rate_limits`).
- A reviewer permission between commenter and editor: today a commenter can create only `comment` items (`0001_init.sql:225-229`) and an editor can change or delete anyone's items (`:230-238`). "Each participant may modify only their own markups" needs a trigger/RLS rule on `data->>'by'` and server-set authorship for all item types (currently only commenter comments, `0002_hardening.sql:77-79`).
- An append-only activity record. `board_items` holds one row per item with the last `updated_by/updated_at`; earlier states are overwritten and there is no events table. `board_versions` snapshots are whole-board, infrequent (≥4 h apart for automatic ones) and pruned.
- Invitations and notifications (email or in-app); only a copyable link exists.
- Enforced time-boxing: the timer is a display value in settings; nothing changes permissions when it ends.
- A finish step that freezes markups and produces a flattened/annotated PDF; the `locked` flag is a convenience any editor can toggle, and export is print-based (section 2).
- Per-author filtering and reporting of markups; items carry only a creator uuid, and display names resolve through `profiles` only for people sharing a board.

### Gaps
- Supabase Realtime payload/throughput limits were not confirmed from an official page in this pass; the code's own caps (80 patches per live packet, ink >1,500 numbers routed through the database) are the only evidence of intended limits (`src/board/sync.ts:334`, `:353`).
- Behaviour of live presence with two real devices was "not exercised against the live backend" per `docs/AUDIT.md:136`.

## 6. The agent server (MCP edge function)

### Takeaway
A Supabase Edge Function exposes nine tools over stateless JSON-RPC (MCP Streamable HTTP), authenticated by a hashed personal token and running with the service role while re-implementing role checks. An agent can list/create boards, read item text and geometry, create/update/delete 12 item types, lay out diagrams, comment and search. It cannot see pixels, PDFs, ink geometry or IFC content, cannot upload files, and cannot create ink, file or model items.

### Cited Findings
- Tools: `list_boards`, `create_board`, `get_board` (views `summary | items | outline`, filters `types`, `frame_id`, `limit` ≤2000), `create_items`, `update_items`, `delete_items`, `create_diagram`, `add_comment`, `search_board` — `supabase/functions/mcp/index.ts:211-471`; listed in `README.md:69-70`.
- Auth: `Authorization: Bearer wc_<alnum>`; SHA-256 of the token is looked up in `api_tokens`; expiry and `can_write` honoured; `last_used_at` updated — `supabase/functions/mcp/index.ts:29-32`, `:50-59`. Tokens are generated in the browser (30 random characters), only the hash and a 9-character prefix are stored, lifetime 30/90/365 days or never, optional read-only; all tokens are deleted on password change — `src/pages/Settings.tsx:12-16`, `:44-50`, `:75-83`, `:92-98`; schema — `supabase/migrations/0001_init.sql:83-94`, `0002_hardening.sql:25-26`.
- The function uses the service-role client and checks board role itself (`roleFor`, `needWrite`) — `supabase/functions/mcp/index.ts:5`, `:61-75`. A token covers every board its user can access; "Per-board scoping is still open" — `docs/AUDIT.md:68`.
- Transport: POST only, ≤2 MB body, batches ≤20, protocol versions 2025-06-18 / 2025-03-26 / 2024-11-05, no resources or prompts — `supabase/functions/mcp/index.ts:477-527`. Rate limit 120/minute per token → HTTP 429 — `:34-39`, `:509-511`.
- Read shape (`describe`): id, type, rounded x/y/w/h, rotation, frame, locked, vote count, and per type: text (HTML stripped), colours, shape kind, connector ends/label/route, card fields, table rows, code, embed URL/title, image `alt` (URL only if it is http/https), file/model name, chart data, comment thread; ink is reported only as `note: 'freehand ink'` with its colour — `supabase/functions/mcp/index.ts:103-127`.
- Create (`build`): sticky, text, shape, frame, card, table, code, embed (https), image (https URL only), chart, comment, plus connectors; unknown types throw; ≤500 items per call; `ref` names for same-call connectors; automatic layout and frame adoption — `supabase/functions/mcp/index.ts:129-207`, `:264-333`.
- Update: x, y, w, h, rotation, locked, frame, text, title, label, color, shape, font_size, card fields, tags, table rows, code, comment `resolved` and `reply` — `supabase/functions/mcp/index.ts:334-372`. Delete skips locked items and detaches connectors/children — `:373-394`.
- `create_diagram`: longest-path layering of ≤300 nodes/≤1000 edges into shapes and elbow connectors, optional titled frame — `supabase/functions/mcp/index.ts:395-445`.
- Writes go to `board_items` with `client_id: 'agent'`; open boards receive them through `postgres_changes` and merge once per frame — `supabase/functions/mcp/index.ts:87-93`, `src/board/sync.ts:456-470`, `:512-519`.
- Items are stamped `by: ctx.user`; agent comment entries are named "Agent" — `supabase/functions/mcp/index.ts:129`, `:156`, `:365`. The comment-authorship trigger applies only when `auth.uid()` is set, i.e. not to the service-role agent — `supabase/migrations/0002_hardening.sql:53-54`.
- Every tool call loads the entire board (`loadItems`, pages of 1,000) — `supabase/functions/mcp/index.ts:77-86`, and e.g. `:239`, `:295`, `:340`, `:378`, `:452`, `:465`.
- "Built-in AI" is not built — `PROJECT_BRAIN.md:71`. There is no in-app assistant UI or model call in `src/` (grep).

### Inferences
- For drawing QA or auto-takeoff an agent has no input: page images are `asset:` references that `describe` hides (only `alt`, e.g. "file.pdf — page 3", is returned), there is no tool that returns a signed URL, image bytes, a rendered view or PDF text, and no scale exists to convert geometry to quantities.
- Agent-written items are validated only by the database shape check (object with string `type`, ≤1 MB); a type or field the browser's `normalizeItem` does not know is dropped client-side, so server and client whitelists must be extended together.
- `get_board` returns at most 2,000 items with a `truncated` flag and no offset, so large boards cannot be fully enumerated in `items` view.
- Agent deletions bypass users' undo stacks (the tool description says so, `index.ts:374`).

### Gaps
- No tests for the edge functions exist in `tests/` (unit tests cover geometry, store, validation, sync; e2e runs on device-only boards) — `tests/unit/*.test.ts`, `playwright.config.ts:3`.

## 7. Export and import formats and their fidelity

### Takeaway
Exports are SVG (vector items, rasters embedded ≤2,200 px), PNG (≤8,192 px / 16 MP), print-dialog PDF, a JSON backup of items (file references, not files), and a CSV of text-bearing notes/cards/comments. Imports are images, PDF (rasterised), IFC, CSV/TSV, board JSON, MD/TXT, arbitrary files as attachments, URLs/iframes/HTML as embeds, and spreadsheet/clipboard text. Nothing reads or writes DWG/DXF, XLSX, or PDF annotations.

### Cited Findings
- Scope options: whole board, selection (frames bring their children), or one frame — `src/board/export.ts:202-225`.
- SVG per item type: frames (rect + title), stickies/text/shapes with re-wrapped plain text (`htmlToText`, shrink-to-fit), connectors with caps and label, ink as the perfect-freehand outline path, images and IFC previews as embedded data URLs, embeds/files as labelled placeholders, cards, tables, code, charts (bar layout only) — `src/board/export.ts:45-85`, `:104-200`.
- Known fidelity losses: "export drops inline bold and card chips" — `docs/AUDIT.md:94`; live embeds export as placeholders — `src/board/ui/Panels.tsx:315`; comments are omitted — `src/board/export.ts:105`; chart export draws bars regardless of `kind` — `:185-197`.
- Every value written to markup is coerced or colour-checked and text is escaped — `src/board/export.ts:11-14`, with a regression test "hostile item data never reaches the exported file as markup" — `tests/e2e/regressions.spec.ts:73`.
- Board JSON: `{ app: 'white-canvas', version: 1, title, exported_at, items: [...] }` — `src/board/export.ts:289-292`. Import recognises `app === 'white-canvas'` with an `items` array, normalises and pastes them (new ids, re-centred) — `src/board/importers.ts:204-206`, `src/board/ops.ts:113-139`, `:170-178`. "A board JSON file holds file references, not the files" — `docs/AUDIT.md:145`. Board settings are not part of the file.
- CSV: columns `type,text,frame,color,tags,votes,x,y` for sticky/text/shape/card/comment items that have text; formula-leading cells are neutralised — `src/board/export.ts:294-311`.
- Dashboard thumbnail: a schematic SVG of up to 260 items stored on the board row — `src/board/export.ts:19-43`, `src/board/sync.ts:311-315`.
- Import matrix — `src/board/importers.ts:165-221`: images (with preview), SVG images, PDF, IFC, CSV/TSV → table (≤200 rows × 20 columns, `:82-90`), JSON, MD/TXT → text (≤20,000 chars), anything else → `file` attachment. Clipboard/drag text: own clipboard format, iframe code, URL, tab/HTML tables, plain text — `:92-107`.
- Files that arrive from another board or from a device-only board are copied into the destination board's folder and items are repointed (`adoptAssets`, `adoptForeignFiles`); the file-bearing types are image (`src`, `thumb`), ifc and file — `src/board/assets.ts:129-160`, `src/board/ops.ts:186-248`, `PROJECT_BRAIN.md:25-27`.

### Inferences
- The SVG generator is the one place that already converts every item to resolution-independent geometry; it is the natural source for PDF appearance streams, but text is laid out by a canvas-measured re-wrap rather than the on-screen DOM layout, so text positions can differ slightly from the canvas.
- A new file-bearing item type (e.g. a retained PDF) must be added to `fileRefs`, `adoptAssets` and `repoint`, or pasted/duplicated boards will point at another board's folder.

### Gaps
- Not present: XLSX export/import, DXF/DWG, PDF with annotations, image export of a single sheet at a chosen DPI (scale multipliers only), server-side export (all export code depends on `document`/canvas).

## 8. Recorded decisions and constraints

### Takeaway
The project has committed to its own engine and its own visual identity, a strict Content-Security-Policy that only allows same-origin scripts/workers (wasm permitted), a service-worker update model that depends on a per-build stamp, and measured performance results that function as de facto budgets. Any heavy new capability (PDF engine assets, OCR, CAD kernels) must be self-hosted, lazy-loaded and kept out of the app-shell precache.

### Cited Findings
- "Own engine (DOM + SVG items inside one transformed world layer, viewport culling), no third-party whiteboard SDK." — `PROJECT_BRAIN.md:14`.
- "Own visual identity; no reference-product branding or assets." — `PROJECT_BRAIN.md:30`.
- "Incoming item data always goes through `src/board/validate.ts` (`normalizeItem`). Never render or export unvalidated data." — `PROJECT_BRAIN.md:44`.
- "Hosting sends a strict Content-Security-Policy (`vercel.json`). New third-party scripts need a deliberate policy change." — `PROJECT_BRAIN.md:49`.
- Exact CSP value — `vercel.json:10`:
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https: wss://*.supabase.co blob: data:; frame-src 'self' https:; child-src 'self' blob: https:; worker-src 'self' blob:; media-src 'self' blob: https:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
- Other headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, `Cross-Origin-Opener-Policy: same-origin` — `vercel.json:12-15`.
- SPA rewrite sends everything to `index.html` except `assets/`, `wasm/`, `icons/`, `sw.js`, `manifest.webmanifest`, `robots.txt` — `vercel.json:3`. Cache headers: `/assets/*` immutable for a year, `/wasm/*` one week, `/sw.js` no-cache — `:18-20`.
- Service-worker update model: every build stamps a unique id into `index.html` (`meta[name=wc-build]`) and into `sw.js` together with the app-shell file list; the build fails if the stamp marker is missing; optional heavy chunks matching `/(pdf|web-ifc|IfcViewer|ifc\.worker)/i` are excluded from the precache and cached on first use — `vite.config.ts:7-35`, `public/sw.js:1-16`, `:53-62`. The page asks the new worker for its build, offers a reload and reloads by itself once hidden — `src/main.tsx:16-45`, `src/App.tsx:13-29`, `PROJECT_BRAIN.md:19-23`. Only same-origin GETs under `/assets/`, `/wasm/`, `/icons/` are runtime-cached — `public/sw.js:34-62`.
- Measured results (headless Chromium, software rendering): whole 10,000-item board shown in 44 ms; zoom with 10,000 items 17.4 ms median / 27.3 ms worst frame; pan 19.4 ms median; initial transfer "about 228 KB"; first contentful paint 0.8 s mobile / 0.2 s desktop; Lighthouse 99/100 performance, 100 accessibility, 100 best practices, 100 SEO; a 1,000-row page through RLS ≈21 ms — `docs/AUDIT.md:18-41`.
- Accepted architectural limits: "Every edit copies the item map (O(n))… under 5 ms per frame at 10,000 items. A per-item store is the next step if boards grow past that"; "Live ink recomputes the whole stroke each frame"; reordering can reload embeds — `docs/AUDIT.md:85-87`.
- Build settings: ES2022 target, ES-module workers, `chunkSizeWarningLimit: 4000`, `web-ifc` excluded from dependency optimisation — `vite.config.ts:40-45`. Stack: Vite 8, React 19, TypeScript 7, Tailwind 4, Zustand 5 — `package.json:16-43`, `README.md:9-17`.
- Tests: Vitest with jsdom over `tests/unit/**/*.test.ts` — `vite.config.ts:47`; Playwright against the production preview build with three projects (desktop 1280×800, two foldable touch viewports 411×960 and 859×954), device-only boards — `playwright.config.ts:3-20`; CI runs typecheck, unit tests, build and e2e on every push — `.github/workflows/ci.yml:9-23`. Project notes state 72 unit and 21 e2e tests — `PROJECT_BRAIN.md:64-65`; the audit says 56 unit and 19 e2e were added in that pass — `docs/AUDIT.md:43`. Lint is "still open" — `docs/AUDIT.md:88`. A debug handle `window.__wc` is exposed when `localStorage["wc.debug"]="1"` — `src/board/store.ts:376-381`.
- "Not built yet": lasso select, shape recognition, mind-map auto layout, video chat and recordings, private mode, built-in AI, per-element IFC visibility, line jumps on connectors, email invitations, anonymous view-only links, native apps, per-board agent tokens — `PROJECT_BRAIN.md:69-73`.
- Platform caveats recorded: Supabase free plan pauses after a week of inactivity and has no point-in-time recovery; real-device checks (foldables, iOS Safari, stylus pressure) not done; GPU frame times not measured — `docs/AUDIT.md:102-117`, `PROJECT_BRAIN.md:75-81`.
- Product-direction research in the repo is about a general whiteboard reference product (layers, locking, export quality, large-board lag, weak mobile, offline, etc.), not construction review — `docs/research-miro-features.md:1-20`, `docs/research-complaints-and-foldables.md:5-27`.

### Inferences
- CSP consequences for new capabilities: (a) any library that loads worker scripts or wasm from a CDN by default (typical for OCR and some PDF/CAD engines) must be vendored same-origin, like web-ifc under `/wasm/`; (b) a new static directory (e.g. CMaps, standard fonts, OCR language data) must be added to the rewrite exclusion in `vercel.json:3` or it will be answered with `index.html`; (c) wasm compilation is allowed (`'wasm-unsafe-eval'`), `eval`/inline scripts are not; (d) fonts can only come from same-origin or `data:`; (e) `connect-src https:` permits fetches to any HTTPS API, so the policy does not block calling an external service, though keys would need a server-side proxy; (f) `Permissions-Policy camera=()` and `geolocation=()` disable in-page camera capture and location for snag photos unless the header is changed.
- Offline: stored files are served from signed cross-origin URLs, which the service worker does not cache; only the board items (IndexedDB) are available offline for cloud boards, so a PDF-heavy workflow needs its own offline file cache.
- "No reference-product branding or assets" was written about the whiteboard reference product; applying the same rule to a construction-review reference product (feature names, icons, stamp artwork) is a reasonable reading but is not stated explicitly.
- There is no numeric bundle-size budget in the repository; the 228 KB initial transfer and the "heavy chunks are lazy and not precached" rule are the working constraints.

### Gaps
- The unit-test count could not be confirmed by running the suite (no `node_modules`); a literal count of `it(` lines gives 50 across four files, which differs from the 72 stated in `PROJECT_BRAIN.md:64` (parametrised tests may account for the difference).
- No stated browser-support matrix was found.

## 9. Gap analysis for the 13 target capabilities

### Takeaway
Three foundations are missing and gate most of the list: (A) a retained, vector-rendered PDF sheet item with a text layer; (B) per-sheet scale plus point-list geometry (polyline/polygon) with vertex editing; (C) cross-type item metadata (layer, status, subject, timestamps, custom fields) that the validation whitelist, database trigger and agent server all understand. The whiteboard engine, sync, roles, storage, export-to-SVG and agent server are solid bases; PDF annotation round-trip, review-session governance and OCR/symbol search are the largest pieces of new work.

### Cited Findings
Size key: S = under a day, M = 2–5 days, L = 1–3 weeks, XL = more. Sizes are estimates by the author of these notes from the code read, for one developer familiar with the codebase; they are not measured.

#### 1. PDF sheet as a first-class vector underlay — size L
- (a) Builds on: pdf.js already bundled and lazy-loaded with its worker (`src/board/importers.ts:123-127`); import pipeline that places pages inside a named frame (`:160-162`); private asset storage with signed URLs, per-board adoption and byte fetch (`src/board/assets.ts:100-113`, `:129-160`, `:180-191`); small-preview level-of-detail pattern (`src/board/items/ItemView.tsx:257-266`); the IFC item as precedent for a lazy heavy viewer inside an item that re-renders at the board's zoom and takes its own wheel events (`src/board/items/Blocks.tsx:92-115`, `src/board/ifc/IfcViewer.tsx:140-153`, `:275-294`); precache exclusion already matching `pdf` chunks (`vite.config.ts:21`); search hook `rawText` (`src/board/ui/Panels.tsx:31-46`).
- (b) Missing: the source PDF is not uploaded (`src/board/importers.ts:190-193`); pages are one-off JPEGs ≤2,400 px (`:141-145`); no page item type holding source, page index, size in points, rotation, label; no zoom-dependent (tiled) re-rendering — the world layer is CSS-scaled (`src/board/Canvas.tsx:111`), so a page must be re-rasterised per zoom level or drawn as vector; no text layer or selection; no `cMapUrl`/`standardFontDataUrl`/`wasmUrl` (`importers.ts:126`); 40-page cap (`:128`) and 50 MB cap (`:176`); export re-embeds a ≤2,200 px raster (`src/board/export.ts:89-102`); crowded-view painter and dashboard thumbnail know only `image` (`src/board/overview.ts:170-175`); no offline cache for stored files (`public/sw.js:53`).
- (c) To change: `src/board/types.ts` (new `pdf`/sheet item, unions), `src/board/validate.ts` (case + `TYPES`), `src/board/defaults.ts`, `src/board/importers.ts` (`importPdf`, upload original, drop/raise page cap), new renderer under `src/board/items/` plus `ItemView.tsx:343-357`, `src/board/overview.ts`, `src/board/export.ts`, `src/board/assets.ts` (`fileRefs`, `adoptAssets`), `src/board/ops.ts:187-196` (`repoint`), `src/board/ui/Panels.tsx` (search over page text), `vercel.json:3` and `public/` (self-hosted pdf.js resource folders), `supabase/functions/mcp/index.ts` (`describe`). No table change (jsonb); possibly raise the bucket size limit (`supabase/migrations/0001_init.sql:267-268`).
- (d) Reasoning: storing the file and a new item type is M; crisp-at-any-zoom rendering with a tile/level cache that survives phone canvas limits, a selectable text layer aligned under a CSS-scaled world, search integration, vector export and overview fallback push it to L.

#### 2. Scale calibration and measurement items — size L (XL with snap-to-PDF-vector, cut-outs and volume done robustly)
- (a) Builds on: continuous world coordinates and conversion helpers (`src/board/geometry.ts:47-48`); frame containment as the per-sheet scope (`src/board/ops.ts:20-29`, `:374-388`); per-frame field precedent `preset` (`src/board/types.ts:112`, `src/board/validate.ts:148-155`); ink as an existing relative point-list item (`src/board/types.ts:97-105`); connector caps incl. `bar`, midpoint label and label editor (`src/board/geometry.ts:234-258`, `src/board/items/ItemView.tsx:206-222`); geometry helpers `distToSegment`, `rotatePt`, `polyMid` (`src/board/geometry.ts:5-11`, `:171-184`, `:346-352`); Shift-constrain and snap guide rendering (`src/board/interaction.ts:526-533`, `src/board/Canvas.tsx:256-259`).
- (b) Missing: any unit/scale field or calibration UI (two points + known distance, or preset ratio); the page scale is an undocumented 1.2 units/pt (`src/board/importers.ts:150`); polyline/polygon item types and vertex handles (`src/board/Canvas.tsx:168`, `:188-217`); calculations (length, polylength, area with holes, perimeter, angle, count, volume = area × depth) and unit formatting; recomputation when a sheet's scale changes; resize semantics that keep true geometry (`src/board/interaction.ts:546-599` scales boxes and font sizes); snapping to drawing geometry (needs path extraction from the PDF operator list and a per-page spatial index — impossible on JPEG pages); multiple scales/viewports per sheet; exposure in CSV and the agent server.
- (c) To change: `types.ts`, `validate.ts`, `defaults.ts`, `geometry.ts` (measure maths, point snapping), `interaction.ts` (multi-click creation mode, vertex drag, new `Mode` variants at `:29-41`), `Canvas.tsx` overlay handles, `ItemView.tsx`, `overview.ts`, `export.ts`, `ui/Toolbar.tsx`, `ui/ContextBar.tsx`, `mcp/index.ts`. Scale stored on the sheet/frame item (jsonb) or in `boards.settings` (≤16 KB, `supabase/migrations/0002_hardening.sql:17`).
- (d) Reasoning: a new geometry family touches every renderer, hit-tester and exporter; calibration and the six basic measurements are L; vector snap depends on capability 1 and adds an extraction/indexing pipeline.

#### 3. Markups list panel — size M for a sortable/filterable list with CSV over existing fields; L with custom columns, XLSX, live legend and virtualisation for large boards
- (a) Builds on: panel framework and switch (`src/board/store.ts:11`, `src/board/ui/Panels.tsx:461-476`, `src/board/ui/kit.tsx:128-157`); list panels with jump-to-item (`Panels.tsx:48-53`, `:150-227`); `itemText` (`:25-46`); CSV export with formula neutralising and frame title column (`src/board/export.ts:294-311`); `by` and profile lookup pattern (`src/board/types.ts:31`, `Panels.tsx:330-338`); bulk edit helper `setStyle` (`src/board/ops.ts:390-396`); selection state shared with the canvas (`src/board/store.ts:49`).
- (b) Missing: subject, status, layer, measurement value, created/modified time, author display name on items (section 1); `updated_by` is not fetched and `created_at` does not exist (`src/board/sync.ts:61`, `supabase/migrations/0001_init.sql:59-68`); column definitions/custom columns; sorting, filtering, grouping, totals; virtualised rows (boards may hold 50,000 items); a bottom-docked wide table (current panels are side panels; page chrome at `src/pages/BoardPage.tsx:58-78`); XLSX writer (no such dependency in `package.json:16-29`); a legend item that recomputes from board content (table/chart items hold static data, `src/board/types.ts:158-166`, `:192-199`).
- (c) To change: new panel in `ui/Panels.tsx` (+ `PanelId`), `export.ts` (`exportCsv` generalised), `types.ts`/`validate.ts` (metadata, see 6), `sync.ts` (select `updated_by`), optional trigger change to stamp times into `data` (`0002_hardening.sql:51`), `boards.settings` for column config, `mcp/index.ts` (`describe`).
- (d) Reasoning: UI over the in-memory item map is straightforward; the cost is the metadata it must show (capability 6) and scale handling.

#### 4. Reusable tool presets — size M (per-user and per-board); L if a team/workspace entity with sharing is introduced
- (a) Builds on: per-user tool preferences persisted to localStorage (`src/board/store.ts:13-38`, `:106-112`); tool lock (`src/board/ui/Toolbar.tsx:50`); factories that accept style partials (`src/board/defaults.ts:46-86`); `setStyle` (`src/board/ops.ts:390-396`); `profiles.settings` and `boards.settings` jsonb (`supabase/migrations/0001_init.sql:9`, `:32`); code-defined templates as a list pattern (`src/board/templates.ts:6`, `:23`).
- (b) Missing: a preset record (name, item type, style, default subject/layer/status, optional geometry); palette UI, "save selection as tool", recents; cross-device sync (prefs are per browser); sharing — the schema has no team, organisation or workspace table, so "per team" needs a new table with RLS or an import/export file; 16 KB settings limits constrain storing many presets in jsonb (`supabase/migrations/0002_hardening.sql:17`, `:20`).
- (c) To change: `store.ts` (preset state), `ui/Toolbar.tsx`, new panel, `interaction.ts:657-673` (`newItem` from preset), optionally a new migration (`tool_sets`, membership, policies).
- (d) Reasoning: applying saved partials is small; persistence, sync and sharing semantics decide the size.

#### 5. Construction markup primitives — size L as a package (rectangular revision cloud S; leader callout M; dimension line M after capability 2; stamps with dynamic fields M; hatch fills S–M; count symbols S after capability 2)
- (a) Builds on: `shapePath` registry and the four places a shape kind is listed (`src/board/geometry.ts:262-313`, `src/board/defaults.ts:18-26`, `src/board/validate.ts:9`, `supabase/functions/mcp/index.ts:27`); existing `cloud` and `callout` kinds (`geometry.ts:303-310`); connector caps/dash/label and attachment to text items (`src/board/interaction.ts:43`, `:174-184`); groups to bind a text box and its leader (`src/board/ops.ts:255-262`); SVG rendering everywhere (patterns are expressible); image items for stamp artwork; `me` (id, name) available for dynamic fields (`src/board/store.ts:44`).
- (b) Missing: cloud with arc count proportional to perimeter and a polygon variant; a callout whose leader tip is an independent anchor (items have one box, `src/board/types.ts:18-33`); dimension item (extension lines, measured label, scale-aware); stamp definitions with field substitution (author, date/time, sheet) and a stamp library; `fill` accepts colours only (`src/board/validate.ts:11`, `:129`) so hatches need a new field plus `<pattern>` output in `ItemView.tsx`, `export.ts` and a canvas pattern in `overview.ts`; count marker with running totals.
- (c) To change: `geometry.ts`, `types.ts`, `validate.ts`, `defaults.ts`, `ItemView.tsx`, `overview.ts:104-113`, `export.ts:135-140`, `interaction.ts`, `ui/Toolbar.tsx`, `ui/ContextBar.tsx`, `mcp/index.ts:27`, `:140`.
- (d) Reasoning: each primitive is small alone but must be implemented in three renderers (DOM/SVG, overview canvas, export) plus validation and the agent schema; dimension and count wait on scale.

#### 6. Layers and statuses on items; per-item custom metadata — size M
- (a) Builds on: optional base fields and their validation (`src/board/types.ts:18-33`, `src/board/validate.ts:106-118`); `tags` on stickies/cards and `status` on cards (`types.ts:52`, `:151-154`); `comment.resolved` with canvas hiding as a visibility-filter precedent (`src/board/Canvas.tsx:23`) and a user-level "Comment pins shown/hidden" toggle (`src/board/ui/Chrome.tsx:141`); board settings for shared definitions (`types.ts:238-244`); the trigger already rewrites `data` server-side (`supabase/migrations/0002_hardening.sql:51`).
- (b) Missing: `layer`, `status`, `subject`, `meta` fields; layer registry (name, colour, order, visible, locked) and whether visibility is per user or shared; filtering in `computeVisible` (`Canvas.tsx:14-47`), overview hit-testing, marquee and select-all (`src/board/interaction.ts:431-443`, `src/board/ops.ts:250-253`), snapping candidates and export scope (`src/board/export.ts:205-225`); status model with allowed values/colours and a record of who changed it when; size bounds for custom metadata; server-stamped created/updated time and author in `data`.
- (c) To change: `types.ts`, `validate.ts`, `Canvas.tsx`, `overview.ts`, `interaction.ts`, `ops.ts`, `export.ts`, `ui/ContextBar.tsx`, new layers panel in `ui/Panels.tsx`, `mcp/index.ts:104-127`, `:344-368`, and a new migration altering `board_items_touch`.
- (d) Reasoning: fields are cheap in jsonb; the work is threading visibility/lock filters through every selection, render and export path and adding the panel UI.

#### 7. Overlay/compare two revisions of a sheet — size L
- (a) Builds on: stacked items with z-order and rotation (`src/board/ops.ts:283-308`); CSS blend already used for highlighter (`src/board/items/ItemView.tsx:166`); fetch→blob→`createImageBitmap`→canvas pattern that keeps canvases readable (`src/board/export.ts:89-102`, `src/board/overview.ts:35-47`); workers permitted by CSP (`vercel.json:10`); an existing cloud shape for marking results.
- (b) Missing: sheet identity/revision fields to pair sheets; tint/opacity on images (`src/board/types.ts:115-122` has neither); alignment by 2 or 3 picked points — items support translate, box scale and rotation only (`ItemView.tsx:338`), not an affine matrix, so a 3-point fit needs a matrix field or a re-rendered raster; pixel or vector differencing with tolerance, region clustering and automatic cloud creation; adequate raster resolution (current ≤2,400 px per page, `src/board/importers.ts:141`).
- (c) To change: new compare item/mode (`types.ts`, `validate.ts`, new renderer, `overview.ts`, `export.ts`), a diff worker under `src/board/`, `ui/` controls, and the page item from capability 1.
- (d) Reasoning: a tinted two-layer overlay with manual alignment is M; reliable differencing and auto-clouding on large sheets, plus dependence on capabilities 1 and 5, make it L.

#### 8. Sheet sets — size L (M for manual organisation alone)
- (a) Builds on: multi-page import into a frame with per-page alt text (`src/board/importers.ts:151`, `:160-162`); frames outline and presentation order (`src/board/store.ts:353-357`, `src/board/ui/Panels.tsx:174-191`, `src/board/ui/Chrome.tsx:371-397`); one-page-per-frame PDF export (`src/board/export.ts:268-273`); `fitBox` navigation (`src/board/store.ts:325-338`); pdf.js exposes page text and labels (not used today).
- (b) Missing: a sheet entity (number, title, revision, discipline, explicit order) — frame order is positional; one frame per page (import makes one frame for the whole file); title-block text extraction (needs the text layer or OCR for scans); bookmarks/page labels; internal links — rich-text links are `https?` only and open a new tab (`src/board/validate.ts:48-62`), and no item-to-frame link exists; detection of sheet references in page text with their positions to create hotspots; sets beyond 40 pages/50 MB (`importers.ts:128`, `:176`); a sheet navigator with thumbnails.
- (c) To change: `importers.ts`, `types.ts`/`validate.ts` (sheet fields, link/hotspot item or `link` field), `interaction.ts` (`activate` at `:47-55` to follow links), `ui/Panels.tsx` (sheets panel), `export.ts` (page order/labels), `mcp/index.ts`.
- (d) Reasoning: organisation and manual links are M; automatic number/title extraction and automatic cross-sheet hyperlinks depend on capability 1's text layer and heuristics per title-block layout.

#### 9. Review sessions — size L (XL including real annotated-PDF close-out and email invitations)
- (a) Builds on: live co-editing, presence, cursors, follow and summon (`src/board/sync.ts:392-454`, `:529-541`); roles, link join and RLS (`supabase/migrations/0001_init.sql:97-140`, `:223-238`); database-enforced comment authorship (`supabase/migrations/0002_hardening.sql:53-90`); creator id on items (`src/board/ops.ts:39`); shared timer in board settings (`src/board/ui/Panels.tsx:392-399`); version snapshots for before/after states (`src/board/sync.ts:631-651`); offline outbox for flaky connections (`:215-241`).
- (b) Missing: session and attendee tables; invitations (email not built, SMTP not configured — `PROJECT_BRAIN.md:72`, `:79`); a reviewer role limited to creating markups and editing only their own (editors can edit everything, commenters only comments — `0001_init.sql:225-238`); server-set `by` for all item types; append-only activity log (no events table; rows keep only the last `updated_by/updated_at`, `0001_init.sql:59-68`); enforced end time; finish step that freezes content and emits a record/flattened PDF; notifications; per-author filters (capability 3).
- (c) To change: new migration (sessions, attendees, `board_events`, trigger additions in `board_items_touch`, RLS), `board_role`/policies for the new role, `src/board/types.ts:213` (`Role`), `src/board/store.ts:126-127`, `:146-157` (permission checks), `sync.ts`, new session panel and activity panel in `ui/`, `export.ts` (report), `mcp/index.ts` (role mapping at `:61-75`).
- (d) Reasoning: mostly schema, trigger and policy work with security review, plus UI; close-out to PDF with real annotations is capability 11.

#### 10. Snag/punch list items — size M on top of capabilities 3 and 6; L standalone with offline photo capture
- (a) Builds on: `card` item with title, description, status, assignee, due, tags, coloured status chip and editor (`src/board/types.ts:147-156`, `src/board/items/Blocks.tsx:119-149`); cards in CSV and in agent tools (`src/board/export.ts:303`, `supabase/functions/mcp/index.ts:142`, `:361`); image upload with previews (`src/board/importers.ts:177-189`); touch/foldable support and offline item edits (`playwright.config.ts:17-18`, `src/board/sync.ts:252-253`); kanban template (`src/board/templates.ts:25`).
- (b) Missing: a pin-style snag item placed on a sheet with an auto-number; enumerated status workflow and colours (status is free text ≤80 chars, `src/board/validate.ts:178`); assignee as a board member (free text today; no member picker); photo attachments on the item (cards hold no files; `fileRefs` covers image/ifc/file only, `src/board/assets.ts:130`); due-date reminders/notifications; list and filters (capability 3); report export with photos per assignee/status; offline photo attach — cloud boards refuse file import offline (`src/board/importers.ts:168`); in-page camera is disabled by `Permissions-Policy camera=()` (`vercel.json:14`); status history.
- (c) To change: `types.ts`, `validate.ts`, `defaults.ts`, new item view, `assets.ts:129-160`, `ops.ts:187-196`, `importers.ts`, `export.ts` (report page), `ui/` (form, list), `mcp/index.ts`; optionally `vercel.json:14`.
- (d) Reasoning: the card already models most fields; attachments, numbering and reporting are the new parts, and an offline upload queue is the expensive option.

#### 11. Export to PDF with standard annotations, and import of annotations — size XL for round-trip; L for export of a core subset
- (a) Builds on: per-item vector output (`src/board/export.ts:104-200`), shape/connector/ink path generators (`src/board/geometry.ts:186-258`, `:262-313`, `src/board/items/ItemView.tsx:146-161`); author id, comment threads with timestamps (`src/board/types.ts:31`, `:176-182`); pdf.js can read annotations (API reference) though the app does not call it.
- (b) Missing: any PDF writer (dependencies in `package.json:16-29` contain none; current PDF export is `window.print()`, `src/board/export.ts:267-287`); the source PDF to append annotations to (capability 1); a mapping from items to annotation types with appearance streams, including world→page coordinate transforms (inverse of the 1.2 factor, y-flip, page rotation/crop); ink is drawn as a variable-width outline, whereas a standard ink annotation carries a centre line and one width, so appearance must be generated to keep fidelity; metadata fields the annotation dictionaries expect (subject, modified date, status, layer — capability 6; measurement dictionaries — capability 2); handling of items outside any page, embeds, tables, charts; the reverse parser from annotation dictionaries to items and stable ids for round-trip.
- (c) To change: new `src/board/pdf/` writer/reader modules, `export.ts`, `importers.ts`, `ui/Panels.tsx` (export options), likely a new dependency (pure JS is compatible with the CSP).
- (d) Reasoning: correct, viewer-compatible annotation dictionaries and appearance streams for a dozen types, plus import, is the single largest item; a subset (rectangle, ellipse, line, polyline/polygon, ink, free text, note) is L once capabilities 1 and 6 exist.

#### 12. AI assistance through the agent server — size M to extend the tool surface; L for an in-app assistant; auto-takeoff/QA quality is open-ended (XL)
- (a) Builds on: nine working tools with auth, role checks, rate limiting and live propagation (`supabase/functions/mcp/index.ts:34-75`, `:211-471`, `src/board/sync.ts:512-519`); outline/search views for text (`index.ts:248-259`, `:461-469`); diagram auto-layout precedent for server-side geometry (`:407-444`); attribution of agent items and comments (`:129`, `:156`).
- (b) Missing: any way for an agent to see a drawing (no asset URL, image, render or page-text tool; `describe` hides `asset:` sources, `index.ts:120`); creation of ink/polyline/measurement/cloud/stamp items (`:137-157`); scale to turn geometry into quantities; layer/status fields; paging beyond 2,000 items (`:260-261`) and a cheaper read path than loading the whole board per call (`:77-86`); per-board token scope (`docs/AUDIT.md:68`); an in-app assistant (no model call, key handling or UI in `src/`; "built-in AI" not built, `PROJECT_BRAIN.md:71`); server-side item validation matching `normalizeItem`.
- (c) To change: `supabase/functions/mcp/index.ts` (new tools such as signed asset URL, sheet text, sheet image; new item builders), a possible new edge function as model proxy, `supabase/migrations` (token scope column), `src/board/ui/` for an assistant panel.
- (d) Reasoning: tool additions follow an established pattern; useful takeoff or QA additionally needs capabilities 1, 2 and 13 and evaluation effort that cannot be sized from code.

#### 13. OCR and symbol search/count on scanned drawings — size L for OCR with a searchable layer; XL including robust symbol search and counting
- (a) Builds on: page rasters retrievable as bytes (`src/board/assets.ts:180-191`); worker and wasm allowances in the CSP and the self-hosted wasm pattern with copy script and cache headers (`vercel.json:10`, `:19`, `scripts/copy-wasm.mjs:1-12`); board search (`src/board/ui/Panels.tsx:195-227`); canvas/bitmap utilities.
- (b) Missing: an OCR engine and its language data, vendored same-origin and excluded from the SPA rewrite (`vercel.json:3`); source resolution — large sheets are stored at roughly 50–75 dpi (section 2 inference), too coarse for small drawing text, so OCR must run on a re-render of the retained PDF (capability 1) or the original scan; storage for recognised words with positions (1 MB per item limit, `supabase/migrations/0002_hardening.sql:13-14`, argues for a side asset rather than item jsonb); an invisible text layer and search integration; symbol search (template matching across scale/rotation in a worker) and conversion of hits to count items (capability 2); progress/cancel UI for long jobs on phones.
- (c) To change: new worker modules under `src/board/`, `public/` assets and `vercel.json`, `vite.config.ts:21` (keep the chunk out of the precache), `importers.ts`, page item renderer, `ui/Panels.tsx`, optionally an edge function for server-side recognition.
- (d) Reasoning: integrating a wasm OCR engine under the CSP with acceptable speed and memory on mobile is L; dependable symbol matching on noisy scans is a research-grade addition.

### Inferences
- Dependency order suggested by the code: capability 6 (metadata) and capability 1 (retained vector PDF) first; then 2 (scale and point geometry); then 3, 5, 8, 10; then 7, 9, 11; 12 and 13 can grow alongside once 1 and 2 exist.
- Every capability that adds an item type pays a fixed "three renderers + validation + export + agent schema" cost (section 1 inference); consolidating new construction items onto one generic point-list/annotation item type would reduce that cost.
- Whole-item last-write-wins is acceptable for geometry but will lose concurrent status/metadata edits on the same item during busy review sessions unless metadata updates are merged field-wise server-side.
- All features must also work, or be explicitly disabled, on device-only boards, which have no server, roles, or storage bucket (`src/board/sync.ts:116-153`).

### Gaps
- Size estimates are judgement, not measurement; no prototype was built.
- Library choices for PDF writing, OCR and XLSX were not evaluated (out of scope; only CSP compatibility constraints were derived).
- Edge-function CPU/time/memory limits for server-side PDF or OCR work were not researched.
- Whether pdf.js's SVG/vector paths can be extracted at acceptable speed for snap indexing on large sheets was not tested.
