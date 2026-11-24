import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getStroke } from 'perfect-freehand'
import { Lock, MessageCircle, ThumbsUp } from 'lucide-react'
import { initials } from '../../lib/util'
import { useAsset } from '../assets'
import { inkOn } from '../defaults'
import { capPath, connectorGeom, shapeInset, shapePath, strokeToPath } from '../geometry'
import { S, apply, commit, isPending, patchSilent, toast, update, useBoard } from '../store'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import type {
  CommentItem, ConnectorItem, DrawItem, FrameItem, ImageItem, Item, ShapeItem, StickyItem, TextItem,
} from '../types'
import { CardView, ChartView, CodeView, EmbedView, FileView, IfcView, TableView } from './Blocks'
import { RichText, textCss } from './RichText'

const dashArray = (dash: string | undefined, w: number) =>
  dash === 'dashed' ? `${w * 4} ${w * 3}` : dash === 'dotted' ? `${w * 0.1} ${w * 2.2}` : undefined

// ---------- theming ----------

const DEFAULT_INK = '#1c1e23'
/** Default-coloured ink follows the theme so it stays readable on a dark canvas. */
const ink = (c: string | undefined) => (!c || c === DEFAULT_INK ? 'var(--ink-canvas)' : c)

// ---------- text fitting ----------

const fitCache = new Map<string, number>()

/** Shrinks text (never grows it past `max`) so it fits its box. Skipped while the box is being dragged. */
function useFitText(body: React.RefObject<HTMLDivElement | null>, it: { id: string; html: string; w: number; h: number; rev: number }, max: number, enabled: boolean, editing: boolean) {
  const key = `${Math.round(it.w)}|${Math.round(it.h)}|${max}|${it.html.length}|${it.html.slice(0, 64)}|${it.html.slice(-32)}`
  const [fs, setFs] = useState(() => fitCache.get(key) || max)
  useLayoutEffect(() => {
    const el = body.current
    const text = el?.firstElementChild as HTMLElement | null
    if (!el || !text) return
    if (!enabled) { setFs(max); return }
    if (!editing && isPending(it.id)) return // mid-gesture: fit once when it is committed
    const cached = fitCache.get(key)
    if (cached && !editing) { setFs(cached); return }
    const fits = (size: number) => {
      text.style.fontSize = `${size}px`
      return text.scrollHeight <= el.clientHeight + 1 && text.scrollWidth <= el.clientWidth + 1
    }
    let best = max
    if (!fits(max)) {
      let lo = Math.min(6, max), hi = max
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2
        if (fits(mid)) lo = mid
        else hi = mid
      }
      best = Math.floor(lo * 2) / 2
    }
    text.style.fontSize = `${best}px`
    if (fitCache.size > 6000) { let n = 0; for (const k of fitCache.keys()) { fitCache.delete(k); if (++n > 2000) break } }
    fitCache.set(key, best)
    setFs(best)
  }, [key, max, enabled, editing, it.rev]) // eslint-disable-line react-hooks/exhaustive-deps
  return fs
}

// ---------- sticky ----------

function Sticky({ it, editing }: { it: StickyItem; editing: boolean }) {
  const body = useRef<HTMLDivElement>(null)
  const fs = useFitText(body, it, it.fontSize || 18, it.autoFit !== false, editing)
  const color = it.color || inkOn(it.fill)
  return (
    <div className="wc-sticky" style={{ background: it.fill }}>
      <div
        ref={body}
        className="wc-sticky-body"
        style={{ justifyContent: it.valign === 'top' ? 'flex-start' : it.valign === 'bottom' ? 'flex-end' : 'center' }}
      >
        <RichText id={it.id} html={it.html} editing={editing} style={{ ...textCss(it, color), fontSize: fs }} placeholder={editing ? 'Type something' : undefined} />
      </div>
      {(it.tags?.length || it.author) && (
        <div className="wc-sticky-meta" style={{ color }}>
          {it.tags?.map((t) => <span key={t} className="wc-tag">{t}</span>)}
          {it.author && <span className="ml-auto opacity-60">{it.author}</span>}
        </div>
      )}
    </div>
  )
}

// ---------- text ----------

