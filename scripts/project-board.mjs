// Builds the White Canvas project board as a .whitecanvas.json file that can be dropped onto any board.
// Usage: node scripts/project-board.mjs <out.json> [--graph graphify-out/graph.json] [--shots dir]
// The content below is the project plan; edit it here and rebuild.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'

const args = process.argv.slice(2)
const out = args[0] || 'project-board.whitecanvas.json'
const opt = (k) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : undefined }
const graphPath = opt('--graph'), shotsDir = opt('--shots')

const C = { decision: '#f76b15', question: '#6e56cf', tool: '#0090ff', done: '#30a46c', risk: '#e5484d', method: '#1c1e23' }
const items = []
let n = 0, z = 0
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const html = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>')
const add = (it) => { const full = { id: `pb-${++n}`, rot: 0, z: ++z, rev: 0, ...it }; items.push(full); return full }
const frame = (title, x, y, w, h, fill = '#ffffff') => add({ type: 'frame', title, x, y, w, h, fill })
const text = (f, s, x, y, w, fontSize = 20, extra = {}) => add({ type: 'text', parent: f.id, x: f.x + x, y: f.y + y, w, h: fontSize * 1.6, html: html(s), fontSize, align: 'left', ...extra })
const sticky = (f, s, x, y, fill = '#fff2a8', w = 220, h = 220, fontSize = 16) => add({ type: 'sticky', parent: f.id, x: f.x + x, y: f.y + y, w, h, html: html(s), fill, fontSize, align: 'center', valign: 'middle' })
const card = (f, c, x, y, w = 400, h = 200) => add({ type: 'card', parent: f.id, x: f.x + x, y: f.y + y, w, h, title: c.title, desc: c.est ? `Estimate: ${c.est}\n${c.desc}` : c.desc, status: c.status, assignee: c.who, due: c.due, tags: c.est ? [...(c.tags || []), c.est] : c.tags, fill: c.fill })
const shape = (f, s, x, y, w, h, fill, extra = {}) => add({ type: 'shape', parent: f.id, kind: 'round', x: f.x + x, y: f.y + y, w, h, html: html(s), fill, stroke: '#1c1e23', strokeW: 1.5, fontSize: 15, align: 'center', valign: 'middle', ...extra })
const link = (a, b, extra = {}) => add({ type: 'connector', z: Math.min(a.z, b.z) - 0.5, x: 0, y: 0, w: 0, h: 0, a: { item: a.id, x: a.x + a.w / 2, y: a.y + a.h / 2 }, b: { item: b.id, x: b.x + b.w / 2, y: b.y + b.h / 2 }, route: 'curve', capA: 'none', capB: 'arrow', stroke: '#6b6f7a', strokeW: 1.5, ...extra })
const grid = (f, list, draw, { x0 = 30, y0 = 70, cols = 3, cw = 420, rh = 210 } = {}) => list.forEach((c, i) => draw(f, c, x0 + (i % cols) * cw, y0 + Math.floor(i / cols) * rh))

