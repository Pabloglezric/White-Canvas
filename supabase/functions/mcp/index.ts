// White Canvas MCP server (Streamable HTTP, stateless JSON responses).
// Lets coding agents such as Claude Code read and edit boards with a personal API token.
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const APP_URL = (Deno.env.get('APP_URL') || 'https://white-canvas-three.vercel.app').replace(/\/$/, '')
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version, accept',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
}
type J = Record<string, any>
interface Ctx { user: string; write: boolean }

const COLORS: Record<string, string> = {
  yellow: '#fff2a8', orange: '#ffd98a', red: '#ffb7a0', pink: '#ffb3d1', purple: '#e3c4ff', violet: '#b9c8ff', blue: '#a8dcff',
  teal: '#a6ecd9', cyan: '#a6ecd9', green: '#c4eea6', gray: '#e6e4dc', grey: '#e6e4dc', white: '#ffffff', black: '#2b2d33',
}
const STRONG: Record<string, string> = { red: '#e5484d', orange: '#f76b15', yellow: '#d9a400', green: '#30a46c', blue: '#0090ff', purple: '#6e56cf', pink: '#d6409f', black: '#1c1e23', gray: '#6b6f7a', grey: '#6b6f7a', white: '#ffffff' }
const color = (c: unknown, fallback: string, strong = false) => (typeof c !== 'string' || !c ? fallback : /^#[0-9a-f]{3,8}$/i.test(c) || c === 'transparent' ? c : (strong ? STRONG[c.toLowerCase()] : COLORS[c.toLowerCase()]) || fallback)
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const html = (s: unknown) => esc(String(s == null || typeof s === 'object' ? '' : s).slice(0, 20000)).replace(/\n/g, '<br>')
const plain = (h: unknown) => String(h ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e7, Math.min(1e7, v)) : d)
const str = (v: unknown, max = 2000) => (v == null ? undefined : String(typeof v === 'object' ? '' : v).slice(0, max))
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' || typeof x === 'number').map((x) => String(x).slice(0, 60)).slice(0, 20) : undefined)
const SHAPES = ['rect', 'round', 'ellipse', 'diamond', 'triangle', 'parallelogram', 'hexagon', 'star', 'pill', 'cylinder', 'cloud', 'callout', 'arrowRight', 'arrowLeft', 'pentagon', 'octagon', 'trapezoid', 'cross', 'document', 'predefined']

async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// Best-effort per-token rate limit (per function instance): 120 requests a minute.
class RateLimited extends Error {}
const hits = new Map<string, number[]>()
function allow(key: string): boolean {
  const now = Date.now()
  const list = (hits.get(key) || []).filter((t) => now - t < 60_000)
  if (list.length >= 120) { hits.set(key, list); return false }
  list.push(now)
  hits.set(key, list)
  if (hits.size > 5000) hits.clear()
  return true
}

/** Database errors stay in the logs; callers get a short, safe message. */
function dbError(e: { message?: string } | null): Error {
  console.error('db error', e?.message)
  const m = e?.message || ''
  if (/item limit/.test(m)) return new Error('This board has reached the 50,000 item limit')
  if (/data_size/.test(m)) return new Error('An item is too large (1 MB limit)')
  return new Error('The board could not be read or saved. Try again.')
}

async function authenticate(req: Request): Promise<Ctx | null> {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(wc_[A-Za-z0-9]+)$/)
  if (!m) return null
  const { data } = await admin.from('api_tokens').select('id,user_id,can_write,expires_at').eq('token_hash', await sha256(m[1])).maybeSingle()
  if (!data) return null
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null
  if (!allow(data.id)) throw new RateLimited()
  admin.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', data.id).then(() => {})
  return { user: data.user_id, write: data.can_write }
}

async function roleFor(ctx: Ctx, boardId: string): Promise<{ role: string; board: J }> {
  if (!/^[0-9a-f-]{36}$/i.test(boardId || '')) throw new Error('board_id must be a board UUID (see list_boards)')
  const { data: board } = await admin.from('boards').select('id,title,owner_id,updated_at,trashed_at,settings').eq('id', boardId).maybeSingle()
  if (!board) throw new Error('Board not found')
  if (board.owner_id === ctx.user) return { role: 'owner', board }
  const { data: m } = await admin.from('board_members').select('role').eq('board_id', boardId).eq('user_id', ctx.user).maybeSingle()
  if (!m) throw new Error('Board not found')
  return { role: m.role, board }
}
async function needWrite(ctx: Ctx, boardId: string) {
  const r = await roleFor(ctx, boardId)
  if (!ctx.write) throw new Error('This token is read-only')
  if (r.role !== 'owner' && r.role !== 'editor') throw new Error(`Your role on this board is ${r.role}; editing is not allowed`)
  return r
}

