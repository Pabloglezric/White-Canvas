// Higher-level editing operations built on the store's mutate/commit primitives.
import { uid } from '../lib/util'
import { adoptAssets, fileRefs, isLocalBoard } from './assets'
import { aabb, center, connectorGeom, itemBox, ptInBox, unionBoxes } from './geometry'
import { S, apply, canEdit, commit, isHidden, mutate, patchSilent, toast, useBoard, viewCenter, type BoardState, type Patch } from './store'
import type { Box, ConnectorItem, FrameItem, Item, Pt } from './types'

export function maxZ(items = S().items): number {
  let m = 0
  for (const id in items) if (items[id].z > m) m = items[id].z
  return m
}
export function minZ(items = S().items): number {
  let m = 0
  for (const id in items) if (items[id].z < m) m = items[id].z
  return m
}

/** Frame whose area contains the point (topmost), ignoring `exclude`. */
export function frameAt(p: Pt, exclude: Set<string> = new Set()): FrameItem | null {
  let best: FrameItem | null = null
  const { items } = S()
  for (const id in items) {
    const it = items[id]
    if (it.type !== 'frame' || exclude.has(id)) continue
    if (ptInBox(p, aabb(it)) && (!best || it.z >= best.z)) best = it
  }
  return best
}

/** Add items to the board, stacking them on top and adopting any frame they land in. */
export function addItems(list: Item[], opts: { select?: boolean; commit?: boolean; keepZ?: boolean } = {}) {
  if (!list.length) return
  const s = S()
  let z = maxZ()
  const patch: Patch = {}
  const newIds = new Set(list.map((i) => i.id))
  for (const raw of list) {
    const it = { ...raw, by: raw.by ?? s.me.id } as Item
    if (!opts.keepZ || !it.z) it.z = ++z
    if (it.type !== 'frame' && it.type !== 'connector' && it.parent === undefined) {
      const f = frameAt(center(it), newIds)
      if (f) it.parent = f.id
    }
    patch[it.id] = it
  }
  mutate(patch)
  if (opts.commit !== false) commit()
  if (opts.select !== false) useBoard.setState({ selection: list.map((i) => i.id) })
}

export function childrenOf(frameId: string, items = S().items): Item[] {
  return Object.values(items).filter((i) => i.parent === frameId)
}

/** Expand a selection with group members. */
export function withGroups(ids: string[], items = S().items): string[] {
  const groups = new Set<string>()
  for (const id of ids) { const g = items[id]?.group; if (g) groups.add(g) }
  if (!groups.size) return ids
  const out = new Set(ids)
  for (const id in items) if (items[id].group && groups.has(items[id].group!)) out.add(id)
  return [...out]
}

/** Ids that move together: the selection, group members, and children of selected frames. */
export function moveSet(ids: string[], items = S().items): string[] {
  const out = new Set(withGroups(ids, items))
  for (const id of [...out]) {
    if (items[id]?.type === 'frame') for (const c of childrenOf(id, items)) out.add(c.id)
  }
  // a connector whose two ends are both in the set belongs with it (copy, duplicate, delete, move)
  if (out.size > 1) {
    for (const id in items) {
      const it = items[id]
      if (it.type === 'connector' && !out.has(id) && it.a.item && it.b.item && out.has(it.a.item) && out.has(it.b.item)) out.add(id)
    }
  }
  return [...out]
}

export function removeItems(ids: string[]) {
  if (!ids.length || !canEdit()) return
  const { items } = S()
  const gone = new Set(ids.filter((id) => items[id] && !items[id].locked))
  if (!gone.size) return
  const patch: Patch = {}
  for (const id of gone) patch[id] = null
  for (const id in items) {
    const it = items[id]
    if (gone.has(id)) continue
    if (it.parent && gone.has(it.parent)) patch[id] = { ...it, parent: null }
    if (it.type === 'connector') {
      const aGone = it.a.item && gone.has(it.a.item), bGone = it.b.item && gone.has(it.b.item)
      if (aGone || bGone) {
        const g = connectorGeom(it, items)
        const p1 = g.pts[0], p2 = g.pts[g.pts.length - 1]
        patch[id] = {
          ...it,
          a: aGone ? { x: p1.x, y: p1.y } : it.a,
          b: bGone ? { x: p2.x, y: p2.y } : it.b,
        }
      }
    }
  }
  apply(patch)
  useBoard.setState({ selection: [], editingId: null })
}

export const deleteSelection = () => removeItems(moveSet(S().selection))