// ---------- 1. Start here ----------
const start = frame('1 · Start here', 0, 0, 1000, 900)
text(start, '**White Canvas project board**', 30, 60, 900, 40)
text(start, 'One place to see, track and mark up the whole build. Claude keeps it current; you comment anywhere.', 30, 130, 900, 20)
sticky(start, '**How to talk to Claude here**\nPin a comment on anything, or drop a sticky in frame 4. Claude reads the board at the start of each session and replies on the same thread.', 30, 230, '#a8dcff', 290, 250)
sticky(start, '**Orange = a decision waiting for you**\nEach card gives the options and what Claude recommends. Change its status to your choice.', 345, 230, '#ffd98a', 290, 250)
sticky(start, '**Blue = a tool to build**\nEach has an estimate, a phase and what it does better than Bluebeam. Add your own ideas as stickies beside it.', 660, 230, '#b9c8ff', 290, 250)
text(start, '**Progress so far**', 30, 505, 900, 22)
grid(start, [
  { title: 'Bluebeam research finished', desc: 'How it works, every capability, its weak points, the web technology to beat it. Report and notes are in the repository.', status: 'Done', due: '2026-11-25', tags: ['research'], fill: C.done },
  { title: 'Graphify tested on the code', desc: '704 symbols and 2,587 connections mapped in 3.6 seconds, on the machine, at no AI cost. See frame 8.', status: 'Done', due: '2026-11-25', tags: ['method'], fill: C.done },
  { title: 'Project board, first version', desc: 'This board. Live since 25 Nov: Claude now reads and updates it directly with an agent token (see D2).', status: 'Live', due: '2026-11-25', tags: ['method'], fill: C.done },
], card, { y0: 560, cols: 3, cw: 320, rh: 0 })
items.filter((i) => i.parent === start.id && i.type === 'card').forEach((c) => { c.w = 300; c.h = 300 })

// ---------- 2. Decisions due ----------
// Each decision gets a number (D1, D2, …) from its place in this list, so it can be named in a message.
// Add new decisions at the end: a number, once given, must keep meaning the same decision.
const dec = frame('2 · Decisions due', 1100, 0, 1330, 900, '#fff7ed')
grid(dec, [
  { title: 'Relationship with Bluebeam', desc: 'You decided: no reliance on Bluebeam. We build our own, read and write standard PDF files, and never sign up for their developer programme.', status: 'Decided', due: '2026-11-25', tags: ['direction'], fill: C.done },
  { title: 'Give Claude a board token', desc: 'Working. Claude changed this card through the live board on 25 Nov, so the token is proven.\nWhat happened: the token was saved on the "white-canvas" environment, but sessions start on "Default", so it never arrived. It is now saved on "Default" as well.', status: 'Done', who: 'You', due: '2026-11-25', tags: ['access'], fill: C.done },
  { title: 'What to build first', desc: 'You said: start with stage 1. Claude reads that as Phase 1 · Foundations (option A): item layers, status and custom fields first, then sharp vector PDF sheets.\nIf you meant Phase 0 (the three short trials), say so here and Claude switches.', status: 'Decided: A', who: 'You', due: '2026-11-25', tags: ['roadmap'], fill: C.done },
  { title: 'Who is the first user?', desc: 'Sets the order after the foundations.\nA: design reviewer on a Mac: review sessions first.\nB: site manager on a phone: snag lists first.\nC: estimator: measurement and counts first.', status: 'Needs you', who: 'You', due: '2026-11-28', tags: ['roadmap'], fill: C.decision },
  { title: 'Inception window: pictures first?', desc: 'You decided: screenshots are fine. Claude refreshes them in frame 7 after each change and you comment on them. A live window stays as an idea in frame 5.', status: 'Decided', who: 'You', due: '2026-11-25', tags: ['method'], fill: C.done },
  { title: 'Graphify always on?', desc: 'You decided: yes. Claude rebuilds the code map at the start of each session and after each merge, and redraws frame 8. Nothing is stored in the repository.', status: 'Decided: yes', who: 'You', due: '2026-11-25', tags: ['method'], fill: C.done },
  { title: 'Merge the research pull request', desc: 'Done on 25 Nov. Pull request 7 is merged and its production deploy is live, so pull requests 1 to 7 are all in production. That deploy also brought the fix that lets cards show their whole text.', status: 'Done', who: 'You', due: '2026-11-25', tags: ['housekeeping'], fill: C.done },
  { title: 'Paid database plan', desc: 'The free plan pauses when idle and keeps no point-in-time backups. Needed before review sessions are offered as a record. Not urgent.', status: 'Later', who: 'You', tags: ['cost', 'before phase 4'], fill: C.decision },
  { title: 'Merge stage 1, part 1 (pull request 8)', desc: 'Layers, status, subject and custom fields on every item. 94 unit tests and 32 end-to-end tests pass.\nMerging puts it in production. After that Claude updates the board server so it can use the new details too.\nSay "merge D9" and Claude does both.', status: 'Needs you', who: 'You', due: '2026-11-27', tags: ['stage 1'], fill: C.decision },
].map((c, i) => ({ ...c, title: `D${i + 1} · ${c.title}` })), card, { cols: 3, cw: 430, rh: 270 })
items.filter((i) => i.parent === dec.id && i.type === 'card').forEach((c) => { c.h = 250 })

