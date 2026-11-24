import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getStroke } from 'perfect-freehand'
import { Lock, MessageCircle, ThumbsUp } from 'lucide-react'
import { initials } from '../../lib/util'
import { useAsset } from '../assets'
import { inkOn } from '../defaults'
import { capPath, connectorGeom, shapeInset, shapePath, strokeToPath } from '../geometry'
import { S, apply, commit, update, useBoard } from '../store'
import type {
  CommentItem, ConnectorItem, DrawItem, FrameItem, ImageItem, Item, ShapeItem, StickyItem, TextItem,
} from '../types'
import { CardView, ChartView, CodeView, EmbedView, FileView, IfcView, TableView } from './Blocks'
import { RichText, textCss } from './RichText'

const dashArray = (dash: string | undefined, w: number) =>
  dash === 'dashed' ? `${w * 4} ${w * 3}` : dash === 'dotted' ? `${w * 0.1} ${w * 2.2}` : undefined

// ---------- sticky ----------

const fitCache = new Map<string, number>()

function Sticky({ it, editing }: { it: StickyItem; editing: boolean }) {
  const body = useRef<HTMLDivElement>(null)
  const max = it.fontSize || 18
  const [fs, setFs] = useState(() => fitCache.get(`${it.w}|${it.h}|${max}|${it.html}`) || max)

  useLayoutEffect(() => {
    const el = body.current
    const text = el?.firstElementChild as HTMLElement | null
    if (!el || !text) return
    if (it.autoFit === false) { setFs(max); return }
    const key = `${it.w}|${it.h}|${max}|${it.html}`
    const cached = fitCache.get(key)
    if (cached && !editing) { setFs(cached); return }
    const fits = (size: number) => {
      text.style.fontSize = `${size}px`
      return text.scrollHeight <= el.clientHeight + 1 && text.scrollWidth <= el.clientWidth + 1
    }
    let best = max
    if (!fits(max)) {
      let lo = 6, hi = max
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2
        if (fits(mid)) lo = mid
        else hi = mid
      }
      best = Math.floor(lo * 2) / 2
    }
    text.style.fontSize = `${best}px`
    if (fitCache.size > 4000) fitCache.clear()
    fitCache.set(key, best)
    setFs(best)
  }, [it.html, it.w, it.h, max, it.autoFit, editing])

  const ink = it.color || inkOn(it.fill)
  return (
    <div className="wc-sticky" style={{ background: it.fill }}>
      <div
        ref={body}
        className="wc-sticky-body"
        style={{ justifyContent: it.valign === 'top' ? 'flex-start' : it.valign === 'bottom' ? 'flex-end' : 'center' }}
      >
        <RichText id={it.id} html={it.html} editing={editing} style={{ ...textCss(it, ink), fontSize: fs }} placeholder={editing ? 'Type something' : undefined} />
      </div>
      {(it.tags?.length || it.author) && (
        <div className="wc-sticky-meta" style={{ color: ink }}>
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
    if (cur && (Math.abs(cur.h - h) > 1 || Math.abs(cur.w - w) > 1)) {
      update(it.id, { h, w })
      if (!S().editingId) commit({ history: false })
    }
  }
  // Only the person working on the text measures it, so clients never fight over sizes.
  useLayoutEffect(() => { if (editing || selected) measure() })
  return (
    <div ref={ref} className="wc-text" style={{ background: it.fill, width: it.autoW ? 'max-content' : it.w, whiteSpace: it.autoW ? 'pre' : 'pre-wrap' }}>
      <RichText id={it.id} html={it.html} editing={editing} style={textCss({ align: 'left', ...it })} placeholder="Type something" onInput={measure} />
    </div>
  )
}

// ---------- shape ----------

function Shape({ it, editing }: { it: ShapeItem; editing: boolean }) {
  const d = useMemo(() => shapePath(it.kind, it.w, it.h), [it.kind, it.w, it.h])
  const [ix, iy] = shapeInset(it.kind)
  const ink = it.color || (it.fill === 'transparent' ? '#1c1e23' : inkOn(it.fill))
  return (
    <>
      <svg className="wc-svg" width={it.w} height={it.h} style={{ opacity: it.opacity ?? 1 }}>
        <path
          d={d}
          fill={it.fill === 'transparent' ? 'none' : it.fill}
          stroke={it.strokeW ? it.stroke : 'none'}
          strokeWidth={it.strokeW}
          strokeDasharray={dashArray(it.dash, it.strokeW)}
          strokeLinecap="round"
          strokeLinejoin="round"
          pointerEvents="all"
        />
      </svg>
      <div
        className="wc-shape-text"
        style={{
          padding: `${it.h * iy}px ${it.w * ix}px`,
          justifyContent: it.valign === 'top' ? 'flex-start' : it.valign === 'bottom' ? 'flex-end' : 'center',
        }}
      >
        <RichText id={it.id} html={it.html} editing={editing} style={textCss(it, ink)} />
      </div>
    </>
  )
}

// ---------- ink ----------

const inkCache = new WeakMap<number[], string>()
export function inkPath(pts: number[], size: number, tool: string): string {
  let d = inkCache.get(pts)
  if (d != null) return d
  const input: number[][] = []
  for (let i = 0; i < pts.length; i += 3) input.push([pts[i], pts[i + 1], pts[i + 2] ?? 0.5])
  const outline = getStroke(input, {
    size, thinning: tool === 'highlighter' ? 0 : 0.55, smoothing: 0.55, streamline: 0.4,
    simulatePressure: input.every((p) => p[2] === 0.5), last: true,
  })
  d = strokeToPath(outline)
  inkCache.set(pts, d)
  return d
}

function Draw({ it }: { it: DrawItem }) {
  const d = inkPath(it.pts, it.size, it.tool)
  return (
    <svg
      className="wc-svg"
      width={it.w}
      height={it.h}
      viewBox={`0 0 ${it.w0 || 1} ${it.h0 || 1}`}
      preserveAspectRatio="none"
      style={it.tool === 'highlighter' ? { opacity: 0.45, mixBlendMode: 'multiply' } : undefined}
    >
      <path d={d} fill={it.stroke} stroke="transparent" strokeWidth={14} pointerEvents="all" />
    </svg>
  )
}

// ---------- connector ----------

const geomKey = (s: { items: Record<string, Item> }, id: string) => {
  const c = s.items[id] as ConnectorItem | undefined
  if (!c || c.type !== 'connector') return ''
  const g = connectorGeom(c, s.items)
  return `${g.d}|${g.mid.x},${g.mid.y}`
}

function Connector({ it, editing }: { it: ConnectorItem; editing: boolean }) {
  const key = useBoard((s) => geomKey(s, it.id))
  const g = useMemo(() => connectorGeom(it, S().items), [key, it]) // eslint-disable-line react-hooks/exhaustive-deps
  const n = g.pts.length
  const size = 6 + it.strokeW * 3
  const capA = capPath(it.capA, g.pts[0], g.tanA, size)
  const capB = capPath(it.capB, g.pts[n - 1], g.tanB, size)
  return (
    <>
      <svg className="wc-svg" width={1} height={1}>
        <path d={g.d} fill="none" stroke="transparent" strokeWidth={Math.max(16, it.strokeW + 12)} pointerEvents="stroke" />
        <path d={g.d} fill="none" stroke={it.stroke} strokeWidth={it.strokeW} strokeDasharray={dashArray(it.dash, it.strokeW)} strokeLinecap="round" strokeLinejoin="round" />
        {[capA, capB].map((c, i) => c && (
          <path key={i} d={c.d} fill={c.fill ? it.stroke : 'none'} stroke={it.stroke} strokeWidth={it.strokeW} strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      {(it.label || editing) && (
        <div className="wc-conn-label" style={{ left: g.mid.x, top: g.mid.y, fontSize: it.fontSize || 14, color: it.color || '#1c1e23' }}>
          {editing ? (
            <input
              autoFocus
              data-editing="true"
              defaultValue={it.label || ''}
              placeholder="Label"
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
      <div className="wc-frame-body" style={{ background: it.fill === 'transparent' ? undefined : it.fill }} />
      <div className="wc-frame-title" data-frame-title>
        {editing ? (
          <input
            autoFocus
            data-editing="true"
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
  const url = useAsset(it.src)
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
          if (used >= voting.max) { useBoard.setState({ toast: { id: Date.now(), text: `You have used all ${voting.max} votes` } }); return }
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

export const ItemView = memo(function ItemView({ id }: { id: string }) {
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
