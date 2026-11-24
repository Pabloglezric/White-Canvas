import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { clamp, uid } from '../lib/util'
import { itemBox, unionBoxes, type Guide } from './geometry'
import type { BoardMeta, Box, Camera, Item, Peer, Role, Route, ShapeKind, Tool } from './types'

export type Patch = Record<string, Item | null>
interface HistoryEntry { before: Patch; after: Patch }

export type PanelId = null | 'comments' | 'frames' | 'versions' | 'search' | 'templates' | 'share' | 'export' | 'shortcuts' | 'insert' | 'facilitate' | 'menu'

interface Prefs {
  grid: 'dots' | 'lines' | 'none'
  snap: boolean
  minimap: boolean
  theme: 'light' | 'dark'
  navMode: 'auto' | 'mouse' | 'trackpad'
  fingerDraws: boolean
  penColor: string
  penSize: number
  hlColor: string
  hlSize: number
  stickyColor: string
  shapeKind: ShapeKind
  connRoute: Route
  showComments: boolean
}

const PREF_KEY = 'wc.prefs.v1'
const defaultPrefs: Prefs = {
  grid: 'dots', snap: true, minimap: false, theme: 'light', navMode: 'auto', fingerDraws: true,
  penColor: '#e5484d', penSize: 4, hlColor: '#ffe14d', hlSize: 18, stickyColor: '#fff2a8',
  shapeKind: 'rect', connRoute: 'elbow', showComments: true,
}
function loadPrefs(): Prefs {
  try { return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREF_KEY) || '{}') } } catch { return defaultPrefs }
}

export interface BoardState extends Prefs {
  boardId: string | null
  meta: BoardMeta | null
  role: Role
  me: { id: string; name: string; color: string }
  clientId: string
  status: 'idle' | 'loading' | 'ready' | 'error' | 'denied'
  syncState: 'synced' | 'saving' | 'offline' | 'local'
  items: Record<string, Item>
  selection: string[]
  editingId: string | null
  tool: Tool
  toolLock: boolean
  camera: Camera
  viewport: { w: number; h: number }
  peers: Record<string, Peer>
  following: string | null
  guides: Guide[]
  marquee: Box | null
  connectHover: string | null
  ctxMenu: { x: number; y: number; world: { x: number; y: number } } | null
  panel: PanelId
  activeComment: string | null
  presenting: number | null // index into ordered frames
  undo: HistoryEntry[]
  redo: HistoryEntry[]
  toast: { id: number; text: string } | null
  setPrefs: (p: Partial<Prefs>) => void
  setTool: (t: Tool, lock?: boolean) => void
  select: (ids: string[]) => void
  setCamera: (c: Camera) => void
}

export const useBoard = create<BoardState>()(
  subscribeWithSelector((set, get) => ({
    ...loadPrefs(),
    boardId: null,
    meta: null,
    role: 'viewer',
    me: { id: 'local', name: 'You', color: '#2f6fed' },
    clientId: uid().slice(0, 8),
    status: 'idle',
    syncState: 'synced',
    items: {},
    selection: [],
    editingId: null,
    tool: 'select',
    toolLock: false,
    camera: { x: 0, y: 0, z: 1 },
    viewport: { w: 1280, h: 800 },
    peers: {},
    following: null,
    guides: [],
    marquee: null,
    connectHover: null,
    ctxMenu: null,
    panel: null,
    activeComment: null,
    presenting: null,
    undo: [],
    redo: [],
    toast: null,
    setPrefs: (p) => {
      set(p as Partial<BoardState>)
      const s = get()
      const prefs: Record<string, unknown> = {}
      for (const k of Object.keys(defaultPrefs)) prefs[k] = (s as unknown as Record<string, unknown>)[k]
      try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
    },
    setTool: (t, lock) => set((s) => ({ tool: t, toolLock: lock ?? (t === s.tool ? s.toolLock : false), editingId: null })),
    select: (ids) => set({ selection: ids }),
    setCamera: (c) => set({ camera: { x: c.x, y: c.y, z: clamp(c.z, MIN_ZOOM, MAX_ZOOM) } }),
  })),
)