// ---------- 3. Questions from Claude ----------
const q = frame('3 · Questions from Claude to you', 2530, 0, 950, 900, '#f6f3ff')
grid(q, [
  'Which drawings do you handle most: PDFs exported from CAD, or scans? What sheet sizes (A1, A0)?',
  'Can you share two or three real drawing sets to test with? Real files find problems that samples hide.',
  'Metric only? Which scales do you meet most (1:50, 1:100, 1:200)?',
  'Do you need to hand marked-up PDFs back to people who use Bluebeam or Acrobat?',
  'Which devices matter most to you day to day: the Fold, a tablet, a Mac, a Windows PC?',
  'Who else will join a board: how many people, and are some outside your company?',
  'How important is linking a mark on a 2D sheet to the same element in the 3D model?',
  'Is there a Bluebeam habit you personally would miss most? That goes to the top of the list.',
].map((t, i) => ({ t: `**Q${i + 1}**\n${t}` })), (f, c, x, y) => sticky(f, c.t, x, y, '#e3c4ff', 280, 220, 15), { cols: 3, cw: 300, rh: 240 })

// ---------- 4. Your questions and ideas ----------
const you = frame('4 · Your questions and ideas', 3580, 0, 950, 900, '#f0fdf4')
text(you, 'Drop stickies here. Anything: a question, an idea for a tool, something that annoys you in the app.', 30, 60, 880, 18)
sticky(you, 'Example\n"The toolbar hides the drawing on my phone."', 30, 150, '#c4eea6', 260, 200, 15)
sticky(you, 'Example\n"Can a snag carry a photo and a due date?"', 320, 150, '#c4eea6', 260, 200, 15)
sticky(you, 'Yours…', 610, 150, '#ffffff', 260, 200, 15)