async function loadItems(boardId: string): Promise<J[]> {
  const out: J[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('board_items').select('id,data,rev').eq('board_id', boardId).eq('deleted', false).order('id').range(from, from + 999)
    if (error) throw dbError(error)
    for (const r of data || []) out.push({ ...r.data, id: r.id, rev: r.rev })
    if (!data || data.length < 1000) break
  }
  return out
}
async function saveItems(boardId: string, items: J[], deleted = false) {
  const rows = items.map((it) => ({ id: it.id, board_id: boardId, data: it, rev: it.rev, deleted, client_id: 'agent' }))
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await admin.from('board_items').upsert(rows.slice(i, i + 200), { onConflict: 'id' })
    if (error) throw dbError(error)
  }
}

function bounds(items: J[]) {
  const list = items.filter((i) => i.type !== 'connector' && i.type !== 'comment')
  if (!list.length) return null
  const x1 = Math.min(...list.map((i) => i.x)), y1 = Math.min(...list.map((i) => i.y))
  const x2 = Math.max(...list.map((i) => i.x + i.w)), y2 = Math.max(...list.map((i) => i.y + i.h))
  return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) }
}

/** Compact, agent-friendly view of an item. */
function describe(it: J, byId: Map<string, J>): J {
  const o: J = { id: it.id, type: it.type }
  if (it.type !== 'connector') Object.assign(o, { x: Math.round(it.x), y: Math.round(it.y), w: Math.round(it.w), h: Math.round(it.h) })
  if (it.rot) o.rotation = it.rot
  if (it.parent && byId.get(it.parent)) o.frame = { id: it.parent, title: byId.get(it.parent)!.title }
  if (it.locked) o.locked = true
  if (it.votes?.length) o.votes = it.votes.length
  switch (it.type) {
    case 'sticky': case 'text': o.text = plain(it.html); if (it.fill) o.color = it.fill; if (it.tags?.length) o.tags = it.tags; break
    case 'shape': o.shape = it.kind; o.text = plain(it.html); o.color = it.fill; break
    case 'frame': o.title = it.title; break
    case 'connector': o.from = it.a?.item || { x: Math.round(it.a.x), y: Math.round(it.a.y) }; o.to = it.b?.item || { x: Math.round(it.b.x), y: Math.round(it.b.y) }; if (it.label) o.label = it.label; o.route = it.route; break
    case 'card': Object.assign(o, { title: it.title, description: it.desc, status: it.status, assignee: it.assignee, due: it.due, tags: it.tags }); break
    case 'table': o.rows = it.cells; break
    case 'code': o.language = it.lang; o.code = it.code; break
    case 'embed': o.url = it.url; o.title = it.title; break
    case 'image': o.alt = it.alt; if (/^https?:/.test(it.src || '')) o.url = it.src; break
    case 'ifc': case 'file': o.name = it.name; break
    case 'chart': Object.assign(o, { kind: it.kind, title: it.title, labels: it.labels, values: it.values }); break
    case 'comment': o.resolved = !!it.resolved; o.thread = (it.thread || []).map((t: J) => ({ by: t.name, text: t.text, at: new Date(t.at).toISOString() })); break
    case 'draw': o.note = 'freehand ink'; o.color = it.stroke; break
  }
  return o
}

const base = (type: string, x: number, y: number, w: number, h: number, ctx: Ctx): J => ({ id: crypto.randomUUID(), type, x, y, w, h, rot: 0, z: 0, rev: 1, by: ctx.user })