function Text({ it, editing, selected }: { it: TextItem; editing: boolean; selected: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const measure = () => {
    const el = ref.current
    if (!el) return
    const h = Math.ceil(el.offsetHeight)
    const w = it.autoW ? Math.max(24, Math.ceil(el.offsetWidth) + 2) : it.w
    const cur = S().items[it.id]
    // a derived size, written without an undo step (and joined to the current gesture when there is one)
    if (cur && (Math.abs(cur.h - h) > 1 || Math.abs(cur.w - w) > 1)) patchSilent(it.id, { h, w })
  }
  // Only the person working on the text measures it, so clients never fight over sizes.
  useLayoutEffect(() => { if (editing || selected) measure() }, [editing, selected, it.html, it.w, it.fontSize, it.autoW, it.font, it.bold]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className="wc-text" style={{ background: it.fill, width: it.autoW ? 'max-content' : it.w, whiteSpace: it.autoW ? 'pre' : 'pre-wrap' }}>
      <RichText id={it.id} html={it.html} editing={editing} style={textCss({ align: 'left', ...it }, it.fill ? inkOn(it.fill) : 'var(--ink-canvas)')} placeholder={editing ? 'Type something' : undefined} onInput={measure} />
    </div>
  )
}

// ---------- shape ----------

function Shape({ it, editing }: { it: ShapeItem; editing: boolean }) {
  const d = useMemo(() => shapePath(it.kind, it.w, it.h), [it.kind, it.w, it.h])
  const body = useRef<HTMLDivElement>(null)
  const fs = useFitText(body, it, it.fontSize || 16, true, editing)
  const [ix, iy] = shapeInset(it.kind)
  const hollow = it.fill === 'transparent'
  const color = it.color || (hollow ? 'var(--ink-canvas)' : inkOn(it.fill))
  return (
    <>
      <svg className="wc-svg" width={it.w} height={it.h} style={{ opacity: it.opacity ?? 1 }}>
        <path
          d={d}
          fill={hollow ? 'none' : it.fill}
          style={{ stroke: it.strokeW ? (hollow ? ink(it.stroke) : it.stroke) : 'none' }}
          strokeWidth={it.strokeW}
          strokeDasharray={dashArray(it.dash, it.strokeW)}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="all"
        />
      </svg>
      <div className="wc-shape-text" style={{ padding: `${it.h * iy}px ${it.w * ix}px` }}>
        <div ref={body} className="wc-shape-fit" style={{ justifyContent: it.valign === 'top' ? 'flex-start' : it.valign === 'bottom' ? 'flex-end' : 'center' }}>
          <RichText id={it.id} html={it.html} editing={editing} style={{ ...textCss(it, color), fontSize: fs }} />
        </div>
      </div>
    </>
  )
}

// ---------- ink ----------

const inkCache = new WeakMap<number[], { key: string; d: string }>()
/** Outline path for a stroke at its current size. Points are scaled; the pen width follows the smaller axis so thin strokes never balloon. */
export function inkPath(it: Pick<DrawItem, 'pts' | 'size' | 'tool' | 'w' | 'h' | 'w0' | 'h0'>): string {
  const sx = it.w / (it.w0 || 1), sy = it.h / (it.h0 || 1)
  const size = it.size * Math.max(0.05, Math.min(sx, sy))
  const key = `${sx.toFixed(4)}|${sy.toFixed(4)}|${it.size}|${it.tool}`
  const hit = inkCache.get(it.pts)
  if (hit && hit.key === key) return hit.d
  const input: number[][] = []
  for (let i = 0; i < it.pts.length; i += 3) input.push([it.pts[i] * sx, it.pts[i + 1] * sy, it.pts[i + 2] ?? 0.5])
  const outline = getStroke(input, {
    size, thinning: it.tool === 'highlighter' ? 0 : 0.55, smoothing: 0.55, streamline: 0.4,
    simulatePressure: input.every((p) => p[2] === 0.5), last: true,
  })
  const d = strokeToPath(outline)
  inkCache.set(it.pts, { key, d })
  return d
}

function Draw({ it }: { it: DrawItem }) {
  const d = inkPath(it)
  return (
    <svg className="wc-svg" width={it.w} height={it.h} style={it.tool === 'highlighter' ? { opacity: 0.45, mixBlendMode: 'multiply' } : undefined}>
      <path d={d} style={{ fill: ink(it.stroke) }} stroke="transparent" strokeWidth={14} pointerEvents="all" />
    </svg>
  )
}

// ---------- connector ----------

// Geometry keys are cached per store snapshot, so panning and zooming (which do not touch items) cost nothing here.
let geomFor: Record<string, Item> | null = null
let geomKeys = new Map<string, string>()
const geomKey = (s: { items: Record<string, Item> }, id: string) => {
  if (geomFor !== s.items) { geomFor = s.items; geomKeys = new Map() }
  let key = geomKeys.get(id)
  if (key === undefined) {
    const c = s.items[id] as ConnectorItem | undefined
    if (!c || c.type !== 'connector') key = ''
    else { const g = connectorGeom(c, s.items); key = `${g.d}|${g.mid.x},${g.mid.y}` }
    geomKeys.set(id, key)
  }
  return key
}

function Connector({ it, editing }: { it: ConnectorItem; editing: boolean }) {
  const key = useBoard((s) => geomKey(s, it.id))
  const g = useMemo(() => connectorGeom(it, S().items), [key, it]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = g.pts.length
  const size = 6 + it.strokeW * 3
  const capA = capPath(it.capA, g.pts[0], g.tanA, size)
  const capB = capPath(it.capB, g.pts[n - 1], g.tanB, size)
  const stroke = ink(it.stroke)
  return (
    <>
      <svg className="wc-svg" width={1} height={1}>
        <path d={g.d} fill="none" stroke="transparent" strokeWidth={Math.max(16, it.strokeW + 12)} pointerEvents="stroke" />
        <path d={g.d} fill="none" style={{ stroke }} strokeWidth={it.strokeW} strokeDasharray={dashArray(it.dash, it.strokeW)} strokeLinecap="round" strokeLinejoin="round" />
        {[capA, capB].map((c, i) => c && (
          <path key={i} d={c.d} style={{ fill: c.fill ? stroke : 'none', stroke }} strokeWidth={it.strokeW} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      {(it.label || editing) && (
        <div className="wc-conn-label" style={{ left: g.mid.x, top: g.mid.y, fontSize: it.fontSize || 14, color: it.color || 'var(--ink-canvas)' }}>
          {editing ? (
            <input
              autoFocus
              data-editing="true"
              aria-label="Connector label"
              defaultValue={it.label || ''}
              placeholder="Label"
              maxLength={300}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
              onBlur={(e) => { update(it.id, { label: e.target.value.trim() || undefined }); commit(); useBoard.setState({ editingId: null }) }}
              style={{ width: Math.max(80, (it.label?.length || 6) * 9) }}
            />
          ) : it.label}
        </div>
      )}
    </>
  )
}

// ---------- frame ----------

function Frame({ it, editing }: { it: FrameItem; editing: boolean }) {
  return (
    <>
      <div className="wc-frame-body" style={{ background: it.fill === 'transparent' ? undefined : it.fill === '#ffffff' ? 'var(--frame)' : it.fill }} />
      <div className="wc-frame-title" data-frame-title>
        {editing ? (
          <input
            autoFocus
            data-editing="true"
            aria-label="Frame title"
            maxLength={200}
            defaultValue={it.title}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
            onBlur={(e) => { update(it.id, { title: e.target.value.trim() || 'Frame' }); commit(); useBoard.setState({ editingId: null }) }}
          />
        ) : (
          <span>{it.title}</span>
        )}
      </div>
    </>
  )
}

// ---------- image ----------

function Image({ it }: { it: ImageItem }) {
  // Small on screen: the lightweight preview is enough, and saves decoding the full image.
  const small = useBoard((s) => !!it.thumb && it.w * s.camera.z < 360)
  const url = useAsset(small ? it.thumb : it.src)
  return url ? (
    <img className="wc-image" src={url} alt={it.alt || ''} draggable={false} loading="lazy" decoding="async" />
  ) : (
    <div className="wc-placeholder">Loading image…</div>
  )
}

// ---------- comment ----------

function Comment({ it }: { it: CommentItem }) {
  const first = it.thread[0]
  const active = useBoard((s) => s.activeComment === it.id)
  return (
    <div className={`wc-comment ${it.resolved ? 'is-resolved' : ''} ${active ? 'is-active' : ''}`} title={first?.text}>
      {first ? <span>{initials(first.name)}</span> : <MessageCircle size={16} />}
      {it.thread.length > 1 && <i>{it.thread.length}</i>}
    </div>
  )
}

// ---------- voting ----------

const VOTABLE = new Set(['sticky', 'shape', 'card', 'image', 'text'])

function Votes({ it }: { it: Item }) {
  const voting = useBoard((s) => s.meta?.settings.voting)
  const me = useBoard((s) => s.me.id)
  const count = it.votes?.length || 0
  if (!VOTABLE.has(it.type) || (!voting?.open && !count)) return null
  const mine = it.votes?.filter((v) => v === me).length || 0
  return (
    <button
      className={`wc-votes ${mine ? 'is-mine' : ''}`}
      data-interactive
      disabled={!voting?.open}
      title={voting?.open ? 'Click to vote, Alt-click to remove your vote' : 'Votes'}
      onClick={(e) => {
        const s = S()
        if (!voting?.open) return
        const votes = [...(it.votes || [])]
        if (e.altKey || e.shiftKey) {
          const i = votes.lastIndexOf(me)
          if (i >= 0) votes.splice(i, 1)
        } else {
          const used = Object.values(s.items).reduce((a, i) => a + (i.votes?.filter((v) => v === me).length || 0), 0)
          if (used >= voting.max) { toast(`You have used all ${voting.max} votes`); return }
          votes.push(me)
        }
        apply({ [it.id]: { ...it, votes } })
      }}
    >
      <ThumbsUp size={12} /> {count}
    </button>
  )
}

// ---------- shell ----------

/** One item failing to render must never take the board down with it. */
export const ItemView = memo(function ItemView({ id }: { id: string }) {
  const rev = useBoard((s) => s.items[id]?.rev)
  return <ErrorBoundary resetKey={rev} name={`item ${id}`}><ItemBody id={id} /></ErrorBoundary>
})

const ItemBody = memo(function ItemBody({ id }: { id: string }) {
  const it = useBoard((s) => s.items[id])
  const editing = useBoard((s) => s.editingId === id)
  const selected = useBoard((s) => s.selection.length === 1 && s.selection[0] === id)
  if (!it) return null
  const passthrough = it.type === 'connector' || it.type === 'draw' || it.type === 'frame' || it.type === 'shape'
  const autoSize = it.type === 'text'
  return (
    <div
      data-id={id}
      data-type={it.type}
      className={`wc-item ${passthrough ? 'is-pass' : ''} ${it.locked ? 'is-locked' : ''} ${editing ? 'is-editing' : ''}`}
      style={{
        transform: it.type === 'connector' ? undefined : `translate(${it.x}px, ${it.y}px)${it.rot ? ` rotate(${it.rot}deg)` : ''}`,
        width: it.type === 'connector' ? 0 : autoSize && (it as TextItem).autoW ? undefined : it.w,
        height: it.type === 'connector' ? 0 : autoSize ? undefined : it.h,
      }}
    >
      {it.type === 'sticky' && <Sticky it={it} editing={editing} />}
      {it.type === 'text' && <Text it={it} editing={editing} selected={selected} />}
      {it.type === 'shape' && <Shape it={it} editing={editing} />}
      {it.type === 'draw' && <Draw it={it} />}
      {it.type === 'connector' && <Connector it={it} editing={editing} />}
      {it.type === 'frame' && <Frame it={it} editing={editing} />}
      {it.type === 'image' && <Image it={it} />}
      {it.type === 'comment' && <Comment it={it} />}
      {it.type === 'embed' && <EmbedView it={it} active={editing} />}
      {it.type === 'ifc' && <IfcView it={it} active={editing} />}
      {it.type === 'card' && <CardView it={it} editing={editing} />}
      {it.type === 'table' && <TableView it={it} editing={editing} />}
      {it.type === 'code' && <CodeView it={it} editing={editing} />}
      {it.type === 'file' && <FileView it={it} />}
      {it.type === 'chart' && <ChartView it={it} />}
      <Votes it={it} />
      {it.locked && selected && <span className="wc-lock"><Lock size={12} /></span>}
    </div>
  )
})