// ---------- 5. Tools to build ----------
const tools = frame('5 · Tools to build: order, estimates and how each beats Bluebeam', 0, 1000, 3430, 1560)
const phases = [
  ['Phase 0 · Decide and test', 'Short trials that remove the big unknowns', [
    ['Write a real PDF with markups', 'Trial: save marks into a PDF that other viewers can read and edit.', '1–2 days'],
    ['Sharp PDF on a phone', 'Trial: keep an A1 sheet crisp at 8× zoom on iOS and Android.', '1–2 days'],
    ['One markup item for all shapes', 'Design: a single point-based item for clouds, lines, areas, counts and dimensions.', '1–2 days'],
  ]],
  ['Phase 1 · Foundations', 'Everything else stands on these', [
    ['Layers, status and custom fields', 'First part built on 25 Nov, waiting in pull request 8 (see D9).\nBuilt: any item can carry a layer, a status, a subject and your own fields. A tag button on the selection sets them. A Layers panel in the menu manages the lists. The eye hides a layer for you only.\nNot built yet: locking a layer, a record of who changed a status, layers carried across a paste between two boards.\nBeats Bluebeam: works on every device, not only on Windows.', '2–5 days', 'In review'],
    ['Vector PDF sheets', 'Keep the original PDF; draw it sharp at any zoom; select and search its text.\nToday pages become blurry pictures and the file is thrown away.', '1–3 weeks'],
  ]],
  ['Phase 2 · Measure and mark', 'The core drawing-review tools', [
    ['Scale and measurement', 'Set a scale per sheet; measure length, area with cut-outs, perimeter, count, angle, volume.\nBeats Bluebeam: full set in the browser and on a phone.', '1–3 weeks'],
    ['Construction markups', 'Revision cloud, callout with leader, dimension line, stamps with date and name, hatch fills, count symbols.', '1–3 weeks'],
  ]],
  ['Phase 3 · Lists and sets', 'Turn marks into trackable work', [
    ['Markups list', 'A sortable, filterable table of every mark with status, author, layer and measured value. Export to CSV.', '2–5 days'],
    ['Tool presets', 'Save a styled tool once, reuse it everywhere, share it with the team.', '2–5 days'],
    ['Sheet sets and automatic links', 'A multi-page PDF becomes ordered sheets; sheet numbers are read and cross-linked for you.', '1–3 weeks'],
    ['Snag list', 'Snags with photo, assignee, due date and status, plus a report.\nBeats Bluebeam: it removed its field tools in 2024.', '2–5 days'],
  ]],
  ['Phase 4 · Review and exchange', 'Work with other people and other software', [
    ['PDF export with real markups', 'Hand back a PDF whose marks stay editable in other viewers.', '1–3 weeks'],
    ['Review sessions', 'Invite reviewers, keep a full record of who did what, close out to a PDF.\nBeats Bluebeam: real co-editing and it keeps working offline.', '1–3 weeks'],
    ['Overlay and compare', 'Lay two revisions over each other in two colours and cloud the differences automatically.', '1–3 weeks'],
  ]],
  ['Phase 5 · Intelligence and open standards', 'Where we go past Bluebeam', [
    ['AI assistant on the board', 'Ask for a takeoff, a drawing check or a markup in plain words; the assistant proposes, you accept.\nBeats Bluebeam: its AI needs the top plan and a Windows PC.', '2–5 days, then ongoing'],
    ['Text reading and symbol count', 'Read scanned drawings; find a symbol and count every copy.', '1–3 weeks'],
    ['Model links and open issues (BCF)', 'Tie a mark on a sheet to the element in the 3D model; exchange issues with other BIM tools.\nBluebeam has no open issue exchange.', 'Not sized yet'],
  ]],
]
const cw = 565
phases.forEach(([name, sub, list], pi) => {
  const x = 25 + pi * cw
  const head = shape(tools, `**${name}**\n${sub}`, x, 65, cw - 25, 90, pi === 0 ? '#f1f0ec' : '#b9c8ff')
  list.forEach(([title, desc, est, status = 'Not started'], i) => card(tools, { title, desc, est, status, tags: [name.split(' · ')[0]], fill: pi === 0 ? C.method : C.tool }, x, 180 + i * 255, cw - 25, 235))
  if (pi) link(items.find((i) => i.html?.includes(phases[pi - 1][0])), head, { route: 'straight' })
})
text(tools, 'Estimates are for one developer and come from reading the code, not from a prototype. Total at base scope: roughly 10–29 working weeks.', 25, 1290, 2000, 18)
text(tools, '**Tools for this way of working**', 25, 1345, 900, 22)
grid(tools, [
  { title: 'Let Claude place pictures on a board', desc: 'The agent can add notes, cards and diagrams today, but not upload an image. Needed for a live inception window.', status: 'Not started', est: '1–2 days', tags: ['method'], fill: C.method },
  { title: 'Live inception window', desc: 'A read-only window onto any screen of the app, inside a board, instead of screenshots.', status: 'Idea', est: '2–5 days', tags: ['method'], fill: C.method },
  { title: 'Code map that redraws itself', desc: 'Frame 8 rebuilt from Graphify after every merge, with task cards linked to the files they touch.', status: 'Not started', est: 'about 1 day', tags: ['method'], fill: C.method },
  { title: 'Estimate field on cards', desc: 'Cards have status, assignee, due date and tags, but nowhere for an estimate. Found while building this board.', status: 'Not started', est: 'under 1 day', tags: ['method'], fill: C.method },
  { title: 'Cards show their whole text', desc: 'Card text was cut after three lines however tall the card was. Found and fixed while building this board.', status: 'Done', due: '2026-11-25', tags: ['method'], fill: C.done },
], card, { y0: 1385, cols: 5, cw: 678, rh: 0 })
items.filter((i) => i.parent === tools.id && i.type === 'card' && i.y > tools.y + 1380).forEach((c) => { c.w = 655; c.h = 160 })