/** Build a full item from the friendly input shape. Position may be filled in later by auto-layout. */
function build(spec: J, ctx: Ctx): J {
  const t = spec.type
  const x = num(spec.x, NaN), y = num(spec.y, NaN)
  const text = spec.text ?? spec.label ?? ''
  let it: J
  switch (t) {
    case 'sticky': it = { ...base(t, x, y, num(spec.w, 200), num(spec.h, num(spec.w, 200)), ctx), html: html(text), fill: color(spec.color, COLORS.yellow), fontSize: num(spec.font_size, 18), align: 'center', valign: 'middle', tags: strList(spec.tags) }; break
    case 'text': { const fs = num(spec.font_size, 20); const lines = String(text).split('\n'); const w = num(spec.w, Math.min(640, Math.max(60, Math.max(...lines.map((l: string) => l.length)) * fs * 0.58 + 12))); it = { ...base(t, x, y, w, num(spec.h, Math.ceil(lines.length * fs * 1.3 + 4)), ctx), html: html(text), fontSize: fs, align: spec.align || 'left', bold: !!spec.bold, color: spec.text_color ? color(spec.text_color, '#1c1e23', true) : undefined }; break }
    case 'shape': it = { ...base(t, x, y, num(spec.w, 180), num(spec.h, 90), ctx), kind: SHAPES.includes(spec.shape) ? spec.shape : 'rect', html: html(text), fill: color(spec.color, '#ffffff'), stroke: color(spec.stroke, '#1c1e23', true), strokeW: num(spec.stroke_width, 2), fontSize: num(spec.font_size, 16), align: 'center', valign: 'middle' }; break
    case 'frame': it = { ...base(t, x, y, num(spec.w, 800), num(spec.h, 600), ctx), title: str(spec.title ?? text, 200) || 'Frame', fill: color(spec.color, '#ffffff') }; break
    case 'card': it = { ...base(t, x, y, num(spec.w, 280), num(spec.h, 120), ctx), title: str(spec.title ?? text, 300) || '', desc: str(spec.description, 4000), status: str(spec.status, 60), assignee: str(spec.assignee, 80), due: str(spec.due, 40), tags: strList(spec.tags), fill: color(spec.color, '#0090ff', true) }; break
    case 'table': {
      const rows: string[][] = (Array.isArray(spec.rows) && spec.rows.length ? spec.rows.slice(0, 200) : [['']]).map((r: unknown[]) => (Array.isArray(r) ? r.slice(0, 30) : [r]).map((c) => (c == null || typeof c === 'object' ? '' : String(c).slice(0, 2000))))
      const cols = Math.max(1, ...rows.map((r) => r.length))
      for (const r of rows) while (r.length < cols) r.push('')
      const colW = Array.from({ length: cols }, (_, c) => Math.min(320, Math.max(90, ...rows.slice(0, 50).map((r) => r[c].length * 8 + 26))))
      const rowH = rows.map(() => 36)
      it = { ...base(t, x, y, colW.reduce((a, b) => a + b, 0), rowH.reduce((a, b) => a + b, 0), ctx), cells: rows, colW, rowH, header: spec.header !== false, fontSize: 14 }
      break
    }
    case 'code': { const code = (str(spec.code ?? text, 100000) || ''); const lines = code.split('\n'); it = { ...base(t, x, y, num(spec.w, Math.min(900, Math.max(260, Math.max(...lines.map((l) => l.length)) * 8 + 40))), num(spec.h, Math.min(800, lines.length * 20 + 50)), ctx), code, lang: str(spec.language, 30) || 'text', fontSize: 13, dark: true }; break }
    case 'embed': it = { ...base(t, x, y, num(spec.w, 640), num(spec.h, 420), ctx), url: str(spec.url, 2000) || '', kind: spec.as_link ? 'link' : 'iframe', title: str(spec.title, 200) }; if (!/^https:\/\//.test(it.url)) throw new Error('embed needs an https url'); break
    case 'image': it = { ...base(t, x, y, num(spec.w, 400), num(spec.h, 300), ctx), src: str(spec.url, 2000) || '', alt: str(spec.alt, 300) }; if (!/^https:\/\//.test(it.src)) throw new Error('image needs an https url'); break
    case 'chart': it = { ...base(t, x, y, num(spec.w, 420), num(spec.h, 280), ctx), kind: ['bar', 'line', 'pie'].includes(spec.kind) ? spec.kind : 'bar', title: str(spec.title, 200), labels: (Array.isArray(spec.labels) ? spec.labels : []).slice(0, 200).map((l: unknown) => str(l, 80) || ''), values: (Array.isArray(spec.values) ? spec.values : []).slice(0, 200).map((v: unknown) => num(Number(v), 0)) }; break
    case 'comment': it = { ...base(t, x, y, 32, 32, ctx), thread: [{ id: crypto.randomUUID(), by: ctx.user, name: 'Agent', text: (str(text, 4000) || ''), at: Date.now() }] }; break
    default: throw new Error(`Unknown item type "${t}". Use sticky, text, shape, frame, card, table, code, embed, image, chart, comment or connector.`)
  }
  for (const k of Object.keys(it)) if (it[k] === undefined) delete it[k]
  if (spec.locked) it.locked = true
  if (spec.rotation) it.rot = num(spec.rotation, 0)
  return it
}

function connector(spec: J, resolve: (ref: unknown) => string | undefined, ctx: Ctx): J {
  const end = (v: unknown) => {
    if (v && typeof v === 'object') return { x: num((v as J).x, 0), y: num((v as J).y, 0) }
    const id = resolve(v)
    if (!id) throw new Error(`connector end "${v}" does not match an item id or ref`)
    return { item: id, x: 0, y: 0 }
  }
  const caps = ['none', 'arrow', 'triangle', 'dot', 'diamond', 'bar']
  return {
    ...base('connector', 0, 0, 0, 0, ctx), a: end(spec.from), b: end(spec.to), route: ['straight', 'elbow', 'curve'].includes(spec.route) ? spec.route : 'elbow',
    capA: caps.includes(spec.start_cap) ? spec.start_cap : 'none', capB: caps.includes(spec.end_cap) ? spec.end_cap : 'arrow',
    stroke: color(spec.color, '#1c1e23', true), strokeW: num(spec.stroke_width, 2), ...(spec.label ? { label: str(spec.label, 200) } : {}), ...(spec.dashed ? { dash: 'dashed' } : {}),
  }
}

/** Items without coordinates flow in rows to the right of what is already on the board. */
function autoPlace(fresh: J[], existing: J[], origin?: { x: number; y: number }, columns = 5) {
  const loose = fresh.filter((i) => i.type !== 'connector' && (Number.isNaN(i.x) || Number.isNaN(i.y)))
  if (!loose.length) return
  const b = bounds(existing)
  let x0 = origin?.x ?? (b ? b.x + b.w + 160 : 0), y = origin?.y ?? (b ? b.y : 0)
  let x = x0, rowH = 0, n = 0
  for (const it of loose) {
    if (n && n % columns === 0) { x = x0; y += rowH + 30; rowH = 0 }
    it.x = x; it.y = y
    x += it.w + 30; rowH = Math.max(rowH, it.h); n++
  }
}

function adoptFrames(fresh: J[], all: J[]) {
  const frames = all.filter((i) => i.type === 'frame')
  for (const it of fresh) {
    if (it.type === 'frame' || it.type === 'connector' || it.parent) continue
    const cx = it.x + it.w / 2, cy = it.y + it.h / 2
    const f = frames.find((fr) => fr.id !== it.id && cx > fr.x && cx < fr.x + fr.w && cy > fr.y && cy < fr.y + fr.h)
    if (f) it.parent = f.id
  }
}

function stamp(fresh: J[], existing: J[]) {
  let z = Math.max(0, ...existing.map((i) => i.z || 0))
  for (const it of fresh) it.z = it.type === 'frame' ? Math.min(0, ...existing.map((i) => i.z || 0)) - 1 : ++z
}

// ---------- tools ----------

const tools: { name: string; description: string; inputSchema: J; write?: boolean; run: (a: J, ctx: Ctx) => Promise<unknown> }[] = [
  {
    name: 'list_boards', description: 'List the White Canvas boards you can access, newest first.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Optional title filter' } } },
    run: async (a, ctx) => {
      const { data: owned } = await admin.from('boards').select('id,title,updated_at,owner_id').eq('owner_id', ctx.user).is('trashed_at', null).order('updated_at', { ascending: false }).limit(200)
      const { data: mem } = await admin.from('board_members').select('role,boards(id,title,updated_at,trashed_at)').eq('user_id', ctx.user)
      const list = [...(owned || []).map((b) => ({ ...b, role: 'owner' })), ...(mem || []).filter((m: J) => m.boards && !m.boards.trashed_at).map((m: J) => ({ ...m.boards, role: m.role }))]
      const q = String(a.query || '').toLowerCase()
      return list.filter((b) => !q || b.title.toLowerCase().includes(q)).map((b) => ({ id: b.id, title: b.title, role: b.role, updated_at: b.updated_at, url: `${APP_URL}/board/${b.id}` }))
    },
  },
  {
    name: 'create_board', description: 'Create a new empty board. Returns its id and URL.', write: true,
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    run: async (a, ctx) => {
      if (!ctx.write) throw new Error('This token is read-only')
      const { data, error } = await admin.from('boards').insert({ title: (str(a.title, 200) || '').trim() || 'Untitled board', owner_id: ctx.user }).select('id,title').single()
      if (error) throw dbError(error)
      return { id: data.id, title: data.title, url: `${APP_URL}/board/${data.id}` }
    },
  },
  {
    name: 'get_board',
    description: 'Read a board. view="summary" gives counts, bounds and frames; "items" lists every item (position, text, colours, connections); "outline" gives the text grouped by frame for quick reading.',
    inputSchema: { type: 'object', properties: { board_id: { type: 'string' }, view: { type: 'string', enum: ['summary', 'items', 'outline'], default: 'items' }, types: { type: 'array', items: { type: 'string' }, description: 'Only these item types' }, frame_id: { type: 'string', description: 'Only items inside this frame' }, limit: { type: 'number', default: 500 } }, required: ['board_id'] },
    run: async (a, ctx) => {
      const { role, board } = await roleFor(ctx, a.board_id)
      const items = await loadItems(a.board_id)
      const byId = new Map(items.map((i) => [i.id, i]))
      const counts: J = {}
      for (const i of items) counts[i.type] = (counts[i.type] || 0) + 1
      const head = { id: board.id, title: board.title, role, url: `${APP_URL}/board/${board.id}`, updated_at: board.updated_at, item_count: items.length, counts, bounds: bounds(items), frames: items.filter((i) => i.type === 'frame').map((f) => ({ id: f.id, title: f.title, x: Math.round(f.x), y: Math.round(f.y), w: Math.round(f.w), h: Math.round(f.h) })) }
      if (a.view === 'summary') return head
      let list = items
      if (Array.isArray(a.types) && a.types.length) list = list.filter((i) => a.types.includes(i.type))
      if (a.frame_id) list = list.filter((i) => i.parent === a.frame_id || i.id === a.frame_id)
      if (a.view === 'outline') {
        const groups = new Map<string, string[]>()
        for (const i of list.sort((p, q) => p.y - q.y || p.x - q.x)) {
          const d = describe(i, byId)
          const text = d.text || d.title || d.label || d.code || (d.rows ? d.rows.map((r: string[]) => r.join(' | ')).join('\n') : '') || (d.thread ? d.thread.map((t: J) => `${t.by}: ${t.text}`).join(' / ') : '')
          if (!text || i.type === 'frame') continue
          const key = i.parent && byId.get(i.parent) ? byId.get(i.parent)!.title : '(outside frames)'
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key)!.push(`- [${i.type}] ${String(text).replace(/\n/g, ' ⏎ ')}`)
        }
        return { ...head, outline: [...groups].map(([k, v]) => `## ${k}\n${v.join('\n')}`).join('\n\n') }
      }
      const limit = Math.max(1, Math.min(2000, num(a.limit, 500)))
      return { ...head, items: list.slice(0, limit).map((i) => describe(i, byId)), truncated: list.length > limit }
    },
  },
  {
    name: 'create_items', write: true,
    description: 'Add items to a board. Each item has a type: sticky, text, shape, frame, card, table, code, embed, image, chart, comment or connector. Leave out x/y to have items laid out automatically in free space. Give an item a "ref" to connect to it from a connector in the same call (connector from/to accept item ids or refs). Colours accept names (yellow, orange, red, pink, purple, blue, teal, green, gray, white, black) or hex. Coordinates are board pixels; y grows downward.',
    inputSchema: {
      type: 'object', required: ['board_id', 'items'],
      properties: {
        board_id: { type: 'string' },
        origin: { type: 'object', description: 'Where auto-laid-out items start', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        columns: { type: 'number', description: 'Auto-layout items per row (default 5)' },
        items: {
          type: 'array', items: {
            type: 'object', required: ['type'],
            properties: {
              type: { type: 'string' }, ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
              text: { type: 'string' }, color: { type: 'string' }, font_size: { type: 'number' }, title: { type: 'string' }, frame: { type: 'string', description: 'id or ref of a frame to place this item in' },
              shape: { type: 'string', enum: SHAPES }, stroke: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
              description: { type: 'string' }, status: { type: 'string' }, assignee: { type: 'string' }, due: { type: 'string' },
              rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } }, header: { type: 'boolean' },
              code: { type: 'string' }, language: { type: 'string' }, url: { type: 'string' }, as_link: { type: 'boolean' }, alt: { type: 'string' },
              kind: { type: 'string', enum: ['bar', 'line', 'pie'] }, labels: { type: 'array', items: { type: 'string' } }, values: { type: 'array', items: { type: 'number' } },
              from: { description: 'connector start: item id, ref, or {x,y}' }, to: { description: 'connector end: item id, ref, or {x,y}' }, label: { type: 'string' },
              route: { type: 'string', enum: ['straight', 'elbow', 'curve'] }, start_cap: { type: 'string' }, end_cap: { type: 'string' }, dashed: { type: 'boolean' }, locked: { type: 'boolean' }, rotation: { type: 'number' },
            },
          },
        },
      },
    },
    run: async (a, ctx) => {
      await needWrite(ctx, a.board_id)
      if (!Array.isArray(a.items) || !a.items.length) throw new Error('items must be a non-empty array')
      if (a.items.length > 500) throw new Error('At most 500 items per call')
      const existing = await loadItems(a.board_id)
      const ids = new Set(existing.map((i) => i.id))
      const refs = new Map<string, string>()
      const fresh: J[] = []
      const grown: J[] = []
      const specs = a.items as J[]
      const built = new Map<J, J>()
      for (const s of specs) if (s.type !== 'connector') { const it = build(s, ctx); built.set(s, it); fresh.push(it); if (s.ref) refs.set(String(s.ref), it.id) }
      const resolve = (r: unknown) => (typeof r === 'string' ? refs.get(r) || (ids.has(r) ? r : undefined) : undefined)
      for (const s of specs) {
        const it = built.get(s)
        if (it && s.frame) {
          const fid = resolve(s.frame)
          const f = fid ? [...fresh, ...existing].find((i) => i.id === fid && i.type === 'frame') : undefined
          if (f) it.parent = f.id
        }
      }
      autoPlace(fresh.filter((i) => !i.parent), existing, a.origin, num(a.columns, 5))
      // items assigned to a frame without coordinates flow in rows inside that frame
      for (const f of [...fresh, ...existing].filter((i) => i.type === 'frame')) {
        const kids = fresh.filter((i) => i.parent === f.id && (Number.isNaN(i.x) || Number.isNaN(i.y)))
        if (!kids.length) continue
        const taken = [...existing, ...fresh].filter((i) => i.parent === f.id && !kids.includes(i))
        let x = f.x + 30, y = taken.length ? Math.max(...taken.map((i) => i.y + i.h)) + 30 : f.y + 30, rowH = 0
        for (const it of kids) {
          if (x > f.x + 30 && x + it.w > f.x + f.w - 20) { x = f.x + 30; y += rowH + 24; rowH = 0 }
          it.x = x; it.y = y
          x += it.w + 24; rowH = Math.max(rowH, it.h)
        }
        const bottom = Math.max(...kids.map((i) => i.y + i.h)) + 30
        if (bottom > f.y + f.h) { f.h = bottom - f.y; if (!fresh.includes(f)) { f.rev = (f.rev || 0) + 1; grown.push(f) } }
      }
      for (const s of specs) if (s.type === 'connector') fresh.push(connector(s, resolve, ctx))
      adoptFrames(fresh, [...existing, ...fresh])
      stamp(fresh, existing)
      await saveItems(a.board_id, [...fresh, ...grown])
      return { created: specs.map((s) => { const it = built.get(s); return it ? { ref: s.ref, id: it.id, type: it.type, x: Math.round(it.x), y: Math.round(it.y), w: Math.round(it.w), h: Math.round(it.h) } : null }).filter(Boolean), connectors: fresh.filter((i) => i.type === 'connector').map((i) => i.id), url: `${APP_URL}/board/${a.board_id}` }
    },
  },
  {
    name: 'update_items', write: true,
    description: 'Change existing items. Each update needs the item id plus any of: x, y, w, h, rotation, text, color, title, label, locked, frame (id or null), shape, status, assignee, due, description, tags, rows, code, resolved (comments), reply (adds a comment reply).',
    inputSchema: { type: 'object', required: ['board_id', 'updates'], properties: { board_id: { type: 'string' }, updates: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } }, additionalProperties: true } } } },
    run: async (a, ctx) => {
      await needWrite(ctx, a.board_id)
      const existing = await loadItems(a.board_id)
      const byId = new Map(existing.map((i) => [i.id, i]))
      const changed: J[] = [], missing: string[] = []
      if (!Array.isArray(a.updates) || a.updates.length > 500) throw new Error('updates must be a list of at most 500 entries')
      for (const u of a.updates as J[]) {
        if (!u || typeof u !== 'object') continue
        const it = byId.get(u.id)
        if (!it) { missing.push(u.id); continue }
        const n: J = { ...it }
        for (const k of ['x', 'y']) if (typeof u[k] === 'number') n[k] = num(u[k], n[k])
        for (const k of ['w', 'h']) if (typeof u[k] === 'number') n[k] = Math.max(1, num(u[k], n[k]))
        if (typeof u.rotation === 'number') n.rot = num(u.rotation, 0) % 360
        if (typeof u.locked === 'boolean') n.locked = u.locked
        if (u.frame === null) n.parent = null
        else if (typeof u.frame === 'string' && byId.get(u.frame)?.type === 'frame') n.parent = u.frame
        if (u.text != null) { if ('html' in n) n.html = html(u.text); else if (n.type === 'card' || n.type === 'frame') n.title = str(u.text, 300); else if (n.type === 'connector') n.label = str(u.text, 200); else if (n.type === 'code') n.code = str(u.text, 100000) }
        if (u.title != null && (n.type === 'frame' || n.type === 'card' || n.type === 'chart' || n.type === 'embed')) n.title = str(u.title, 300)
        if (u.label != null && n.type === 'connector') n.label = str(u.label, 200)
        if (u.color != null) { if (n.type === 'connector' || n.type === 'draw') n.stroke = color(u.color, n.stroke, true); else if (n.type === 'card') n.fill = color(u.color, n.fill, true); else n.fill = color(u.color, n.fill) }
        if (u.shape && n.type === 'shape' && SHAPES.includes(u.shape)) n.kind = u.shape
        if (typeof u.font_size === 'number') n.fontSize = Math.max(4, Math.min(400, num(u.font_size, 16)))
        if (n.type === 'card') { if (u.description != null) n.desc = str(u.description, 4000); for (const k of ['status', 'assignee', 'due']) if (u[k] != null) n[k] = str(u[k], 80) }
        if (Array.isArray(u.tags)) n.tags = strList(u.tags)
        if (n.type === 'table' && Array.isArray(u.rows)) { const t = build({ type: 'table', rows: u.rows, x: n.x, y: n.y }, ctx); Object.assign(n, { cells: t.cells, colW: t.colW, rowH: t.rowH, w: t.w, h: t.h }) }
        if (n.type === 'code' && u.code != null) n.code = str(u.code, 100000)
        if (n.type === 'comment') { if (typeof u.resolved === 'boolean') n.resolved = u.resolved; if (u.reply) n.thread = [...(n.thread || []), { id: crypto.randomUUID(), by: ctx.user, name: 'Agent', text: (str(u.reply, 4000) || ''), at: Date.now() }] }
        n.rev = (it.rev || 0) + 1
        changed.push(n)
      }
      if (changed.length) await saveItems(a.board_id, changed)
      return { updated: changed.map((i) => i.id), not_found: missing }
    },
  },
  {
    name: 'delete_items', write: true, description: 'Remove items from a board by id. People with the board open can undo nothing here, so delete only what you were asked to.',
    inputSchema: { type: 'object', required: ['board_id', 'ids'], properties: { board_id: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } } } },
    run: async (a, ctx) => {
      await needWrite(ctx, a.board_id)
      const existing = await loadItems(a.board_id)
      const gone = existing.filter((i) => (a.ids || []).includes(i.id) && !i.locked)
      const goneIds = new Set(gone.map((i) => i.id))
      // detach connectors and frame children that pointed at removed items
      const fix: J[] = []
      for (const it of existing) {
        if (goneIds.has(it.id)) continue
        let n: J | null = null
        if (it.parent && goneIds.has(it.parent)) n = { ...it, parent: null }
        if (it.type === 'connector') for (const e of ['a', 'b']) if (it[e]?.item && goneIds.has(it[e].item)) { const t = existing.find((x) => x.id === it[e].item)!; n = { ...(n || it), [e]: { x: t.x + t.w / 2, y: t.y + t.h / 2 } } }
        if (n) { n.rev = (it.rev || 0) + 1; fix.push(n) }
      }
      if (fix.length) await saveItems(a.board_id, fix)
      if (gone.length) await saveItems(a.board_id, gone.map((i) => ({ ...i, rev: (i.rev || 0) + 1 })), true)
      return { deleted: gone.map((i) => i.id), skipped_locked: existing.filter((i) => (a.ids || []).includes(i.id) && i.locked).map((i) => i.id) }
    },
  },
  {
    name: 'create_diagram', write: true,
    description: 'Draw a flowchart or graph with automatic layout: give nodes and edges, get shapes joined by connectors. Good for architectures, processes, org charts and dependency maps.',
    inputSchema: {
      type: 'object', required: ['board_id', 'nodes'],
      properties: {
        board_id: { type: 'string' }, title: { type: 'string', description: 'Wraps the diagram in a titled frame' }, direction: { type: 'string', enum: ['TB', 'LR'], default: 'TB' },
        origin: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        nodes: { type: 'array', items: { type: 'object', required: ['id', 'label'], properties: { id: { type: 'string' }, label: { type: 'string' }, shape: { type: 'string', enum: SHAPES }, color: { type: 'string' } } } },
        edges: { type: 'array', items: { type: 'object', required: ['from', 'to'], properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string' }, dashed: { type: 'boolean' } } } },
      },
    },
    run: async (a, ctx) => {
      await needWrite(ctx, a.board_id)
      const nodes = (a.nodes || []) as J[], edges = ((a.edges || []) as J[]).filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to))
      if (!nodes.length) throw new Error('nodes must not be empty')
      if (nodes.length > 300 || edges.length > 1000) throw new Error('At most 300 nodes and 1000 edges per diagram')
      // longest-path layering, then order each layer by the average position of its parents
      const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]))
      for (let pass = 0; pass < nodes.length; pass++) { let moved = false; for (const e of edges) if (e.from !== e.to && layer.get(e.to)! < layer.get(e.from)! + 1 && layer.get(e.from)! + 1 <= nodes.length) { layer.set(e.to, layer.get(e.from)! + 1); moved = true } if (!moved) break }
      const layers: J[][] = []
      for (const n of nodes) { const l = layer.get(n.id)!; (layers[l] ||= []).push(n) }
      const order = new Map<string, number>()
      layers.forEach((L, li) => {
        if (li) L.sort((p, q) => { const avg = (n: J) => { const ps = edges.filter((e) => e.to === n.id && order.has(e.from)).map((e) => order.get(e.from)!); return ps.length ? ps.reduce((s, v) => s + v, 0) / ps.length : 1e6 }; return avg(p) - avg(q) })
        L.forEach((n, i) => order.set(n.id, i - (L.length - 1) / 2))
      })
      const existing = await loadItems(a.board_id)
      const b = bounds(existing)
      const lr = a.direction === 'LR'
      const W = 190, H = 84, gx = lr ? 110 : 60, gy = lr ? 46 : 90
      const span = Math.max(...layers.map((L) => L.length))
      const ox = num(a.origin?.x, b ? b.x + b.w + 200 : 0), oy = num(a.origin?.y, b ? b.y : 0)
      const fresh: J[] = [], idOf = new Map<string, string>()
      for (const n of nodes) {
        const l = layer.get(n.id)!, o = order.get(n.id)! + (span - 1) / 2
        const x = lr ? ox + l * (W + gx) : ox + o * (W + gx), y = lr ? oy + o * (H + gy) : oy + l * (H + gy)
        const it = build({ type: 'shape', x, y, w: W, h: H, text: n.label, shape: n.shape || 'round', color: n.color || 'white' }, ctx)
        idOf.set(n.id, it.id); fresh.push(it)
      }
      if (a.title) {
        const nb = bounds(fresh)!
        fresh.unshift(build({ type: 'frame', title: a.title, x: nb.x - 60, y: nb.y - 60, w: nb.w + 120, h: nb.h + 120 }, ctx))
        for (const it of fresh.slice(1)) it.parent = fresh[0].id
      }
      for (const e of edges) fresh.push(connector({ from: e.from, to: e.to, label: e.label, dashed: e.dashed, route: 'elbow' }, (r) => idOf.get(String(r)), ctx))
      stamp(fresh, existing)
      await saveItems(a.board_id, fresh)
      return { nodes: nodes.map((n) => ({ ref: n.id, id: idOf.get(n.id) })), frame_id: a.title ? fresh[0].id : undefined, bounds: bounds(fresh), url: `${APP_URL}/board/${a.board_id}` }
    },
  },
  {
    name: 'add_comment', write: true, description: 'Pin a comment to the board, either at coordinates or on an item.',
    inputSchema: { type: 'object', required: ['board_id', 'text'], properties: { board_id: { type: 'string' }, text: { type: 'string' }, item_id: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } },
    run: async (a, ctx) => {
      const r = await roleFor(ctx, a.board_id)
      if (!ctx.write || r.role === 'viewer') throw new Error('Commenting is not allowed with this token or role')
      const existing = await loadItems(a.board_id)
      const target = a.item_id ? existing.find((i) => i.id === a.item_id) : undefined
      const c = build({ type: 'comment', text: a.text, x: target ? target.x + target.w - 6 : num(a.x, 0), y: target ? target.y + 6 : num(a.y, 0) }, ctx)
      stamp([c], existing)
      await saveItems(a.board_id, [c])
      return { id: c.id }
    },
  },
  {
    name: 'search_board', description: 'Find items on a board whose text contains the query.',
    inputSchema: { type: 'object', required: ['board_id', 'query'], properties: { board_id: { type: 'string' }, query: { type: 'string' } } },
    run: async (a, ctx) => {
      await roleFor(ctx, a.board_id)
      const items = await loadItems(a.board_id)
      const byId = new Map(items.map((i) => [i.id, i]))
      const q = String(a.query || '').toLowerCase()
      return items.map((i) => describe(i, byId)).filter((d) => JSON.stringify([d.text, d.title, d.label, d.code, d.rows, d.thread, d.url, d.name, d.description]).toLowerCase().includes(q)).slice(0, 100)
    },
  },
]