/** Clone items with fresh ids, remapping connector ends, frames and groups. */
export function cloneItems(list: Item[], dx: number, dy: number): Item[] {
  const idMap = new Map<string, string>()
  const groupMap = new Map<string, string>()
  for (const it of list) idMap.set(it.id, uid())
  return list.map((it) => {
    const n = { ...(JSON.parse(JSON.stringify(it)) as Item), id: idMap.get(it.id)!, rev: 0, x: it.x + dx, y: it.y + dy }
    delete n.votes
    if (n.group) { if (!groupMap.has(n.group)) groupMap.set(n.group, uid()); n.group = groupMap.get(n.group) }
    if (n.parent) n.parent = idMap.get(n.parent) ?? undefined
    if (n.type === 'connector') {
      for (const end of [n.a, n.b]) {
        end.x += dx; end.y += dy
        if (end.item) {
          if (idMap.has(end.item)) end.item = idMap.get(end.item)
          else {
            // The other end stays on the original board item: freeze its position instead.
            const g = connectorGeom(it as ConnectorItem, S().items)
            const p = end === n.a ? g.pts[0] : g.pts[g.pts.length - 1]
            delete end.item; delete end.ax; delete end.ay
            end.x = p.x + dx; end.y = p.y + dy
          }
        }
      }
    }
    return n
  })
}

export function duplicateSelection(dx = 24, dy = 24) {
  if (!canEdit()) return
  const { items, selection } = S()
  const list = moveSet(selection).map((id) => items[id]).filter(Boolean)
  if (!list.length) return
  addItems(cloneItems(list, dx, dy).sort((a, b) => a.z - b.z))
}

let clipboard: Item[] = []
const CLIP_MIME = 'application/x-white-canvas'

export function copySelection(cut = false) {
  const { items, selection } = S()
  const list = moveSet(selection).map((id) => items[id]).filter(Boolean)
  if (!list.length) return
  clipboard = JSON.parse(JSON.stringify(list))
  try {
    const text = JSON.stringify({ [CLIP_MIME]: clipboard })
    navigator.clipboard?.writeText(text).catch(() => {})
  } catch { /* clipboard blocked */ }
  if (cut) deleteSelection()
  else toast(`Copied ${list.length} item${list.length > 1 ? 's' : ''}`)
}

export function parseClipboardItems(text: string): Item[] | null {
  if (!text.startsWith('{"' + CLIP_MIME)) return null
  try { return JSON.parse(text)[CLIP_MIME] as Item[] } catch { return null }
}

export function pasteItems(list: Item[] = clipboard, at?: Pt) {
  if (!canEdit() || !list.length) return
  const box = unionBoxes(list.filter((i) => i.type !== 'connector').map((i) => aabb(i))) || { x: 0, y: 0, w: 0, h: 0 }
  const target = at || viewCenter()
  const dx = target.x - (box.x + box.w / 2), dy = target.y - (box.y + box.h / 2)
  addItems(cloneItems(list, dx, dy).sort((a, b) => a.z - b.z))
  // the items are on the board at once; any file they bring from elsewhere follows in the background
  void adoptForeignFiles()
}

// What has already been brought into each cloud board this session, or found out of reach: a file moves once,
// however often it is pasted.
const adopted = new Map<string, Map<string, string>>()
let adopting = false
let adoptAgain = false

/** Points every item on the board, and every undo step, at the board's own copy of a file. */
function repoint(moved: Map<string, string>) {
  const own = (src: string) => moved.get(src) ?? src
  const swap = (it: Item): Item => {
    if (it.type === 'image') {
      const src = own(it.src), thumb = it.thumb && own(it.thumb)
      return src === it.src && thumb === it.thumb ? it : { ...it, src, thumb }
    }
    if (it.type === 'ifc' || it.type === 'file') { const src = own(it.src); return src === it.src ? it : { ...it, src } }
    return it
  }
  for (const it of Object.values(S().items)) { const next = swap(it); if (next !== it) patchSilent(it.id, next) }
  // undo and redo would otherwise bring the old reference back
  const fix = (p: Patch): Patch => {
    let out = p
    for (const id in p) {
      const v = p[id], next = v && swap(v)
      if (next && next !== v) { if (out === p) out = { ...p }; out[id] = next }
    }
    return out
  }
  const steps = (list: BoardState['undo']) => {
    let changed = false
    const out = list.map((e) => {
      const before = fix(e.before), after = fix(e.after)
      if (before === e.before && after === e.after) return e
      changed = true
      return { before, after }
    })
    return changed ? out : list
  }
  const s = S()
  const undo = steps(s.undo), redo = steps(s.redo)
  if (undo !== s.undo || redo !== s.redo) useBoard.setState({ undo, redo })
}

