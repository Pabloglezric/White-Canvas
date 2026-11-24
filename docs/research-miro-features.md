# Miro feature inventory (researched 2026-11-24)

Scope: what Miro does today, for building functional equivalents in White Canvas. Primary sources only unless flagged. **Unverified** = not confirmed on a Miro-owned page in this pass.

## 1. Canvas and navigation

- **Infinite canvas**, four toolbars: Board bar (top-left, main menu), Creation bar (left), Collaboration bar (top-right), Canvas controls (bottom-right: frames/layers, zoom, help). Undo/redo buttons sit under the Creation bar.
- **Input modes** (per user, Preferences > Mouse or trackpad; default *Auto-switch*):
  - Mouse: wheel zooms; right-drag, Space+drag or middle-drag pans; left-drag marquee-selects.
  - Trackpad: two-finger slide pans, pinch zooms, Ctrl/Cmd+wheel zooms.
  - Touch: detected automatically. Drag pans, pinch zooms, long-press+drag multi-selects.
  - V = select, H = hand.
- **Zoom menu**: full screen, minimap (M), grid (line or dot, G toggles), snap to grid (Ctrl/Cmd held suspends), object dimensions, fit to screen, zoom %.
- **Alignment**: smart guides (alignment + equal spacing), align/distribute, auto layout, bring forward/back.
- **Grouping**: Ctrl/Cmd+G; double-click edits inside a group. Cannot group across frames or inside tables.
- **Locking**: lock/unlock (Ctrl+Shift+L); *protected lock* (owner/co-owner only, paid).
- **Layers**: named layers with show/hide and lock; new content joins the active layer.
- **Frames**: F; rename, resize, colour, hide (paid), link-to-frame, export; nest without limit (Ctrl/Cmd-drag avoids nesting); frames panel reorders, bulk-selects, presents. Preset sizes: unverified.
- Also: command palette (Ctrl/Cmd+K), find and replace, board background colour, start view, accessibility checker, reduce motion.