// ---------- 6. Lessons ----------
const les = frame('6 · Bluebeam\'s mistakes, and our rule for each', 3530, 1000, 1000, 1560, '#fff1f2')
add({ type: 'table', parent: les.id, x: les.x + 30, y: les.y + 70, w: 940, h: 1466, header: true, fontSize: 16, fill: '#ffffff', stroke: '#1c1e23',
  colW: [470, 470], rowH: [44, 158, 158, 158, 158, 158, 158, 158, 158, 158],
  cells: [
    ['What Bluebeam got wrong', 'Our rule'],
    ['The full app runs only on Windows. There is no Mac version.', 'One app in the browser. The same tools on Mac, Windows, tablet and phone.'],
    ['Web and mobile are light: about 13 markup types and 4 measurements.', 'No "lite" version. A tool is not finished until it works on a phone.'],
    ['It removed things people relied on: field tools in 2024, the iPad app in 2025.', 'Never remove a tool without an export path. Your data leaves in open formats.'],
    ['In a session you can edit only your own marks; closing writes over the file.', 'True co-editing with roles, and a full record of who changed what.'],
    ['Seven unplanned outages in 2026, three of them at sign-in. The browser app has no offline mode.', 'Offline first. An open board keeps working without the server.'],
    ['AI needs the top plan (£588 a year) and a Windows PC.', 'The assistant is part of the web app and proposes; a person accepts.'],
    ['No open issue exchange with BIM tools.', 'Sheets, models and issues link through open standards (IFC, BCF).'],
    ['Each drawing lives alone in its own PDF.', 'An endless canvas: sheets, model, notes and tasks side by side.'],
    ['Big sessions struggle: its own guidance calls 100 sheets or 20 active people heavy.', 'Draw only what is on screen. Load heavy parts when they are needed.'],
  ] })

// ---------- 7. Inception window ----------
const inc = frame('7 · Inception window: the app\'s own screens. Pin a comment on anything you want changed.', 0, 2660, 4530, 720, '#f8fafc')
if (shotsDir && existsSync(shotsDir)) {
  const files = readdirSync(shotsDir).filter((f) => f.endsWith('.jpg')).sort()
  let x = 30
  for (const f of files) {
    const b64 = readFileSync(join(shotsDir, f)).toString('base64')
    const [, w, h, label] = /^\d+-(\d+)x(\d+)-(.+)\.jpg$/.exec(f) || [null, 1280, 800, basename(f, '.jpg')]
    const H = 540, W = Math.round((H * w) / h)
    if (b64.length > 590_000) { console.warn('skipped (too large):', f); continue }
    add({ type: 'image', parent: inc.id, x: inc.x + x, y: inc.y + 110, w: W, h: H, src: `data:image/jpeg;base64,${b64}`, alt: label, nw: +w, nh: +h })
    text(inc, `**${label.replace(/-/g, ' ')}**`, x, 70, W, 16)
    x += W + 30
  }
  inc.w = Math.max(inc.w, x)
} else text(inc, 'Screenshots are added when the board is built with --shots.', 30, 70, 900, 18)

