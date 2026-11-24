import { memo, useEffect, useRef, useState } from 'react'
import { aabb, connectorGeom, intersects, itemBox, toScreen, unionBoxes } from './geometry'
import { DOM_ITEM_LIMIT, DOM_ITEM_RESUME, paintOverview, setThumbListener } from './overview'
import { Interaction } from './interaction'
import { ItemView } from './items/ItemView'
import { S, animateCamera, canEdit, useBoard } from './store'
import type { Item } from './types'

const LAYER: Record<string, number> = { frame: 0, comment: 2 }

/** What is currently drawn: DOM item ids, and (for crowded views) the ids painted on the overview canvas. */
export const view: { dom: string[]; overview: string[] | null; refresh: (() => void) | null } = { dom: [], overview: null, refresh: null }

function computeVisible(): { dom: string[]; overview: string[] | null; lost: boolean } {
  const { items, camera, viewport, showComments, editingId, selection } = S()
  const z = camera.z
  const collect = (margin: number) => {
    const mx = (viewport.w * margin) / z, my = (viewport.h * margin) / z
    const box = { x: -camera.x / z - mx, y: -camera.y / z - my, w: viewport.w / z + mx * 2, h: viewport.h / z + my * 2 }
    const out: Item[] = []
    for (const id in items) {
      const it = items[id]
      if (it.type === 'comment' && (!showComments || it.resolved)) continue
      if (intersects(box, itemBox(it, items))) out.push(it)
    }
    return out
  }
  const order = (a: Item, b: Item) => (LAYER[a.type] ?? 1) - (LAYER[b.type] ?? 1) || a.z - b.z || (a.id < b.id ? -1 : 1)
  let list = collect(0.35)
  const any = list.length > 0
  let hasContent = any
  if (!any) for (const id in items) { if (items[id].type !== 'comment') { hasContent = true; break } }
  const pinned = (id: string) => id === editingId || (selection.length === 1 && selection[0] === id)
  if (list.length > (view.overview ? DOM_ITEM_RESUME : DOM_ITEM_LIMIT)) {
    // Crowded view: paint everything on one canvas, keep only the item being worked on (and a few pins) in the DOM.
    list = collect(0.02).sort(order)
    const dom: string[] = []
    let pins = 0
    for (const it of list) if (pinned(it.id) || (it.type === 'comment' && pins++ < 150)) dom.push(it.id)
    for (const id of [editingId, selection.length === 1 ? selection[0] : null]) if (id && items[id] && !dom.includes(id)) dom.push(id)
    return { dom, overview: list.filter((it) => !pinned(it.id)).map((it) => it.id), lost: false }
  }
  const ids = new Set(list.map((i) => i.id))
  for (const id of [editingId, selection.length === 1 ? selection[0] : null]) if (id && items[id] && !ids.has(id)) list.push(items[id])
  list.sort(order)
  return { dom: list.map((i) => i.id), overview: null, lost: hasContent && !any }
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/** Keeps the visible set, the overview canvas and the "lost" flag in step with the store, once per frame. */
function useScene(canvasRef: React.RefObject<HTMLCanvasElement | null>): string[] {
  const [ids, setIds] = useState<string[]>(() => computeVisible().dom)
  useEffect(() => {
    let raf = 0
    let prev = ids
    const sizeCanvas = () => {
      const c = canvasRef.current
      if (!c) return
      const { viewport } = S()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.round(viewport.w * dpr), h = Math.round(viewport.h * dpr)
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
    }
    const run = () => {
      raf = 0
      const next = computeVisible()
      view.dom = next.dom
      view.overview = next.overview
      const c = canvasRef.current
      if (c) {
        if (next.overview) { sizeCanvas(); paintOverview(c, S().items, next.overview, S().camera, S().theme === 'dark') }
        else if (c.dataset.on === '1') c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
        c.dataset.on = next.overview ? '1' : '0'
      }
      const s = S()
      if (s.overview !== !!next.overview || s.lost !== next.lost) useBoard.setState({ overview: !!next.overview, lost: next.lost })
      if (!sameIds(next.dom, prev)) { prev = next.dom; setIds(next.dom) }
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(run) }
    const unsub = useBoard.subscribe((s, p) => {
      if (s.items !== p.items || s.camera !== p.camera || s.viewport !== p.viewport || s.showComments !== p.showComments || s.editingId !== p.editingId || s.selection !== p.selection || s.theme !== p.theme) schedule()
    })
    setThumbListener(schedule)
    // lets a caller bring the scene up to date immediately (used when editing starts, so the editor can take focus at once)
    view.refresh = () => { cancelAnimationFrame(raf); run() }
    schedule()
    return () => { unsub(); setThumbListener(null); cancelAnimationFrame(raf); view.dom = []; view.overview = null; view.refresh = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return ids
}

const Items = memo(function Items({ ids }: { ids: string[] }) {
  return <>{ids.map((id) => <ItemView key={id} id={id} />)}</>
})

export function Canvas() {
  const viewRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const tool = useBoard((s) => s.tool)
  const grid = useBoard((s) => s.grid)
  const presenting = useBoard((s) => s.presenting != null)
  const ids = useScene(canvasRef)

  useEffect(() => {
    const el = viewRef.current!, world = worldRef.current!
    let lastZ = -1
    const applyCam = () => {
      const { camera: c, grid: g } = S()
      world.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.z})`
      if (c.z !== lastZ) {
        // the inverse scale (used by frame titles and comment pins) only changes with zoom, never while panning
        lastZ = c.z
        world.style.setProperty('--inv', String(1 / c.z))
      }
      if (g !== 'none') {
        let step = 24 * c.z
        while (step < 14) step *= 4
        while (step > 96) step /= 4
        el.style.backgroundSize = `${step}px ${step}px`
        el.style.backgroundPosition = `${c.x}px ${c.y}px`
      }
    }
    const unsub = useBoard.subscribe((s, p) => { if (s.camera !== p.camera || s.grid !== p.grid) applyCam() })
    const measure = () => {
      const r = el.getBoundingClientRect()
      const v = S().viewport
      if (r.width > 0 && r.height > 0 && (Math.abs(v.w - r.width) > 0.5 || Math.abs(v.h - r.height) > 0.5)) useBoard.setState({ viewport: { w: r.width, h: r.height } })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    applyCam()
    const ix = new Interaction(el)
    // When the on-screen keyboard (or a fold) shrinks the view, keep the item being edited in sight.
    const reveal = () => {
      const s = S()
      const it = s.editingId ? s.items[s.editingId] : null
      if (!it || it.type === 'connector') return
      const b = itemBox(it, s.items)
      const top = b.y * s.camera.z + s.camera.y, bottom = (b.y + b.h) * s.camera.z + s.camera.y
      const narrow = s.viewport.w <= 640 || s.viewport.h <= 520
      const safeTop = 70, safeBottom = s.viewport.h - (narrow ? 132 : 24)
      let dy = 0
      if (bottom > safeBottom) dy = safeBottom - bottom
      if (top + dy < safeTop) dy = safeTop - top
      if (Math.abs(dy) > 2) animateCamera({ x: s.camera.x, y: s.camera.y + dy, z: s.camera.z }, 180)
    }
    const unsubReveal = useBoard.subscribe((s, p) => { if (s.editingId && (s.editingId !== p.editingId || s.viewport !== p.viewport)) requestAnimationFrame(reveal) })
    return () => { unsub(); unsubReveal(); ro.disconnect(); ix.destroy() }
  }, [])

  return (
    <div ref={viewRef} className={`wc-viewport tool-${tool} grid-${grid} ${presenting ? 'is-presenting' : ''}`} data-canvas tabIndex={0} role="application" aria-label="Board canvas. Press Tab to move between items, Enter to edit, question mark for shortcuts.">
      <canvas ref={canvasRef} className="wc-overview" aria-hidden="true" />
      <div ref={worldRef} className="wc-world">
        <Items ids={ids} />
        <svg className="wc-svg wc-live" width={1} height={1}><path id="wc-live-ink" /></svg>
      </div>
      <Overlay />
    </div>
  )
}

// ---------- screen-space overlay: selection, guides, marquee, peers ----------

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const DOTTED = new Set(['sticky', 'shape', 'text', 'card', 'image', 'embed', 'ifc', 'table', 'code', 'chart', 'file'])

function Overlay() {
  const camera = useBoard((s) => s.camera)
  const selection = useBoard((s) => s.selection)
  const items = useBoard((s) => s.items)
  const editingId = useBoard((s) => s.editingId)
  const guides = useBoard((s) => s.guides)
  const marquee = useBoard((s) => s.marquee)
  const hover = useBoard((s) => s.connectHover)
  const peers = useBoard((s) => s.peers)
  const tool = useBoard((s) => s.tool)
  const role = useBoard((s) => s.role)
  const editable = canEdit() && role !== 'viewer'
  const sel = selection.map((id) => items[id]).filter(Boolean)
  const z = camera.z
  const sc = (x: number, y: number) => toScreen(camera, x, y)

  let selUi: React.ReactNode = null
  if (sel.length === 1 && tool === 'select') {
    const it = sel[0]
    if (it.type === 'connector') {
      const g = connectorGeom(it, items)
      const a = sc(g.pts[0].x, g.pts[0].y), b = sc(g.pts[g.pts.length - 1].x, g.pts[g.pts.length - 1].y)
      selUi = editable && !it.locked && (
        <>
          <div className="wc-handle is-round" data-handle="end-a" style={{ left: a.x, top: a.y }} />
          <div className="wc-handle is-round" data-handle="end-b" style={{ left: b.x, top: b.y }} />
        </>
      )
    } else if (it.type !== 'comment') {
      const p = sc(it.x, it.y)
      const w = it.w * z, h = it.h * z
      const isEditing = editingId === it.id
      const isText = it.type === 'text'
      const handles = isText ? ['nw', 'ne', 'se', 'sw', 'e', 'w'] : HANDLES
      const small = w < 44 || h < 44
      selUi = (
        <div className={`wc-selbox ${it.locked ? 'is-locked' : ''}`} style={{ left: p.x, top: p.y, width: w, height: h, transform: it.rot ? `rotate(${it.rot}deg)` : undefined }}>
          {editable && !it.locked && !isEditing && (
            <>
              {handles.filter((hd) => !small || hd.length === 2 || (isText && w >= 36)).map((hd) => <div key={hd} className={`wc-handle h-${hd}`} data-handle={hd} />)}
              <div className="wc-handle is-rot" data-handle="rot" />
              {DOTTED.has(it.type) && !small && ['l', 'r', 't', 'b'].map((d) => <div key={d} className={`wc-dot d-${d}`} data-handle={`dot-${d}`} title="Drag to connect, click to add a linked copy" />)}
            </>
          )}
        </div>
      )
    }
  } else if (sel.length > 1 && tool === 'select') {
    const u = unionBoxes(sel.map((i) => itemBox(i, items)))
    if (u) {
      const p = sc(u.x, u.y)
      const allLocked = sel.every((i) => i.locked)
      selUi = (
        <>
          {sel.length <= 80 && sel.map((it) => {
            if (it.type === 'connector') return null
            const q = sc(it.x, it.y)
            return <div key={it.id} className="wc-selbox is-member" style={{ left: q.x, top: q.y, width: it.w * z, height: it.h * z, transform: it.rot ? `rotate(${it.rot}deg)` : undefined }} />
          })}
          <div className="wc-selbox is-multi" style={{ left: p.x, top: p.y, width: u.w * z, height: u.h * z }}>
            {editable && !allLocked && (
              <>
                {['nw', 'ne', 'se', 'sw'].map((hd) => <div key={hd} className={`wc-handle h-${hd}`} data-handle={hd} />)}
                <div className="wc-handle is-rot" data-handle="rot" />
              </>
            )}
          </div>
        </>
      )
    }
  }

  const hoverIt = hover ? items[hover] : null
  const now = Date.now()

  return (
    <div className="wc-overlay">
      {Object.values(peers).map((peer) => peer.sel?.map((id) => {
        const it = items[id]
        if (!it || it.type === 'connector') return null
        const q = sc(it.x, it.y)
        return <div key={peer.id + id} className="wc-selbox is-peer" style={{ left: q.x, top: q.y, width: it.w * z, height: it.h * z, borderColor: peer.color, transform: it.rot ? `rotate(${it.rot}deg)` : undefined }} />
      }))}
      {hoverIt && (() => { const b = aabb(hoverIt); const q = sc(b.x, b.y); return <div className="wc-selbox is-hover" style={{ left: q.x - 3, top: q.y - 3, width: b.w * z + 6, height: b.h * z + 6 }} /> })()}
      {selUi}
      {guides.map((g, i) => {
        const a = sc(g.x1, g.y1), b = sc(g.x2, g.y2)
        return <div key={i} className="wc-guide" style={{ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.max(1, Math.abs(b.x - a.x)), height: Math.max(1, Math.abs(b.y - a.y)) }} />
      })}
      {marquee && (() => { const q = sc(marquee.x, marquee.y); return <div className="wc-marquee" style={{ left: q.x, top: q.y, width: marquee.w * z, height: marquee.h * z }} /> })()}
      {Object.values(peers).map((peer) => peer.cursor && now - peer.seen < 15000 && (() => {
        const q = sc(peer.cursor!.x, peer.cursor!.y)
        return (
          <div key={peer.id} className="wc-cursor" style={{ transform: `translate(${q.x}px, ${q.y}px)` }}>
            <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 1l13 7-5.5 1.6L7 15z" fill={peer.color} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" /></svg>
            <span style={{ background: peer.color }}>{peer.name}</span>
          </div>
        )
      })())}
    </div>
  )
}