// ---------- JSON-RPC over HTTP ----------

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function handle(msg: J, ctx: Ctx): Promise<J | null> {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') return rpcError(null, -32600, 'Invalid request')
  const { id, method, params } = msg
  if (id === undefined) return null // notification
  switch (method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: { protocolVersion: ['2025-06-18', '2025-03-26', '2024-11-05'].includes(params?.protocolVersion) ? params.protocolVersion : '2025-03-26', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'white-canvas', version: '1.0.0' }, instructions: 'White Canvas is an infinite whiteboard. Call list_boards first, then get_board with view="summary" or "outline" before editing. Coordinates are in board pixels with y pointing down; a sticky note is 200×200. Omit x/y to let the server place new items in free space, and prefer create_diagram for anything with nodes and edges.' } }
    case 'ping': return { jsonrpc: '2.0', id, result: {} }
    case 'tools/list': return { jsonrpc: '2.0', id, result: { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: !t.write } })) } }
    case 'resources/list': return { jsonrpc: '2.0', id, result: { resources: [] } }
    case 'prompts/list': return { jsonrpc: '2.0', id, result: { prompts: [] } }
    case 'tools/call': {
      const tool = tools.find((t) => t.name === params?.name)
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${params?.name}`)
      try {
        const out = await tool.run(params.arguments || {}, ctx)
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] } }
      } catch (e) {
        return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true } }
      }
    }
  }
  return rpcError(id, -32601, `Method not found: ${method}`)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  const json = (body: unknown, status = 200, extra: J = {}) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json', ...extra } })
  if (req.method === 'DELETE') return new Response(null, { status: 200, headers: CORS })
  if (req.method !== 'POST') return json(rpcError(null, -32000, 'Use POST with a JSON-RPC body (MCP Streamable HTTP).'), 405, { Allow: 'POST, OPTIONS' })
  if (Number(req.headers.get('content-length') || 0) > 2_000_000) return json(rpcError(null, -32600, 'Request is too large (2 MB limit)'), 413)
  let ctx: Ctx | null
  try { ctx = await authenticate(req) } catch (e) {
    if (e instanceof RateLimited) return json(rpcError(null, -32002, 'Too many requests. Wait a minute and try again.'), 429, { 'Retry-After': '60' })
    return json(rpcError(null, -32603, 'Server error'), 500)
  }
  if (!ctx) return json(rpcError(null, -32001, 'Missing, invalid or expired token. Create one in White Canvas → Settings → Agent access and send it as "Authorization: Bearer wc_…".'), 401, { 'WWW-Authenticate': 'Bearer' })
  let body: unknown
  try {
    const text = await req.text()
    if (text.length > 2_000_000) return json(rpcError(null, -32600, 'Request is too large (2 MB limit)'), 413)
    body = JSON.parse(text)
  } catch { return json(rpcError(null, -32700, 'Parse error'), 400) }
  if (Array.isArray(body)) {
    if (body.length > 20) return json(rpcError(null, -32600, 'At most 20 messages per batch'), 400)
    const out = (await Promise.all(body.map((m) => handle(m, ctx)))).filter(Boolean)
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS })
  }
  const out = await handle(body as J, ctx)
  return out ? json(out) : new Response(null, { status: 202, headers: CORS })
})