// ---------- 8. Code map from Graphify ----------
const map = frame('8 · How the app is put together today (drawn from the code by Graphify)', 0, 3480, 4530, 900)
if (graphPath && existsSync(graphPath)) {
  const g = JSON.parse(readFileSync(graphPath, 'utf8'))
  const fileOf = new Map(g.nodes.map((nd) => [nd.id, nd.source_file]))
  const count = {}
  for (const nd of g.nodes) if (nd.source_file) count[nd.source_file] = (count[nd.source_file] || 0) + 1
  const groups = [
    ['Screens', (f) => /^src\/(pages|auth)\/|^src\/App/.test(f), '#a8dcff'],
    ['Board engine', (f) => /^src\/board\/(store|sync|ops|types|validate|geometry|interaction|Canvas)\./.test(f), '#ffd98a'],
    ['Things on a board', (f) => /^src\/board\/items\//.test(f), '#c4eea6'],
    ['Panels and toolbars', (f) => /^src\/board\/ui\//.test(f), '#e3c4ff'],
    ['Files in and out', (f) => /^src\/board\/(importers|export|assets|embeds|overview|templates|defaults)\./.test(f), '#ffb7a0'],
    ['3D models', (f) => /^src\/board\/ifc\//.test(f), '#a6ecd9'],
    ['Shared helpers', (f) => /^src\/lib\//.test(f), '#e6e4dc'],
    ['Server', (f) => /^supabase\/functions\//.test(f), '#b9c8ff'],
  ]
  const box = new Map()
  groups.forEach(([name, test, fill], gi) => {
    const x = 30 + gi * 560
    shape(map, `**${name}**`, x, 70, 520, 50, '#ffffff', { strokeW: 0, fontSize: 18 })
    Object.keys(count).filter(test).sort((a, b) => count[b] - count[a]).forEach((f, i) => {
      const name = basename(f).startsWith('index.') ? `${basename(join(f, '..'))}/${basename(f)}` : basename(f)
      box.set(f, shape(map, `**${name}**\n${count[f]} parts`, x + (i % 2) * 265, 140 + Math.floor(i / 2) * 110, 250, 90, fill, { fontSize: 17 }))
    })
  })
  const pair = {}
  for (const e of g.links) {
    const a = fileOf.get(e.source), b = fileOf.get(e.target)
    if (a && b && a !== b && box.has(a) && box.has(b)) pair[`${a}|${b}`] = (pair[`${a}|${b}`] || 0) + 1
  }
  Object.entries(pair).sort((a, b) => b[1] - a[1]).slice(0, 16).forEach(([k, w]) => { const [a, b] = k.split('|'); link(box.get(a), box.get(b), { strokeW: Math.min(5, 1 + w / 12), stroke: '#9aa0ab' }) })
  const deg = {}
  for (const e of g.links) { deg[e.source] = (deg[e.source] || 0) + 1; deg[e.target] = (deg[e.target] || 0) + 1 }
  const hubs = g.nodes.filter((nd) => nd.source_file && box.has(nd.source_file)).sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0)).slice(0, 6).map((nd) => `${nd.label} in ${basename(nd.source_file)}: ${deg[nd.id]} links`)
  sticky(map, `**The map in numbers**\n${g.nodes.length} parts, ${g.links.length} connections.\nThe 16 strongest file-to-file links are drawn; thicker means more.`, 30, 620, '#fff2a8', 520, 250, 16)
  sticky(map, `**Busiest parts**\n${hubs.join('\n')}\nA change here touches the most code.`, 580, 620, '#ffd98a', 520, 250, 16)
  sticky(map, '**Found by the map**\nCanvas and interaction import each other in a loop. Worth untangling before the measurement tools land there.', 1130, 620, '#ffb7a0', 520, 250, 16)
  sticky(map, '**The gate every new field passes**\nvalidate.ts drops any field it does not know. Each new tool must be added there, or its data vanishes on reload.', 1680, 620, '#ffb7a0', 520, 250, 16)
} else text(map, 'The code map is added when the board is built with --graph.', 30, 70, 900, 18)

writeFileSync(out, JSON.stringify({ app: 'white-canvas', version: 1, title: 'White Canvas project board', exported_at: new Date().toISOString(), items }))
console.log(`${items.length} items → ${out}`)