/**
 * Gives the open cloud board its own copy of every file its items point at that lives elsewhere (in another board's
 * folder, or only on this device) and repoints the items when the copies exist. The board must not depend on the
 * other board surviving, or on its members having access to it. Until a copy lands, and if it fails, the item keeps
 * its old reference, which still opens for whoever can reach the original; the copy is tried again on the next paste,
 * when the connection returns and the next time an editor opens the board.
 */
export async function adoptForeignFiles(opts: { quiet?: boolean } = {}): Promise<void> {
  const boardId = S().boardId
  if (!boardId || isLocalBoard(boardId) || !canEdit() || S().status !== 'ready') return
  let moved = adopted.get(boardId)
  if (!moved) adopted.set(boardId, (moved = new Map()))
  const known = moved
  const outside = (src: string) => src.startsWith('local:') || (src.startsWith('asset:') && !src.startsWith(`asset:${boardId}/`))
  const waiting = Object.values(S().items).filter((it) => fileRefs(it).some((src) => outside(src) && !known.has(src)))
  if (!waiting.length || !navigator.onLine) { repoint(known); return }
  if (adopting) { adoptAgain = true; return }
  adopting = true
  let failed = false
  try { await adoptAssets(boardId, waiting, known) } catch { failed = true }
  adopting = false
  if (S().boardId === boardId) {
    repoint(known) // whatever did arrive
    if (failed && !opts.quiet) toast('Some files could not be copied to this board yet — they still point at the original')
  }
  if (adoptAgain) { adoptAgain = false; await adoptForeignFiles(opts) }
}

export function selectAll() {
  const { items } = S()
  useBoard.setState({ selection: Object.values(items).filter((i) => !i.locked && i.type !== 'comment' && !isHidden(i)).map((i) => i.id) })
}

export function groupSelection() {
  const { items, selection } = S()
  if (selection.length < 2 || !canEdit()) return
  const g = uid()
  const patch: Patch = {}
  for (const id of selection) if (items[id]) patch[id] = { ...items[id], group: g }
  apply(patch)
}

export function ungroupSelection() {
  const { items, selection } = S()
  if (!canEdit()) return
  const patch: Patch = {}
  for (const id of withGroups(selection)) if (items[id]?.group) patch[id] = { ...items[id], group: null }
  if (Object.keys(patch).length) apply(patch)
}

export function toggleLock(ids = S().selection) {
  const { items } = S()
  if (!canEdit() || !ids.length) return
  const lock = !ids.every((id) => items[id]?.locked)
  const patch: Patch = {}
  for (const id of ids) if (items[id]) patch[id] = { ...items[id], locked: lock }
  apply(patch)
  if (lock) useBoard.setState({ selection: [] })
  toast(lock ? 'Locked — right-click or long-press to unlock' : 'Unlocked')
}