export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 8
export const S = () => useBoard.getState()
export const canEdit = () => { const r = S().role; return r === 'owner' || r === 'editor' }
export const canComment = () => S().role !== 'viewer'

export function toast(text: string) {
  const id = Date.now()
  useBoard.setState({ toast: { id, text } })
  setTimeout(() => { if (S().toast?.id === id) useBoard.setState({ toast: null }) }, 2600)
}

// ---------- mutation + history ----------

const pending = new Map<string, Item | null>()
const tombs = new Map<string, number>()

export const hooks: {
  onCommit?: (changed: Item[], removed: Item[]) => void
  onLive?: (changed: Item[]) => void
} = {}

/** Apply item changes without finishing the gesture. Call commit() when done. */
export function mutate(patch: Patch) {
  const s = S()
  const items = { ...s.items }
  const live: Item[] = []
  for (const id in patch) {
    if (!pending.has(id)) pending.set(id, s.items[id] ?? null)
    const v = patch[id]
    if (v === null) delete items[id]
    else { items[id] = v; live.push(v) }
  }
  useBoard.setState({ items })
  if (live.length) hooks.onLive?.(live)
}

export function update(id: string, partial: Partial<Item>) {
  const it = S().items[id]
  if (it) mutate({ [id]: { ...it, ...partial } as Item })
}

export function commit(opts: { history?: boolean } = {}) {
  if (!pending.size) return
  const s = S()
  const history = opts.history !== false
  const items = { ...s.items }
  const before: Patch = {}, after: Patch = {}
  const changed: Item[] = [], removed: Item[] = []
  for (const [id, prev] of pending) {
    const cur = s.items[id] ?? null
    if (prev === cur) continue
    if (cur) {
      const next = { ...cur, rev: Math.max(cur.rev || 0, prev?.rev || 0, tombs.get(id) || 0) + 1 } as Item
      items[id] = next
      after[id] = next
      changed.push(next)
      tombs.delete(id)
    } else if (prev) {
      after[id] = null
      const rev = (prev.rev || 0) + 1
      tombs.set(id, rev)
      removed.push({ ...prev, rev } as Item)
    }
    before[id] = prev
  }
  pending.clear()
  if (!changed.length && !removed.length) return
  useBoard.setState({
    items,
    undo: history ? [...s.undo, { before, after }].slice(-300) : s.undo,
    redo: history ? [] : s.redo,
  })
  hooks.onCommit?.(changed, removed)
}

/** Drop uncommitted changes (e.g. gesture cancelled). */
export function rollback() {
  if (!pending.size) return
  const items = { ...S().items }
  for (const [id, prev] of pending) {
    if (prev) items[id] = prev
    else delete items[id]
  }
  pending.clear()
  useBoard.setState({ items })
}

export function apply(patch: Patch) { mutate(patch); commit() }

function replay(patch: Patch) {
  const live = Object.keys(patch)
  mutate(patch)
  commit({ history: false })
  const s = S()
  useBoard.setState({ selection: live.filter((id) => s.items[id] && patch[id]), editingId: null })
}

export function undo() {
  const s = S()
  const e = s.undo[s.undo.length - 1]
  if (!e) return
  commit()
  useBoard.setState({ undo: S().undo.slice(0, -1), redo: [...S().redo, e] })
  replay(e.before)
}

export function redo() {
  const s = S()
  const e = s.redo[s.redo.length - 1]
  if (!e) return
  useBoard.setState({ redo: s.redo.slice(0, -1), undo: [...s.undo, e] })
  replay(e.after)
}