Sources: [Toolbars](https://help.miro.com/hc/en-us/articles/360017730553-Toolbars) · [Mouse/trackpad/touch](https://help.miro.com/hc/en-us/articles/360017731053-Using-Miro-with-a-mouse-trackpad-or-touchscreen) · [Diagramming](https://help.miro.com/hc/en-us/articles/4403634496402-Miro-for-mapping-diagramming) · [Layers](https://help.miro.com/hc/en-us/articles/20258488000786-Layers) · [Locking](https://help.miro.com/hc/en-us/articles/4408887253778-Locking-content-on-the-board) · [Frames](https://help.miro.com/hc/en-us/articles/360018261813-Frames)

## 2. Creation toolbar

Default pinned tools: Select/Hand, Templates, Sticky notes, Text, Shapes and lines, Pen, Frame, Stickers/Emoji/GIFs, Comment, Tools-Media-Integrations (+). Tools can be reordered and unpinned per user; keys 1–9 pick tools by position. Tools are one-shot except pen, eraser, lasso, comment. A Sidekick (AI) button sits above the bar.

| Tool | Detail |
|---|---|
| Sticky notes | Square or rectangle; 16 colours; size, alignment, bold/italic/underline, auto font size; up to 8 tags; emoji reactions; author label toggle; ~3,000 characters. **Bulk mode**: type, Enter = next note. Paste spreadsheet cells as stickies (max 5,000 cells, 50 rows × 100 cols). |
| Text | Rich text, lists, links, copy/paste style (Ctrl+Alt+C/V). |
| Shapes | Free packs: Basic, Callouts, Connectors, Flowchart. Business+: AWS, Azure, BPMN, Cisco, Cloudflare, DFD, Electrical, ERD, Google Cloud, Kubernetes, Process Engineering, Salesforce, Tech logos, UML, VSM, VMware. Custom shapes. |
| Connection lines | Straight, orthogonal (elbow), curved; thickness, colour, arrowheads either end; multiple draggable captions (horizontal or along line); line jumps (straight/elbow only); snap to side or centre points (Ctrl/Cmd disables); click a blue dot to spawn a linked copy. Dash styles and full cap list: unverified. |
| Pen | Pen, highlighter, eraser (whole stroke), precision eraser, lasso, **smart drawing** (sketch becomes shape, sticky or line); 3 presets per tool. |
| Cards | D; title, description, assignee, dates, status, tags; CSV export. |
| Formats | Docs (export PDF/Markdown), Tables (Timeline, Kanban, Journey views; Excel/CSV import), Timeline, Kanban, Slides, Diagrams, Prototypes, Data tables (Business+). |
| Other | Mind map (Tab = child), Grid, Org chart, Code block (18 languages incl. Mermaid), Wireframing library, Images and icons, native Mermaid, Draw.io, PlantUML, Estimation, Dependencies. Charts: unverified. |

Sources: [Sticky notes](https://help.miro.com/hc/en-us/articles/360017572054-Sticky-notes) · [Connection lines](https://help.miro.com/hc/en-us/articles/360017730733-Connection-lines) · [Pen](https://help.miro.com/hc/en-us/articles/360017730573-Pen) · [Shapes](https://help.miro.com/hc/en-us/articles/360017730713-Shapes) · [Tables](https://help.miro.com/hc/en-us/articles/22760922335506-Tables) · [Docs](https://help.miro.com/hc/en-us/articles/20164660410898-Docs-in-Miro) · [Code block](https://help.miro.com/hc/en-us/articles/8366822305938-Code-block) · [Mind map](https://help.miro.com/hc/en-us/articles/360017730753-Mind-map)

## 3. Import and embed

- **Upload formats**: images bmp, gif, svg (flattened), jpg, png, psd, heic/heif, pdf; sheets xls, xlsx, csv, ods; docs doc, docx, odt, rtf; slides ppt, pptx, odp; diagrams mmd, mermaid; video MP4, MOV, WebM. **Max 30 MB**, images max 8192×4096 px. Multi-page PDFs can be paged or split. Drag-drop, paste, URL, or Drive/Dropbox/Box/OneDrive pickers.
- **URL paste**: a web URL becomes a *preview* item from Open Graph data; media URLs become *embed* items.
- **Embeds use Embedly** (not Iframely) for "hundreds of providers" (YouTube, Vimeo, etc.). API embed item fields: `url`, `previewUrl`, `mode` (inline or modal), width, height.
- **Paste iFrame code** is a board action that accepts raw `<iframe>` snippets.
- **Integration embeds** (Starter+): Box, Figma, Google Docs/Sheets/Slides, Looker, Excel/PowerPoint/Word, Azure, Power BI, with focus mode and bookmark view.
- **Outbound**: Live Embed iframe (`/app/live-embed/<id>/` with `embedMode`, `moveToViewport`, `moveToWidget`, `autoplay`) plus an oEmbed endpoint.
- **Marketplace**: "250+ integrations"; two-way sync cards for Jira, Asana, Linear, ClickUp, Azure DevOps.
- **3D / BIM / IFC**: no native 3D item and no IFC upload. A community idea asks for glTF. Third-party routes: an Autodesk app (import 3D files, capture view angles as widgets) and Speckle models via pasted iframe code. Both unverified against Miro pages.

Sources: [Supported formats](https://help.miro.com/hc/en-us/articles/360017731613-Supported-file-formats) · [Embed item](https://developers.miro.com/docs/embed-2) · [Board items](https://developers.miro.com/docs/board-items) · [Embed integrations](https://help.miro.com/hc/en-us/articles/360017730993-Embed-integrations-on-a-Miro-board) · [Embed a Miro board](https://help.miro.com/hc/en-us/articles/360016335640-Embed-a-Miro-board) · [Live Embed](https://developers.miro.com/docs/miro-live-embed-with-a-direct-link) · [Speckle tutorial](https://speckle.systems/tutorials/embed-3d-models-in-miro/)

## 4. Collaboration and facilitation

- Live named cursors (toggle); People list: follow a user, bring one user to me, bring everyone to me.
- **Presentation mode**: frames or Slides as a deck; presenter can "go to canvas" and return, locking the audience back in; hidden frames are skipped.
- **Timer** (visual + chime), **Voting** (not on mobile; settings unverified), **Private mode** (hides sticky content, optional anonymous names, 5-second reveal), **Reactions**, **Visual notes**, Breakout frames (beta), Chat.
- **Video calls** (beta) with live transcript; **Talktrack** = recorded walkthrough pinned to the board, with timeline emoji reactions.
- **Comments**: threads, @mentions, resolve, follow thread, Shift+C hides; activity bell merges comments, Talktracks and team notifications.
- **Roles**: owner (one), co-owner (Business+), editor, commenter, viewer.
- **Sharing**: email invite; team and company access (none/view/comment/edit); public link (view on Free; comment/edit from Starter); password (paid); guest links (Business, expire after 30 days); content settings restrict copy/export.
- People types: member (paid seat), guest (signed in, free), visitor (anonymous via link).

Sources: [Presentation mode](https://help.miro.com/hc/en-us/articles/34307373858450-Presentation-mode) · [Private mode](https://help.miro.com/hc/en-us/articles/9794413310482-Private-mode) · [Talktrack](https://help.miro.com/hc/en-us/articles/35405180333202-Talktrack) · [Access rights](https://help.miro.com/hc/en-us/articles/360017572194-Board-access-rights) · [Sharing](https://help.miro.com/hc/en-us/articles/360017730813-Sharing-boards-and-inviting-collaborators)

## 5. Board management and plans

- Dashboard with teams, **Spaces** (sections inside, overview posts), starred boards, 7,000+ templates, custom templates, blueprints, trash/restore.
- **Export**: image (JPG), PDF (Small or Vector; links clickable only in Vector), SVG, CSV (cards, tables), Docs to PDF/Markdown, board backup file. No PPT or PNG export.
- Board history and versions exist on paid plans (details unverified).

| | Free | Starter $8 | Business $20 | Enterprise |
|---|---|---|---|---|
| Editable boards | **3 most recent**, rest view-only | Unlimited | Unlimited | Unlimited |
| Private boards | No, all visible to team | Yes | Yes | Yes |
| Visitors | View only | Edit, no sign-in | Edit | Edit |
| Guests | No | View/comment | Unlimited, edit | Edit |
| AI credits/month | 10 | 25/member | 50/member | 2,500+ pooled |
| MCP calls/day | 100 | 500 | 2,000 | 10,000 |
| Shape packs | Basic | Basic | All | All |

Prices are per member per month, billed yearly. Free also lacks: timer, voting, video chat, hi-res export, backup, custom templates, board versions, spaces, password links. Business adds co-owners, data tables, prototypes, custom Sidekicks. Enterprise starts at 30 members. The Starter guest cell and SSO on Business come from third-party summaries of Miro's comparison table: unverified.

Sources: [Pricing](https://miro.com/pricing/) · [Free plan](https://help.miro.com/hc/en-us/articles/360017730373-Free-Plan) · [Export](https://help.miro.com/hc/en-us/articles/360017572754-How-to-export-your-board)

## 6. AI, MCP and APIs

- **Miro AI**: Create with AI (stickies, images, diagrams, mind maps, docs, tables, slides, prototypes), summarise, cluster by keyword or sentiment, translate (17 languages), Catch up, image-to-diagram. **Sidekicks** = agents (custom on Business); **Flows** = chained AI steps on canvas; model picker (GPT, Claude, Gemini). About 1 credit per action.
- **MCP server** (`https://mcp.miro.com/`, OAuth 2.1). The canvas is exchanged as an **SVG dialect**:
  - Canvas: `canvas_get_canvas_composer_skill`, `canvas_load_format_skill`, `canvas_search`, `canvas_read_as_svg`, `canvas_create_from_svg`, `canvas_update_from_svg` (diff by `data-miro-id`), `canvas_get_html_upload_url`.
  - Boards: `board_create`, `board_create_format` (table, timeline, kanban, document, diagram, prototype, slides, activities, embed), `board_show`, `board_move`, `board_restore`, `board_update_metadata`, `content_search`.
  - Sharing, spaces/sections, comments (list, create, reply, resolve), images (get data, upload, create), `get_brand_context`, user lookup.
- **REST API v2** item types: `app_card`, `card`, `data_table_format`, `doc_format`, `document`, `embed`, `frame`, `image`, `shape`, `sticky_note`, `text`, plus connectors, tags, groups; mind map experimental. Not creatable: code block, emoji, kanban, mockup, pen stroke, table.
- **Web SDK**: `miro.board.create*`, `get`, `select`, `group`, z-order calls, per-item `setMetadata`, `viewport`, `ui` (panels, modals), realtime `events`, `storage`, `timer`, `collaboration`, `notifications`, `getOnlineUsers`.

Sources: [AI overview](https://help.miro.com/hc/en-us/articles/28765406244498) · [Model selection](https://help.miro.com/hc/en-us/articles/29484232754578-Select-Your-Own-Model-Beta) · [MCP tools](https://developers.miro.com/docs/miro-mcp-tools) · [Get items](https://developers.miro.com/reference/get-items-1) · [Web SDK board](https://developers.miro.com/docs/websdk-reference-board)

## 7. Mobile, tablet, shortcuts

- **Phone app** (iOS 16+, Android 7+): opens **view-only**; select then *Edit*. Has text, shapes, stickies (tags, emoji), frames, comments, uploads, connectors, pen, highlighter, lasso, stickies capture (camera), follow/bring-to-me, Talktrack playback, Slides remote, AI, dark mode, push notifications. **Missing**: templates, export, presentation mode, video chat, voting, starred boards. Mobile browser: view and comment only.
- **Tablet app** (iPadOS 15+, Android 7+, Windows 10): stylus auto-detected (Apple Pencil, S Pen, Surface Pen) with "only draw with stylus" so fingers pan; palm rejection on iPad and Samsung; smart drawing. Limits: JPG-only device upload, no toolbar or frame reordering on touch, iPad memory cap of 25% RAM. Handwriting-to-text: unverified.
- Gestures: one-finger pan, pinch zoom, double-tap zoom, long-press move, long-press+drag multi-select.

| Action | Key | Action | Key |
|---|---|---|---|
| Select / Hand | V / H | Undo / Redo | Ctrl+Z / Ctrl+Shift+Z |
| Text | T | Copy / Cut / Paste | Ctrl+C / X / V |
| Sticky | N | Duplicate | Ctrl+D, Alt+drag |
| Shapes | S | Select all | Ctrl+A |
| Rectangle / Oval | R / O | Group / Ungroup | Ctrl+G / Ctrl+Shift+G |
| Line | L | Lock | Ctrl+Shift+L |
| Card | D | Front / Back | PgUp / PgDn |
| Pen / Eraser | P / E | Forward / Backward | Shift+PgUp / PgDn |
| Comment | C | Zoom in / out | Ctrl + / − |
| Frame | F | Zoom 100% / fit / selection | Ctrl+0 / Alt+1 / Alt+2 |
| Minimap / Grid | M / G | Pan | Space+drag, arrows |
| Command palette | Ctrl+K | Find | Ctrl+F |
| Add link | Alt+Ctrl+K | Bold / Italic / Underline | Ctrl+B / I / U |
| Edit / Exit | Enter / Esc | Next object | Tab |
| Delete | Backspace | Hide comments | Shift+C |
| Shortcut list | F1 | Hide context menu | hold Shift |

Mac uses Cmd for Ctrl and Option for Alt.

Sources: [Mobile app](https://help.miro.com/hc/en-us/articles/360017572834-Mobile-app) · [Tablet app](https://help.miro.com/hc/en-us/articles/360017731633-Tablet-app) · [Shortcuts](https://help.miro.com/hc/en-us/articles/360017731033-Shortcuts-and-hotkeys)
