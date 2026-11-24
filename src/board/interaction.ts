// Pointer, touch, wheel and keyboard handling for the canvas.
import { getStroke } from 'perfect-freehand'
import { round, uid } from '../lib/util'
import { make } from './defaults'
import {
  aabb, center, connectorGeom, distToSegment, intersects, itemBox, rad, rotatePt, snapBox, strokeToPath, toScreen,
  toWorld, unionBoxes,
} from './geometry'
import { finishEditing } from './items/RichText'
import {
  addItems, alignSelection, cloneItems, copySelection, deleteSelection, duplicateSelection, groupSelection, maxZ, moveSet,
  nudge, pasteItems, reorder, reparent, selectAll, toggleLock, ungroupSelection, withGroups,
} from './ops'
import {
  S, canComment, canEdit, commit, fitAll, fitBox, contentBox, mutate, orderedFrames, redo, rollback, toast, undo, update,
  useBoard, viewBox, zoomAt, zoomTo, type Patch,
} from './store'
import type { Box, ConnEnd, ConnectorItem, DrawItem, Item, Pt, TextItem, Tool } from './types'

export const bus: {
  cursor?: (p: Pt | null) => void
  importFiles?: (files: File[], at: Pt) => void
  importText?: (text: string, html: string, at: Pt) => void
} = {}

type Mode =
  | { k: 'idle' }
  | { k: 'pan'; p0: Pt; cam0: { x: number; y: number } }
  | { k: 'pinch'; ids: [number, number]; d0: number; c0: Pt; cam0: { x: number; y: number; z: number } }
  | { k: 'press'; id: string; p0: Pt; w0: Pt; wasSelected: boolean; alt: boolean }
  | { k: 'move'; w0: Pt; ids: string[]; orig: Record<string, Item>; box0: Box | null; others: Box[] }
  | { k: 'marquee'; w0: Pt; base: string[] }
  | { k: 'resize'; handle: string; ids: string[]; orig: Record<string, Item>; box0: Box }
  | { k: 'rotate'; c: Pt; a0: number; ids: string[]; orig: Record<string, Item> }
  | { k: 'draw'; pts: number[]; tool: 'pen' | 'highlighter'; color: string; size: number }
  | { k: 'erase' }
  | { k: 'create'; tool: Tool; w0: Pt; p0: Pt; id: string | null }
  | { k: 'connect'; id: string; end: 'a' | 'b'; isNew: boolean; p0: Pt; dot?: { src: string; side: string } }

const CONNECTABLE = new Set(['sticky', 'text', 'shape', 'image', 'embed', 'ifc', 'card', 'table', 'code', 'file', 'chart', 'frame'])
const ACTIVATABLE = new Set(['sticky', 'text', 'shape', 'connector', 'frame', 'embed', 'ifc', 'card', 'table', 'code'])
const CREATE_TOOLS = new Set<Tool>(['sticky', 'text', 'shape', 'frame', 'comment', 'card', 'table', 'code'])

export function activate(id: string) {
  const it = S().items[id]
  if (!it) return
  if (it.type === 'comment') { useBoard.setState({ activeComment: id, selection: [] }); return }
  if (it.locked) return
  const interactive = it.type === 'embed' || it.type === 'ifc'
  if (!interactive && !canEdit()) return
  if (ACTIVATABLE.has(it.type)) useBoard.setState({ editingId: id, selection: [id] })
}

function isTyping(e: Event) {
  const t = e.target as HTMLElement | null
  if (!t || !t.tagName) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
}

function creationScale(z: number) {
  if (z >= 0.35 && z <= 3) return 1
  return Math.pow(2, Math.round(Math.log2(1 / z)))
}