/** Merge changes that arrived from other clients or the agent API. */
export function applyRemote(upserts: Item[], removes: { id: string; rev: number }[]) {
  const s = S()
  let items: Record<string, Item> | null = null
  const gone: string[] = []
  for (const it of upserts) {
    const local = s.items[it.id]
    const tomb = tombs.get(it.id)
    if (tomb != null && (it.rev || 0) <= tomb) continue
    if (local && (it.rev || 0) < (local.rev || 0)) continue
    if (pending.has(it.id)) continue
    items ||= { ...s.items }
    items[it.id] = it
    tombs.delete(it.id)
  }
  for (const r of removes) {
    const local = (items || s.items)[r.id]
    tombs.set(r.id, Math.max(tombs.get(r.id) || 0, r.rev))
    if (!local || r.rev < (local.rev || 0)) continue
    items ||= { ...s.items }
    delete items[r.id]
    gone.push(r.id)
  }
  if (!items) return
  const patch: Partial<BoardState> = { items }
  if (gone.length) {
    patch.selection = s.selection.filter((id) => !gone.includes(id))
    if (s.editingId && gone.includes(s.editingId)) patch.editingId = null
  }
  useBoard.setState(patch)
}

export function resetBoard(partial: Partial<BoardState>) {
  pending.clear()
  tombs.clear()
  useBoard.setState({
    items: {}, selection: [], editingId: null, tool: 'select', peers: {}, following: null, guides: [], marquee: null, connectHover: null, ctxMenu: null,
    panel: null, activeComment: null, presenting: null, undo: [], redo: [], camera: { x: 0, y: 0, z: 1 }, ...partial,
  })
}

// ---------- camera ----------

export function zoomAt(sx: number, sy: number, factor: number) {
  const { camera } = S()
  const z = clamp(camera.z * factor, MIN_ZOOM, MAX_ZOOM)
  const k = z / camera.z
  S().setCamera({ x: sx - (sx - camera.x) * k, y: sy - (sy - camera.y) * k, z })
}

export function zoomTo(z: number) {
  const { viewport, camera } = S()
  zoomAt(viewport.w / 2, viewport.h / 2, z / camera.z)
}

export function contentBox(ids?: string[]): Box | null {
  const { items } = S()
  const list = (ids ? ids.map((id) => items[id]).filter(Boolean) : Object.values(items)).filter((i) => i.type !== 'comment')
  return unionBoxes(list.map((i) => itemBox(i, items)))
}

let anim = 0
export function animateCamera(to: Camera, ms = 260) {
  cancelAnimationFrame(anim)
  const from = S().camera
  const t0 = performance.now()
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms)
    const e = 1 - Math.pow(1 - k, 3)
    S().setCamera({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e })
    if (k < 1) anim = requestAnimationFrame(step)
  }
  anim = requestAnimationFrame(step)
}

export function fitBox(b: Box | null, pad = 80, animate = true, maxZoom = 1.5) {
  const { viewport } = S()
  if (!b || !b.w && !b.h) { (animate ? animateCamera : S().setCamera)({ x: viewport.w / 2, y: viewport.h / 2, z: 1 }); return }
  const p = Math.min(pad, viewport.w * 0.12)
  const z = clamp(Math.min((viewport.w - p * 2) / Math.max(b.w, 1), (viewport.h - p * 2) / Math.max(b.h, 1)), MIN_ZOOM, maxZoom)
  const cam = { x: viewport.w / 2 - (b.x + b.w / 2) * z, y: viewport.h / 2 - (b.y + b.h / 2) * z, z }
  if (animate) animateCamera(cam)
  else S().setCamera(cam)
}

export const fitAll = (animate = true) => fitBox(contentBox(), 80, animate)

export function viewBox(): Box {
  const { camera, viewport } = S()
  return { x: -camera.x / camera.z, y: -camera.y / camera.z, w: viewport.w / camera.z, h: viewport.h / camera.z }
}

export function viewCenter() {
  const v = viewBox()
  return { x: v.x + v.w / 2, y: v.y + v.h / 2 }
}

/** Frames in reading order (top-to-bottom rows, then left-to-right). */
export function orderedFrames(items = S().items) {
  return Object.values(items)
    .filter((i) => i.type === 'frame')
    .sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) * 0.5 ? a.y - b.y : a.x - b.x))
}