export function reorder(dir: 'front' | 'back' | 'forward' | 'backward') {
  const { items, selection } = S()
  if (!canEdit() || !selection.length) return
  const sel = selection.map((id) => items[id]).filter(Boolean).sort((a, b) => a.z - b.z)
  const patch: Patch = {}
  if (dir === 'front') { let z = maxZ(); for (const it of sel) patch[it.id] = { ...it, z: ++z } }
  else if (dir === 'back') { let z = minZ() - sel.length; for (const it of sel) patch[it.id] = { ...it, z: z++ } }
  else {
    const all = Object.values(items).filter((i) => !selection.includes(i.id)).sort((a, b) => a.z - b.z)
    for (const it of sel) {
      const box = itemBox(it, items)
      const over = all.filter((o) => {
        const ob = itemBox(o, items)
        return ob.x < box.x + box.w && ob.x + ob.w > box.x && ob.y < box.y + box.h && ob.y + ob.h > box.y
      })
      if (dir === 'forward') {
        const next = over.find((o) => o.z > it.z)
        if (next) { const after = all.find((o) => o.z > next.z); patch[it.id] = { ...it, z: after ? (next.z + after.z) / 2 : next.z + 1 } }
      } else {
        const prev = [...over].reverse().find((o) => o.z < it.z)
        if (prev) { const before = [...all].reverse().find((o) => o.z < prev.z); patch[it.id] = { ...it, z: before ? (prev.z + before.z) / 2 : prev.z - 1 } }
      }
    }
  }
  if (Object.keys(patch).length) apply(patch)
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hdist' | 'vdist' | 'grid'

export function alignSelection(mode: AlignMode) {
  const { items, selection } = S()
  if (!canEdit()) return
  const sel = selection.map((id) => items[id]).filter((i) => i && i.type !== 'connector' && !i.locked)
  if (sel.length < 2) return
  const boxes = sel.map((i) => aabb(i))
  const u = unionBoxes(boxes)!
  const patch: Patch = {}
  const move = (it: Item, b: Box, nx: number, ny: number) => {
    const dx = nx - b.x, dy = ny - b.y
    if (!dx && !dy) return
    for (const id of moveSet([it.id])) {
      const m = (patch[id] as Item) || items[id]
      if (m) patch[id] = { ...m, x: m.x + dx, y: m.y + dy }
    }
  }
  if (mode === 'hdist' || mode === 'vdist') {
    const horiz = mode === 'hdist'
    const order = sel.map((it, i) => ({ it, b: boxes[i] })).sort((a, b) => (horiz ? a.b.x - b.b.x : a.b.y - b.b.y))
    const total = order.reduce((a, o) => a + (horiz ? o.b.w : o.b.h), 0)
    const gap = ((horiz ? u.w : u.h) - total) / (order.length - 1)
    let cur = horiz ? u.x : u.y
    for (const o of order) {
      move(o.it, o.b, horiz ? cur : o.b.x, horiz ? o.b.y : cur)
      cur += (horiz ? o.b.w : o.b.h) + gap
    }
  } else if (mode === 'grid') {
    const cols = Math.ceil(Math.sqrt(sel.length))
    const order = sel.map((it, i) => ({ it, b: boxes[i] })).sort((a, b) => (Math.abs(a.b.y - b.b.y) > 40 ? a.b.y - b.b.y : a.b.x - b.b.x))
    const cw = Math.max(...boxes.map((b) => b.w)) + 20, ch = Math.max(...boxes.map((b) => b.h)) + 20
    order.forEach((o, i) => move(o.it, o.b, u.x + (i % cols) * cw, u.y + Math.floor(i / cols) * ch))
  } else {
    sel.forEach((it, i) => {
      const b = boxes[i]
      let nx = b.x, ny = b.y
      if (mode === 'left') nx = u.x
      if (mode === 'right') nx = u.x + u.w - b.w
      if (mode === 'hcenter') nx = u.x + u.w / 2 - b.w / 2
      if (mode === 'top') ny = u.y
      if (mode === 'bottom') ny = u.y + u.h - b.h
      if (mode === 'vcenter') ny = u.y + u.h / 2 - b.h / 2
      move(it, b, nx, ny)
    })
  }
  if (Object.keys(patch).length) apply(patch)
}

export function nudge(dx: number, dy: number) {
  const { items, selection } = S()
  if (!canEdit()) return
  const patch: Patch = {}
  for (const id of moveSet(selection)) {
    const it = items[id]
    if (!it || it.locked) continue
    if (it.type === 'connector') {
      patch[id] = { ...it, a: it.a.item ? it.a : { ...it.a, x: it.a.x + dx, y: it.a.y + dy }, b: it.b.item ? it.b : { ...it.b, x: it.b.x + dx, y: it.b.y + dy } }
    } else patch[id] = { ...it, x: it.x + dx, y: it.y + dy }
  }
  apply(patch)
}

/** Re-evaluate which frame each moved item belongs to. */
export function reparent(ids: string[]): Patch {
  const { items } = S()
  const patch: Patch = {}
  const moving = new Set(ids)
  for (const id of ids) {
    const it = items[id]
    if (!it || it.type === 'frame' || it.type === 'connector') continue
    // children that travel with a selected frame keep their parent
    if (it.parent && moving.has(it.parent)) continue
    const f = frameAt(center(it))
    const p = f ? f.id : null
    if ((it.parent ?? null) !== p) patch[id] = { ...it, parent: p }
  }
  return patch
}

export function setStyle(partial: Record<string, unknown>, ids = S().selection) {
  const { items } = S()
  if (!canEdit()) return
  const patch: Patch = {}
  for (const id of ids) if (items[id] && !items[id].locked) patch[id] = { ...items[id], ...partial } as Item
  apply(patch)
}

/**
 * A position for new content of the given size: the requested centre if that area is empty, otherwise the
 * nearest free area to the right of everything on the board, so inserts never pile on top of existing work.
 */
export function freeSpot(at: Pt, w: number, h: number): Pt {
  const { items } = S()
  const taken = Object.values(items).filter((i) => i.type !== 'connector' && i.type !== 'frame' && i.type !== 'comment').map((i) => aabb(i))
  const hit = (cx: number, cy: number) => taken.some((b) => cx - w / 2 < b.x + b.w + 20 && cx + w / 2 > b.x - 20 && cy - h / 2 < b.y + b.h + 20 && cy + h / 2 > b.y - 20)
  if (!hit(at.x, at.y)) return at
  const all = unionBoxes(taken)!
  return { x: all.x + all.w + 120 + w / 2, y: at.y }
}