export class Interaction {
  private mode: Mode = { k: 'idle' }
  private touches = new Map<number, Pt>()
  private pid = -1
  private space = false
  private last: Pt = { x: 0, y: 0 }
  private penSeen = false
  private longPress: ReturnType<typeof setTimeout> | undefined
  private inkRaf = 0
  private trackpadUntil = 0

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointercancel', this.onCancel)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('dblclick', this.onDbl)
    el.addEventListener('contextmenu', this.onContext)
    el.addEventListener('dragover', this.onDragOver)
    el.addEventListener('drop', this.onDrop)
    el.addEventListener('pointerleave', this.onLeave)
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('paste', this.onPaste)
    window.addEventListener('blur', this.onBlur)
  }

  destroy() {
    const el = this.el
    el.removeEventListener('pointerdown', this.onDown)
    el.removeEventListener('pointermove', this.onMove)
    el.removeEventListener('pointerup', this.onUp)
    el.removeEventListener('pointercancel', this.onCancel)
    el.removeEventListener('wheel', this.onWheel)
    el.removeEventListener('dblclick', this.onDbl)
    el.removeEventListener('contextmenu', this.onContext)
    el.removeEventListener('dragover', this.onDragOver)
    el.removeEventListener('drop', this.onDrop)
    el.removeEventListener('pointerleave', this.onLeave)
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('paste', this.onPaste)
    window.removeEventListener('blur', this.onBlur)
    clearTimeout(this.longPress)
  }

  // ---------- helpers ----------

  private screen(e: { clientX: number; clientY: number }): Pt {
    const r = this.el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  private world(p: Pt): Pt { const c = S().camera; return toWorld(c, p.x, p.y) }

  private hit(e: Event): Item | null {
    const t = (e.target as HTMLElement).closest?.('[data-id]') as HTMLElement | null
    return t ? S().items[t.dataset.id!] || null : null
  }

  /** Topmost connectable item under a screen point. */
  private connectTarget(e: PointerEvent, exclude: string[]): Item | null {
    const els = document.elementsFromPoint(e.clientX, e.clientY)
    const { items } = S()
    for (const el of els) {
      const host = (el as HTMLElement).closest?.('[data-id]') as HTMLElement | null
      if (!host) continue
      const it = items[host.dataset.id!]
      if (it && CONNECTABLE.has(it.type) && it.type !== 'frame' && !exclude.includes(it.id)) return it
    }
    return null
  }

  private endFor(it: Item, w: Pt): ConnEnd {
    const z = S().camera.z
    const c = center(it)
    const local = rotatePt(w, c, -(it.rot || 0))
    const sides: [number, number][] = [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1]]
    for (const [ax, ay] of sides) {
      const p = { x: it.x + it.w * ax, y: it.y + it.h * ay }
      if (Math.hypot(p.x - local.x, p.y - local.y) * z < 18) return { item: it.id, ax, ay, x: w.x, y: w.y }
    }
    return { item: it.id, x: w.x, y: w.y }
  }

  private setInk(d: string | null, color = '#000', opacity = 1) {
    const path = document.getElementById('wc-live-ink')
    if (!path) return
    if (d == null) { path.setAttribute('d', ''); return }
    path.setAttribute('d', d)
    path.setAttribute('fill', color)
    path.setAttribute('opacity', String(opacity))
  }

  private cancelGesture() {
    clearTimeout(this.longPress)
    rollback()
    this.setInk(null)
    useBoard.setState({ guides: [], marquee: null, connectHover: null })
    this.mode = { k: 'idle' }
  }

  private afterTool() {
    const s = S()
    if (!s.toolLock && s.tool !== 'pen' && s.tool !== 'highlighter' && s.tool !== 'eraser' && s.tool !== 'hand') useBoard.setState({ tool: 'select' })
  }

  // ---------- pointer down ----------

  private onDown = (e: PointerEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-interactive]') || target.closest('[data-editing="true"]')) return
    const p = this.screen(e)
    if (e.pointerType === 'touch') this.touches.set(e.pointerId, p)
    if (e.pointerType === 'pen' && !this.penSeen) {
      this.penSeen = true
      if (S().fingerDraws) { S().setPrefs({ fingerDraws: false }); toast('Stylus detected — fingers now pan while you draw') }
    }
    const s = S()
    if (s.ctxMenu) useBoard.setState({ ctxMenu: null })
    if (s.editingId) finishEditing()
    const act = document.activeElement as HTMLElement | null
    if (act && act !== document.body && !this.el.contains(act)) act.blur()
    try { this.el.setPointerCapture(e.pointerId) } catch { /* ignore */ }

    if (e.pointerType === 'touch' && this.touches.size >= 2) { this.startPinch(); return }
    if (this.mode.k !== 'idle') return
    this.pid = e.pointerId
    this.last = p
    const w = this.world(p)
    const tool = s.tool
    if (s.following) useBoard.setState({ following: null })

    if (e.button === 1 || (e.button === 0 && this.space) || tool === 'hand' || s.presenting != null) {
      this.mode = { k: 'pan', p0: p, cam0: { x: s.camera.x, y: s.camera.y } }
      this.el.classList.add('is-panning')
      return
    }
    if (e.button !== 0) return

    const handle = target.closest('[data-handle]') as HTMLElement | null
    if (handle && canEdit()) { this.startHandle(handle.dataset.handle!, e, p, w); return }

    if (tool === 'select') { this.downSelect(e, p, w); return }

    if (tool === 'pen' || tool === 'highlighter') {
      if (!canEdit()) return
      if (e.pointerType === 'touch' && !s.fingerDraws) { this.mode = { k: 'pan', p0: p, cam0: { x: s.camera.x, y: s.camera.y } }; return }
      const size = (tool === 'pen' ? s.penSize : s.hlSize) / s.camera.z
      this.mode = { k: 'draw', pts: [w.x, w.y, e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5], tool, color: tool === 'pen' ? s.penColor : s.hlColor, size }
      useBoard.setState({ selection: [] })
      return
    }
    if (tool === 'eraser') {
      if (!canEdit()) return
      if (e.pointerType === 'touch' && !s.fingerDraws) { this.mode = { k: 'pan', p0: p, cam0: { x: s.camera.x, y: s.camera.y } }; return }
      this.mode = { k: 'erase' }
      this.eraseAt(w)
      return
    }
    if (tool === 'connector') {
      if (!canEdit()) return
      const src = this.connectTarget(e, [])
      const a: ConnEnd = src ? this.endFor(src, w) : { x: w.x, y: w.y }
      const c = make.connector(a, { x: w.x, y: w.y }, { route: s.connRoute, z: maxZ() + 1, by: s.me.id })
      mutate({ [c.id]: c })
      this.mode = { k: 'connect', id: c.id, end: 'b', isNew: true, p0: p }
      return
    }
    if (CREATE_TOOLS.has(tool)) {
      if (tool === 'comment' ? !canComment() : !canEdit()) return
      this.mode = { k: 'create', tool, w0: w, p0: p, id: null }
    }
  }

  private downSelect(e: PointerEvent, p: Pt, w: Pt) {
    const s = S()
    let it = this.hit(e)
    if (it?.locked) it = null
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    if (it) {
      const wasSelected = s.selection.includes(it.id)
      if (additive) {
        const group = withGroups([it.id])
        useBoard.setState({ selection: wasSelected ? s.selection.filter((id) => !group.includes(id)) : [...new Set([...s.selection, ...group])] })
        return
      }
      if (!wasSelected && it.type !== 'comment') useBoard.setState({ selection: withGroups([it.id]) })
      this.mode = { k: 'press', id: it.id, p0: p, w0: w, wasSelected: wasSelected && s.selection.length === 1, alt: e.altKey }
      if (e.pointerType === 'touch') {
        this.longPress = setTimeout(() => {
          if (this.mode.k === 'press') {
            navigator.vibrate?.(8)
            useBoard.setState({ ctxMenu: { x: p.x, y: p.y, world: w } })
            this.mode = { k: 'idle' }
          }
        }, 520)
      }
      return
    }
    if (e.pointerType === 'touch') {
      this.mode = { k: 'pan', p0: p, cam0: { x: s.camera.x, y: s.camera.y } }
      this.longPress = setTimeout(() => {
        if (this.mode.k === 'pan' && Math.hypot(this.last.x - p.x, this.last.y - p.y) < 8) {
          navigator.vibrate?.(8)
          this.mode = { k: 'marquee', w0: w, base: [] }
          useBoard.setState({ selection: [], marquee: { x: w.x, y: w.y, w: 0, h: 0 } })
        }
      }, 480)
      if (s.selection.length) useBoard.setState({ selection: [] })
      return
    }
    this.mode = { k: 'marquee', w0: w, base: additive ? s.selection : [] }
    if (!additive && s.selection.length) useBoard.setState({ selection: [] })
    if (s.activeComment) useBoard.setState({ activeComment: null })
  }

  private startHandle(h: string, e: PointerEvent, p: Pt, w: Pt) {
    const s = S()
    const sel = s.selection.map((id) => s.items[id]).filter((i) => i && !i.locked)
    if (!sel.length) return
    if (h.startsWith('end-')) {
      this.mode = { k: 'connect', id: sel[0].id, end: h.slice(4) as 'a' | 'b', isNew: false, p0: p }
      return
    }
    if (h.startsWith('dot-')) {
      const src = sel[0]
      const side = h.slice(4)
      const [ax, ay] = side === 'l' ? [0, 0.5] : side === 'r' ? [1, 0.5] : side === 't' ? [0.5, 0] : [0.5, 1]
      const c = make.connector({ item: src.id, ax, ay, x: w.x, y: w.y }, { x: w.x, y: w.y }, { route: s.connRoute, z: maxZ() + 1, by: s.me.id })
      mutate({ [c.id]: c })
      this.mode = { k: 'connect', id: c.id, end: 'b', isNew: true, p0: p, dot: { src: src.id, side } }
      return
    }
    const ids = h === 'rot' || sel.length > 1 ? moveSet(sel.map((i) => i.id)).filter((id) => !s.items[id].locked) : [sel[0].id]
    const orig: Record<string, Item> = {}
    for (const id of ids) orig[id] = s.items[id]
    const box0 = unionBoxes(sel.filter((i) => i.type !== 'connector').map((i) => aabb(i))) || { x: w.x, y: w.y, w: 1, h: 1 }
    if (h === 'rot') {
      const c = sel.length === 1 ? center(sel[0]) : center(box0)
      this.mode = { k: 'rotate', c, a0: Math.atan2(w.y - c.y, w.x - c.x), ids, orig }
    } else {
      this.mode = { k: 'resize', handle: h, ids, orig, box0 }
    }
  }

  private startPinch() {
    if (this.mode.k !== 'pinch') this.cancelGesture()
    const ids = [...this.touches.keys()].slice(0, 2) as [number, number]
    const a = this.touches.get(ids[0])!, b = this.touches.get(ids[1])!
    const cam = S().camera
    this.mode = { k: 'pinch', ids, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam0: { ...cam } }
    if (S().following) useBoard.setState({ following: null })
  }

  // ---------- pointer move ----------

  private onMove = (e: PointerEvent) => {
    const p = this.screen(e)
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, p)
    const m = this.mode
    if (m.k === 'pinch') {
      const a = this.touches.get(m.ids[0]), b = this.touches.get(m.ids[1])
      if (!a || !b) return
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const z = Math.min(8, Math.max(0.02, m.cam0.z * (d / m.d0)))
      const wx = (m.c0.x - m.cam0.x) / m.cam0.z, wy = (m.c0.y - m.cam0.y) / m.cam0.z
      S().setCamera({ x: c.x - wx * z, y: c.y - wy * z, z })
      return
    }
    const w = this.world(p)
    if (e.pointerType !== 'touch') bus.cursor?.(w)
    if (m.k === 'idle' || e.pointerId !== this.pid) return
    this.last = p
    const s = S()
    const z = s.camera.z

    switch (m.k) {
      case 'pan':
        s.setCamera({ x: m.cam0.x + (p.x - m.p0.x), y: m.cam0.y + (p.y - m.p0.y), z })
        break
      case 'press': {
        const thresh = e.pointerType === 'touch' ? 9 : 4
        if (Math.hypot(p.x - m.p0.x, p.y - m.p0.y) < thresh) break
        clearTimeout(this.longPress)
        const it = s.items[m.id]
        if (!it) { this.mode = { k: 'idle' }; break }
        if (it.type === 'comment' ? !canComment() : !canEdit()) { this.mode = { k: 'idle' }; break }
        if (it.type === 'comment') useBoard.setState({ selection: [it.id] })
        if (m.alt) {
          const list = moveSet(S().selection).map((id) => s.items[id]).filter(Boolean)
          addItems(cloneItems(list, 0, 0).sort((a, b) => a.z - b.z), { commit: false })
        }
        this.beginMove(m.w0)
        this.moveTo(w, e)
        break
      }
      case 'move':
        this.moveTo(w, e)
        break
      case 'marquee': {
        const box = { x: Math.min(m.w0.x, w.x), y: Math.min(m.w0.y, w.y), w: Math.abs(w.x - m.w0.x), h: Math.abs(w.y - m.w0.y) }
        const ids: string[] = [...m.base]
        for (const id in s.items) {
          const it = s.items[id]
          if (it.locked || it.type === 'comment' || ids.includes(id)) continue
          const b = itemBox(it, s.items)
          // frames must be fully enclosed; everything else just touched
          if (it.type === 'frame' ? b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h : intersects(box, b)) ids.push(id)
        }
        useBoard.setState({ marquee: box, selection: withGroups(ids) })
        break
      }
      case 'resize':
        this.resizeTo(w, e)
        break
      case 'rotate': {
        let delta = ((Math.atan2(w.y - m.c.y, w.x - m.c.x) - m.a0) * 180) / Math.PI
        const first = m.orig[m.ids[0]]
        if (e.shiftKey) delta = Math.round(delta / 15) * 15
        else if (m.ids.length === 1) {
          const r = (((first.rot || 0) + delta) % 360 + 360) % 360
          const near = Math.round(r / 45) * 45
          if (Math.abs(r - near) < 3) delta += near - r
        }
        const patch: Patch = {}
        for (const id of m.ids) {
          const o = m.orig[id]
          if (o.type === 'connector') {
            const mv = (end: ConnEnd) => (end.item ? end : { ...end, ...rotatePt({ x: end.x, y: end.y }, m.c, delta) })
            patch[id] = { ...o, a: mv(o.a), b: mv(o.b) }
          } else {
            const c = rotatePt(center(o), m.c, delta)
            patch[id] = { ...o, x: c.x - o.w / 2, y: c.y - o.h / 2, rot: round((((o.rot || 0) + delta) % 360 + 360) % 360, 1) }
          }
        }
        mutate(patch)
        break
      }
      case 'draw': {
        const evs = e.getCoalescedEvents?.() || [e]
        const pts = m.pts
        for (const ev of evs.length ? evs : [e]) {
          const q = this.world(this.screen(ev))
          const lx = pts[pts.length - 3], ly = pts[pts.length - 2]
          if (Math.hypot(q.x - lx, q.y - ly) * z < 1.2) continue
          pts.push(q.x, q.y, ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5)
        }
        if (!this.inkRaf) this.inkRaf = requestAnimationFrame(() => { this.inkRaf = 0; this.renderInk() })
        break
      }
      case 'erase':
        this.eraseAt(w)
        break
      case 'create':
        this.createDrag(m, p, w, e)
        break
      case 'connect': {
        const c = s.items[m.id] as ConnectorItem | undefined
        if (!c) break
        const other = m.end === 'a' ? c.b : c.a
        const target = this.connectTarget(e, [other.item || '', m.id])
        update(m.id, { [m.end]: target ? this.endFor(target, w) : { x: w.x, y: w.y } })
        if (s.connectHover !== (target?.id || null)) useBoard.setState({ connectHover: target?.id || null })
        break
      }
    }
  }

  private beginMove(w0: Pt) {
    const s = S()
    const ids = moveSet(s.selection).filter((id) => s.items[id] && !s.items[id].locked)
    const orig: Record<string, Item> = {}
    for (const id of ids) orig[id] = s.items[id]
    const box0 = unionBoxes(ids.map((id) => orig[id]).filter((i) => i.type !== 'connector').map((i) => aabb(i)))
    const view = viewBox()
    const others: Box[] = []
    if (s.snap) {
      const moving = new Set(ids)
      for (const id in s.items) {
        const it = s.items[id]
        if (moving.has(id) || it.type === 'connector' || it.type === 'draw' || it.type === 'comment') continue
        const b = aabb(it)
        if (intersects(view, b)) { others.push(b); if (others.length > 160) break }
      }
    }
    this.mode = { k: 'move', w0, ids, orig, box0, others }
  }

  private moveTo(w: Pt, e: PointerEvent) {
    const m = this.mode
    if (m.k !== 'move') return
    const s = S()
    let dx = w.x - m.w0.x, dy = w.y - m.w0.y
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
    let guides = s.guides.length ? [] : s.guides
    if (s.snap && m.box0 && !e.ctrlKey && !e.metaKey && m.others.length) {
      const r = snapBox({ x: m.box0.x + dx, y: m.box0.y + dy, w: m.box0.w, h: m.box0.h }, m.others, 6 / s.camera.z)
      dx += r.dx; dy += r.dy
      guides = r.guides
    }
    if (guides !== s.guides) useBoard.setState({ guides })
    const moving = new Set(m.ids)
    const patch: Patch = {}
    for (const id of m.ids) {
      const o = m.orig[id]
      if (o.type === 'connector') {
        const mv = (end: ConnEnd) => (end.item && !moving.has(end.item) ? end : end.item ? end : { ...end, x: end.x + dx, y: end.y + dy })
        patch[id] = { ...o, a: mv(o.a), b: mv(o.b) }
      } else patch[id] = { ...o, x: o.x + dx, y: o.y + dy }
    }
    mutate(patch)
  }

  private resizeTo(w: Pt, e: PointerEvent) {
    const m = this.mode
    if (m.k !== 'resize') return
    const h = m.handle
    const hx = h.includes('e') ? 1 : h.includes('w') ? -1 : 0
    const hy = h.includes('s') ? 1 : h.includes('n') ? -1 : 0
    const patch: Patch = {}
    if (m.ids.length === 1) {
      const o = m.orig[m.ids[0]]
      const t = rad(o.rot || 0)
      const u = { x: Math.cos(t), y: Math.sin(t) }, v = { x: -Math.sin(t), y: Math.cos(t) }
      const c0 = center(o)
      const A = { x: c0.x - u.x * ((hx * o.w) / 2) - v.x * ((hy * o.h) / 2), y: c0.y - u.y * ((hx * o.w) / 2) - v.y * ((hy * o.h) / 2) }
      const d = { x: w.x - A.x, y: w.y - A.y }
      const min = o.type === 'text' ? 24 : o.type === 'frame' ? 60 : 12
      let lw = hx ? Math.max(min, (d.x * u.x + d.y * u.y) * hx) : o.w
      let lh = hy ? Math.max(min, (d.x * v.x + d.y * v.y) * hy) : o.h
      const corner = hx !== 0 && hy !== 0
      const aspect = corner && (o.type === 'text' || ((o.type === 'image' || o.type === 'sticky') !== e.shiftKey))
      if (aspect) {
        const k = Math.max(lw / o.w, lh / o.h)
        lw = o.w * k; lh = o.h * k
      }
      const C = { x: A.x + u.x * ((hx * lw) / 2) + v.x * ((hy * lh) / 2), y: A.y + u.y * ((hx * lw) / 2) + v.y * ((hy * lh) / 2) }
      const next = { ...o, x: C.x - lw / 2, y: C.y - lh / 2, w: lw, h: lh } as Item
      if (o.type === 'text') {
        const tn = next as TextItem
        if (corner) tn.fontSize = round(Math.max(6, (o.fontSize || 20) * (lw / o.w)), 1)
        else if (hx) { tn.autoW = false; tn.h = o.h; tn.y = o.y }
      }
      if (o.type === 'sticky' && corner && aspect) (next as typeof o).fontSize = round(Math.max(6, (o.fontSize || 18) * (lw / o.w)), 1)
      patch[o.id] = next
    } else {
      const b = m.box0
      const ax = hx > 0 ? b.x : b.x + b.w, ay = hy > 0 ? b.y : b.y + b.h
      const k = Math.max(0.05, Math.max(hx ? ((w.x - ax) * hx) / b.w : 0, hy ? ((w.y - ay) * hy) / b.h : 0))
      for (const id of m.ids) {
        const o = m.orig[id]
        if (o.type === 'connector') {
          const sc = (end: ConnEnd) => (end.item ? end : { ...end, x: ax + (end.x - ax) * k, y: ay + (end.y - ay) * k })
          patch[id] = { ...o, a: sc(o.a), b: sc(o.b) }
          continue
        }
        const c = center(o)
        const nc = { x: ax + (c.x - ax) * k, y: ay + (c.y - ay) * k }
        const next = { ...o, w: o.w * k, h: o.h * k, x: nc.x - (o.w * k) / 2, y: nc.y - (o.h * k) / 2 } as Item
        if ('fontSize' in o && typeof o.fontSize === 'number') (next as { fontSize?: number }).fontSize = round(Math.max(4, o.fontSize * k), 1)
        patch[id] = next
      }
    }
    mutate(patch)
  }

  private renderInk() {
    const m = this.mode
    if (m.k !== 'draw') return
    const input: number[][] = []
    for (let i = 0; i < m.pts.length; i += 3) input.push([m.pts[i], m.pts[i + 1], m.pts[i + 2]])
    const outline = getStroke(input, {
      size: m.size, thinning: m.tool === 'highlighter' ? 0 : 0.55, smoothing: 0.55, streamline: 0.4,
      simulatePressure: input.every((q) => q[2] === 0.5),
    })
    this.setInk(strokeToPath(outline), m.color, m.tool === 'highlighter' ? 0.45 : 1)
  }

  private eraseAt(w: Pt) {
    const s = S()
    const r = 10 / s.camera.z
    const patch: Patch = {}
    for (const id in s.items) {
      const it = s.items[id]
      if (it.type !== 'draw' || it.locked) continue
      const b = aabb(it)
      if (w.x < b.x - r || w.x > b.x + b.w + r || w.y < b.y - r || w.y > b.y + b.h + r) continue
      const local = rotatePt(w, center(it), -(it.rot || 0))
      const sx = it.w / (it.w0 || 1), sy = it.h / (it.h0 || 1)
      const q = { x: local.x - it.x, y: local.y - it.y }
      const reach = it.size / 2 + r
      const n = it.pts.length
      if (n === 3 && Math.hypot(it.pts[0] * sx - q.x, it.pts[1] * sy - q.y) < reach) patch[id] = null
      for (let i = 3; i < n; i += 3) {
        if (distToSegment(q, { x: it.pts[i - 3] * sx, y: it.pts[i - 2] * sy }, { x: it.pts[i] * sx, y: it.pts[i + 1] * sy }) < reach) { patch[id] = null; break }
      }
    }
    if (Object.keys(patch).length) mutate(patch)
  }

  private createDrag(m: Extract<Mode, { k: 'create' }>, p: Pt, w: Pt, e: PointerEvent) {
    const sizable = m.tool === 'shape' || m.tool === 'frame' || m.tool === 'sticky' || m.tool === 'text'
    if (!sizable) return
    if (!m.id) {
      if (Math.hypot(p.x - m.p0.x, p.y - m.p0.y) < 6) return
      const it = this.newItem(m.tool, m.w0, 1)
      if (!it) return
      it.w = 1; it.h = 1
      if (it.type === 'text') (it as TextItem).autoW = false
      m.id = it.id
      addItems([it], { commit: false, select: false })
    }
    let bw = Math.abs(w.x - m.w0.x), bh = Math.abs(w.y - m.w0.y)
    if (e.shiftKey || m.tool === 'sticky') bw = bh = Math.max(bw, bh)
    const x = w.x < m.w0.x ? m.w0.x - bw : m.w0.x, y = w.y < m.w0.y ? m.w0.y - bh : m.w0.y
    const cur = S().items[m.id]
    if (!cur) return
    const next = { ...cur, x, y, w: Math.max(1, bw), h: m.tool === 'text' ? cur.h : Math.max(1, bh) } as Item
    if (next.type === 'sticky') next.fontSize = Math.max(8, Math.round(bw * 0.09))
    mutate({ [m.id]: next })
  }

  private newItem(tool: Tool, w: Pt, k: number): Item | null {
    const s = S()
    switch (tool) {
      case 'sticky': return make.sticky({ x: w.x - 100 * k, y: w.y - 100 * k, w: 200 * k, h: 200 * k, fontSize: 18 * k, fill: s.stickyColor, author: undefined })
      case 'text': return make.text({ x: w.x, y: w.y - 14 * k, fontSize: 20 * k, autoW: true, w: 8, h: 28 * k })
      case 'shape': return make.shape({ x: w.x - 80 * k, y: w.y - 50 * k, w: 160 * k, h: 100 * k, kind: s.shapeKind, fontSize: 16 * k, strokeW: 2 * k })
      case 'frame': {
        const n = orderedFrames().length + 1
        return make.frame({ x: w.x - 400 * k, y: w.y - 300 * k, w: 800 * k, h: 600 * k, title: `Frame ${n}`, z: 0 })
      }
      case 'card': return make.card({ x: w.x - 140 * k, y: w.y - 60 * k, w: 280 * k, h: 120 * k })
      case 'table': return make.table({ x: w.x - 210, y: w.y - 60 })
      case 'code': return make.code({ x: w.x - 210, y: w.y - 110 })
      case 'comment': return make.comment({ x: w.x, y: w.y, by: s.me.id })
    }
    return null
  }

  // ---------- pointer up ----------

  private onUp = (e: PointerEvent) => {
    this.touches.delete(e.pointerId)
    try { this.el.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    const m = this.mode
    if (m.k === 'pinch') { if (this.touches.size < 2) this.mode = { k: 'idle' }; return }
    if (m.k === 'idle' || e.pointerId !== this.pid) return
    clearTimeout(this.longPress)
    const p = this.screen(e), w = this.world(p)
    const s = S()
    this.mode = { k: 'idle' }
    this.el.classList.remove('is-panning')

    switch (m.k) {
      case 'press': {
        const it = s.items[m.id]
        if (!it) break
        if (it.type === 'comment') activate(it.id)
        else if (m.wasSelected) activate(it.id)
        break
      }
      case 'move': {
        const extra = reparent(m.ids)
        if (Object.keys(extra).length) mutate(extra)
        commit()
        useBoard.setState({ guides: [] })
        break
      }
      case 'marquee':
        useBoard.setState({ marquee: null })
        break
      case 'resize': case 'rotate':
        commit()
        break
      case 'draw': {
        cancelAnimationFrame(this.inkRaf); this.inkRaf = 0
        this.setInk(null)
        const pts = m.pts
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
        for (let i = 0; i < pts.length; i += 3) {
          if (pts[i] < x1) x1 = pts[i]
          if (pts[i] > x2) x2 = pts[i]
          if (pts[i + 1] < y1) y1 = pts[i + 1]
          if (pts[i + 1] > y2) y2 = pts[i + 1]
        }
        const prec = s.camera.z < 0.5 ? 0 : 1
        const rel: number[] = []
        for (let i = 0; i < pts.length; i += 3) rel.push(round(pts[i] - x1, prec), round(pts[i + 1] - y1, prec), round(pts[i + 2], 2))
        const bw = Math.max(1, x2 - x1), bh = Math.max(1, y2 - y1)
        const it: DrawItem = {
          id: uid(), type: 'draw', x: x1, y: y1, w: bw, h: bh, w0: bw, h0: bh, rot: 0, z: 0, rev: 0,
          pts: rel, stroke: m.color, size: round(m.size, 2), tool: m.tool, parent: null,
        }
        addItems([it], { select: false })
        break
      }
      case 'erase':
        commit()
        break
      case 'create': {
        let id = m.id
        if (!id) {
          const it = this.newItem(m.tool, m.w0, creationScale(s.camera.z))
          if (!it) break
          id = it.id
          addItems([it], { commit: false, select: false })
        } else if (m.tool === 'sticky') {
          const cur = S().items[id]
          if (cur && cur.w < 30) mutate({ [id]: { ...cur, w: 200, h: 200, fontSize: 18 } as Item })
        }
        const made = S().items[id]
        if (made?.type === 'frame') {
          // adopt items that already sit inside the new frame
          const fb = aabb(made)
          const patch: Patch = {}
          for (const o of Object.values(S().items)) {
            if (o.id === id || o.type === 'frame' || o.type === 'connector' || o.parent) continue
            const c = center(o)
            if (c.x > fb.x && c.x < fb.x + fb.w && c.y > fb.y && c.y < fb.y + fb.h) patch[o.id] = { ...o, parent: id }
          }
          if (Object.keys(patch).length) mutate(patch)
        }
        commit()
        this.afterTool()
        if (m.tool === 'comment') useBoard.setState({ activeComment: id, selection: [] })
        else if (m.tool === 'frame' || m.tool === 'table') useBoard.setState({ selection: [id] })
        else useBoard.setState({ selection: [id], editingId: id })
        break
      }
      case 'connect': {
        useBoard.setState({ connectHover: null })
        const c = S().items[m.id] as ConnectorItem | undefined
        if (!c) break
        const dragged = Math.hypot(p.x - m.p0.x, p.y - m.p0.y) > 8
        if (m.isNew && !dragged) {
          if (m.dot) { this.quickCreate(c, m.dot); break }
          mutate({ [m.id]: null }); commit({ history: false }); break
        }
        commit()
        useBoard.setState({ selection: [m.id] })
        if (m.isNew) this.afterTool()
        break
      }
    }
  }

  /** Clicking a connection dot clones the shape in that direction and links the two. */
  private quickCreate(c: ConnectorItem, dot: { src: string; side: string }) {
    const s = S()
    const src = s.items[dot.src]
    if (!src) { mutate({ [c.id]: null }); commit({ history: false }); return }
    const gap = Math.max(60, Math.min(src.w, src.h) * 0.6)
    const dx = dot.side === 'l' ? -(src.w + gap) : dot.side === 'r' ? src.w + gap : 0
    const dy = dot.side === 't' ? -(src.h + gap) : dot.side === 'b' ? src.h + gap : 0
    const [clone] = cloneItems([src], dx, dy)
    if ('html' in clone) clone.html = ''
    clone.z = maxZ() + 1
    const [ax, ay] = dot.side === 'l' ? [1, 0.5] : dot.side === 'r' ? [0, 0.5] : dot.side === 't' ? [0.5, 1] : [0.5, 0]
    mutate({ [clone.id]: clone, [c.id]: { ...c, b: { item: clone.id, ax, ay, x: clone.x, y: clone.y } } })
    commit()
    useBoard.setState({ selection: [clone.id], editingId: 'html' in clone ? clone.id : null })
  }

  private onCancel = (e: PointerEvent) => {
    this.touches.delete(e.pointerId)
    if (this.mode.k === 'pinch') { if (this.touches.size < 2) this.mode = { k: 'idle' }; return }
    if (e.pointerId === this.pid) this.cancelGesture()
  }

  private onLeave = () => { bus.cursor?.(null) }
  private onBlur = () => { this.space = false; this.el.classList.remove('can-pan') }

  // ---------- wheel ----------

  private onWheel = (e: WheelEvent) => {
    const t = e.target as HTMLElement
    if (t.tagName === 'TEXTAREA' && t.closest('[data-editing="true"]')) return
    e.preventDefault()
    const s = S()
    if (s.following) useBoard.setState({ following: null })
    const p = this.screen(e)
    const unit = e.deltaMode === 1 ? 33 : 1
    if (e.ctrlKey || e.metaKey) { zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * 0.01)); return }
    const now = performance.now()
    const wd = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY
    const mouseLike = e.deltaMode === 1 || (e.deltaX === 0 && wd != null && wd !== 0 && Math.abs(wd) % 120 === 0)
    if (!mouseLike) this.trackpadUntil = now + 350
    const mouse = s.navMode === 'mouse' || (s.navMode === 'auto' && mouseLike && now > this.trackpadUntil)
    if (mouse && !e.shiftKey) zoomAt(p.x, p.y, Math.exp(-e.deltaY * unit * 0.0016))
    else if (mouse) s.setCamera({ ...s.camera, x: s.camera.x - e.deltaY * unit })
    else s.setCamera({ ...s.camera, x: s.camera.x - e.deltaX * unit, y: s.camera.y - e.deltaY * unit })
  }

  private onDbl = (e: MouseEvent) => {
    const s = S()
    if (s.editingId || s.tool !== 'select' || s.presenting != null) return
    const t = e.target as HTMLElement
    if (t.closest('[data-interactive]') || t.closest('[data-handle]')) return
    const it = this.hit(e)
    if (it) { if (!it.locked) activate(it.id); return }
    if (!canEdit()) return
    const w = this.world(this.screen(e))
    const k = creationScale(s.camera.z)
    const text = make.text({ x: w.x, y: w.y - 14 * k, fontSize: 20 * k, autoW: true, w: 8, h: 28 * k })
    addItems([text], { commit: false })
    useBoard.setState({ editingId: text.id })
  }

  private onContext = (e: MouseEvent) => {
    const t = e.target as HTMLElement
    if (t.closest('[data-editing="true"]')) return
    e.preventDefault()
    const s = S()
    if (s.presenting != null) return
    const p = this.screen(e)
    const it = this.hit(e)
    if (it && !s.selection.includes(it.id)) useBoard.setState({ selection: withGroups([it.id]) })
    if (!it) useBoard.setState({ selection: [] })
    useBoard.setState({ ctxMenu: { x: p.x, y: p.y, world: this.world(p) } })
  }

  private onDragOver = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy' }
  private onDrop = (e: DragEvent) => {
    e.preventDefault()
    if (!canEdit()) return
    const at = this.world(this.screen(e))
    const files = [...(e.dataTransfer?.files || [])]
    if (files.length) { bus.importFiles?.(files, at); return }
    const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || ''
    if (text) bus.importText?.(text, '', at)
  }

  private onPaste = (e: ClipboardEvent) => {
    if (isTyping(e) || !canEdit() || !S().boardId) return
    const dt = e.clipboardData
    if (!dt) return
    const at = this.world(this.last.x || this.last.y ? this.last : { x: S().viewport.w / 2, y: S().viewport.h / 2 })
    const files = [...dt.files]
    if (files.length) { e.preventDefault(); bus.importFiles?.(files, at); return }
    const text = dt.getData('text/plain')
    const html = dt.getData('text/html')
    if (text || html) { e.preventDefault(); bus.importText?.(text, html, at) }
  }

  // ---------- keyboard ----------

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') { this.space = false; this.el.classList.remove('can-pan') }
  }

  private onKey = (e: KeyboardEvent) => {
    const s = S()
    if (!s.boardId) return
    if (isTyping(e)) return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key

    if (s.presenting != null) {
      const frames = orderedFrames()
      const go = (i: number) => {
        const n = Math.max(0, Math.min(frames.length - 1, i))
        useBoard.setState({ presenting: n })
        if (frames[n]) fitBox(aabb(frames[n]), 24, true, 8)
      }
      if (k === 'Escape') useBoard.setState({ presenting: null })
      else if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown') { e.preventDefault(); go(s.presenting + 1) }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); go(s.presenting - 1) }
      return
    }

    if (e.code === 'Space' && !mod) { e.preventDefault(); this.space = true; this.el.classList.add('can-pan'); return }

    if (mod) {
      switch (k) {
        case 'z': e.preventDefault(); e.shiftKey ? redo() : undo(); return
        case 'y': e.preventDefault(); redo(); return
        case 'c': if (s.selection.length) { e.preventDefault(); copySelection() } return
        case 'x': if (s.selection.length) { e.preventDefault(); copySelection(true) } return
        case 'd': e.preventDefault(); duplicateSelection(); return
        case 'a': e.preventDefault(); selectAll(); return
        case 'g': e.preventDefault(); e.shiftKey ? ungroupSelection() : groupSelection(); return
        case 'l': if (e.shiftKey) { e.preventDefault(); toggleLock() } return
        case 'f': e.preventDefault(); useBoard.setState({ panel: 'search' }); return
        case 'k': e.preventDefault(); useBoard.setState({ panel: 'search' }); return
        case '=': case '+': e.preventDefault(); zoomTo(s.camera.z * 1.25); return
        case '-': e.preventDefault(); zoomTo(s.camera.z / 1.25); return
        case '0': e.preventDefault(); zoomTo(1); return
        case ']': e.preventDefault(); reorder(e.shiftKey ? 'front' : 'forward'); return
        case '[': e.preventDefault(); reorder(e.shiftKey ? 'back' : 'backward'); return
      }
      return
    }
    if (e.altKey) {
      const map: Record<string, Parameters<typeof alignSelection>[0]> = { a: 'left', d: 'right', w: 'top', s: 'bottom', h: 'hcenter', v: 'vcenter' }
      if (map[k]) { e.preventDefault(); alignSelection(map[k]) }
      return
    }

    switch (k) {
      case 'Escape':
        if (this.mode.k !== 'idle') this.cancelGesture()
        useBoard.setState({ selection: [], ctxMenu: null, activeComment: null, panel: null, tool: 'select', toolLock: false })
        return
      case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); return
      case 'ArrowLeft': e.preventDefault(); s.selection.length ? nudge(e.shiftKey ? -10 : -1, 0) : s.setCamera({ ...s.camera, x: s.camera.x + 60 }); return
      case 'ArrowRight': e.preventDefault(); s.selection.length ? nudge(e.shiftKey ? 10 : 1, 0) : s.setCamera({ ...s.camera, x: s.camera.x - 60 }); return
      case 'ArrowUp': e.preventDefault(); s.selection.length ? nudge(0, e.shiftKey ? -10 : -1) : s.setCamera({ ...s.camera, y: s.camera.y + 60 }); return
      case 'ArrowDown': e.preventDefault(); s.selection.length ? nudge(0, e.shiftKey ? 10 : 1) : s.setCamera({ ...s.camera, y: s.camera.y - 60 }); return
      case 'Enter': if (s.selection.length === 1) { e.preventDefault(); activate(s.selection[0]) } return
      case 'PageUp': reorder('forward'); return
      case 'PageDown': reorder('backward'); return
      case '?': useBoard.setState({ panel: 'shortcuts' }); return
    }
    if (e.shiftKey && (k === '1' || k === '!')) { fitAll(); return }
    if (e.shiftKey && (k === '2' || k === '@')) { fitBox(contentBox(s.selection)); return }

    // Typing on a selected text-capable item starts editing it (and keeps the typed character).
    if (e.key.length === 1 && e.key !== ' ' && s.selection.length === 1 && canEdit()) {
      const it = s.items[s.selection[0]]
      if (it && !it.locked && (it.type === 'sticky' || it.type === 'shape' || it.type === 'text')) {
        e.preventDefault()
        activate(it.id)
        const ch = e.key
        requestAnimationFrame(() => document.execCommand('insertText', false, ch))
        return
      }
    }

    const tools: Record<string, Tool> = { v: 'select', h: 'hand', n: 'sticky', t: 'text', s: 'shape', r: 'shape', o: 'shape', l: 'connector', x: 'connector', p: 'pen', e: 'eraser', f: 'frame', c: 'comment', k: 'card' }
    if (!e.shiftKey && tools[k]) {
      const tool = tools[k]
      const viewerOk = tool === 'select' || tool === 'hand' || (tool === 'comment' && canComment())
      if (!canEdit() && !viewerOk) return
      if (k === 'r') s.setPrefs({ shapeKind: 'rect' })
      if (k === 'o') s.setPrefs({ shapeKind: 'ellipse' })
      s.setTool(tool)
      return
    }
    if (k === 'h' && e.shiftKey) { s.setTool('highlighter'); return }

  }
}

export function screenBoxOf(it: Item, items: Record<string, Item>) {
  const cam = S().camera
  const b = it.type === 'connector' ? connectorGeom(it, items).box : it
  const p = toScreen(cam, b.x, b.y)
  return { x: p.x, y: p.y, w: b.w * cam.z, h: b.h * cam.z }
}
