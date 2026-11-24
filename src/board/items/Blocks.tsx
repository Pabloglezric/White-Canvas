import { Suspense, lazy, useLayoutEffect, useRef } from 'react'
import { Box as BoxIcon, Calendar, Download, ExternalLink, FileText, Globe, MousePointerClick, User } from 'lucide-react'
import { formatBytes } from '../../lib/util'
import { resolveAsset, useAsset } from '../assets'
import { inkOn } from '../defaults'
import { S, apply, update, useBoard } from '../store'
import type { CardItem, ChartItem, CodeItem, EmbedItem, FileItem, IfcItem, TableItem } from '../types'
import { textCss } from './RichText'

const IfcViewer = lazy(() => import('../ifc/IfcViewer'))

// ---------- embed ----------

export function EmbedView({ it, active }: { it: EmbedItem; active: boolean }) {
  const big = useBoard((s) => it.w * s.camera.z > 150)
  const host = (() => { try { return new URL(it.url).hostname.replace(/^www\./, '') } catch { return it.site || '' } })()
  if (it.kind === 'link') {
    return (
      <div className="wc-linkcard">
        {it.thumb && <div className="wc-linkcard-thumb" style={{ backgroundImage: `url(${JSON.stringify(it.thumb).slice(1, -1)})` }} />}
        <div className="wc-linkcard-body">
          <div className="wc-linkcard-title">{it.title || it.url}</div>
          {it.desc && <div className="wc-linkcard-desc">{it.desc}</div>}
          <a className="wc-linkcard-url" data-interactive href={it.url} target="_blank" rel="noreferrer noopener">
            <Globe size={12} /> {host} <ExternalLink size={12} />
          </a>
        </div>
      </div>
    )
  }
  return (
    <div className="wc-embed">
      <div className="wc-embed-bar">
        <Globe size={12} />
        <span className="truncate">{it.title || host || 'Embed'}</span>
        {it.kind !== 'html' && (
          <a data-interactive href={it.url} target="_blank" rel="noreferrer noopener" title="Open in a new tab"><ExternalLink size={12} /></a>
        )}
      </div>
      <div className="wc-embed-frame">
        {big ? (
          it.kind === 'html' ? (
            <iframe title={it.title || 'Embed'} srcDoc={it.html} sandbox="allow-scripts allow-popups allow-forms" loading="lazy" />
          ) : (
            <iframe
              title={it.title || host}
              src={it.src || it.url}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation allow-downloads"
              allow="fullscreen; clipboard-write; encrypted-media; picture-in-picture; xr-spatial-tracking"
              referrerPolicy="strict-origin-when-cross-origin"
              loading="lazy"
            />
          )
        ) : (
          <div className="wc-placeholder"><Globe size={28} /><span>{it.title || host}</span></div>
        )}
        {!active && (
          <div className="wc-embed-cover">
            <span><MousePointerClick size={13} /> Double-click to interact</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- IFC ----------

export function IfcView({ it, active }: { it: IfcItem; active: boolean }) {
  return (
    <div className="wc-ifc">
      {active ? (
        <Suspense fallback={<div className="wc-placeholder">Loading 3D viewer…</div>}>
          <IfcViewer item={it} />
        </Suspense>
      ) : (
        <>
          {it.preview ? <img className="wc-image" src={it.preview} alt={it.name} draggable={false} /> : (
            <div className="wc-placeholder"><BoxIcon size={36} /><span>{it.name}</span></div>
          )}
          <div className="wc-ifc-badge">
            <BoxIcon size={12} /> <span className="truncate">{it.name}</span>
            {it.size ? <em>{formatBytes(it.size)}</em> : null}
          </div>
          <button className="wc-ifc-open" data-interactive onClick={() => useBoard.setState({ editingId: it.id, selection: [it.id] })}>
            Open 3D
          </button>
        </>
      )}
    </div>
  )
}

// ---------- card ----------

export function CardView({ it, editing }: { it: CardItem; editing: boolean }) {
  const set = (p: Partial<CardItem>) => update(it.id, p)
  if (editing) {
    return (
      <div className="wc-card is-edit" data-editing="true" style={{ borderLeftColor: it.fill }} onKeyDown={(e) => e.stopPropagation()}>
        <input autoFocus className="wc-card-title" placeholder="Title" value={it.title} onChange={(e) => set({ title: e.target.value })} />
        <textarea placeholder="Description" value={it.desc || ''} onChange={(e) => set({ desc: e.target.value })} rows={2} />
        <div className="wc-card-row">
          <input placeholder="Status" value={it.status || ''} onChange={(e) => set({ status: e.target.value })} />
          <input placeholder="Assignee" value={it.assignee || ''} onChange={(e) => set({ assignee: e.target.value })} />
        </div>
        <div className="wc-card-row">
          <input type="date" value={it.due || ''} onChange={(e) => set({ due: e.target.value })} />
          <input placeholder="Tags, comma separated" value={(it.tags || []).join(', ')} onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
        </div>
      </div>
    )
  }
  return (
    <div className="wc-card" style={{ borderLeftColor: it.fill }}>
      <div className="wc-card-title">{it.title || <span className="opacity-40">Untitled card</span>}</div>
      {it.desc && <div className="wc-card-desc">{it.desc}</div>}
      <div className="wc-card-chips">
        {it.status && <span className="wc-chip" style={{ background: it.fill, color: inkOn(it.fill) }}>{it.status}</span>}
        {it.assignee && <span className="wc-chip"><User size={11} /> {it.assignee}</span>}
        {it.due && <span className="wc-chip"><Calendar size={11} /> {it.due}</span>}
        {it.tags?.map((t) => <span key={t} className="wc-chip">#{t}</span>)}
      </div>
    </div>
  )
}

// ---------- table ----------

export const tableFocus = { id: '', r: 0, c: 0 }

function Cell({ it, r, c, editing }: { it: TableItem; r: number; c: number; editing: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const value = it.cells[r]?.[c] ?? ''
  useLayoutEffect(() => {
    const el = ref.current
    if (el && document.activeElement !== el && el.textContent !== value) el.textContent = value
  }, [value])
  return (
    <div
      ref={ref}
      className="wc-cell"
      data-cell={`${r}:${c}`}
      contentEditable={editing}
      suppressContentEditableWarning
      onFocus={() => { tableFocus.id = it.id; tableFocus.r = r; tableFocus.c = c }}
      onInput={(e) => {
        const cur = S().items[it.id] as TableItem
        const cells = cur.cells.map((row) => row.slice())
        cells[r][c] = e.currentTarget.textContent || ''
        update(it.id, { cells })
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return
        e.preventDefault()
        const cols = it.colW.length
        let nr = r, nc = c + (e.shiftKey ? -1 : 1)
        if (nc >= cols) { nc = 0; nr++ }
        if (nc < 0) { nc = cols - 1; nr-- }
        const next = e.currentTarget.closest('.wc-table')?.querySelector<HTMLElement>(`[data-cell="${nr}:${nc}"]`)
        next?.focus()
      }}
    />
  )
}

export function TableView({ it, editing }: { it: TableItem; editing: boolean }) {
  const sx = it.w / (it.colW.reduce((a, b) => a + b, 0) || 1)
  const sy = it.h / (it.rowH.reduce((a, b) => a + b, 0) || 1)
  const css = textCss({ align: 'left', ...it })
  return (
    <div
      className="wc-table"
      data-editing={editing ? 'true' : undefined}
      onKeyDown={(e) => { if (editing) { e.stopPropagation(); if (e.key === 'Escape') (document.activeElement as HTMLElement)?.blur() } }}
      style={{ ...css, gridTemplateColumns: it.colW.map((w) => `${w * sx}px`).join(' '), background: it.fill || '#ffffff', borderColor: it.stroke || '#c9cbd1' }}
    >
      {it.cells.map((row, r) =>
        row.map((_, c) => (
          <div key={`${r}:${c}`} className={`wc-td ${it.header && r === 0 ? 'is-head' : ''}`} style={{ minHeight: it.rowH[r] * sy, borderColor: it.stroke || '#c9cbd1' }}>
            <Cell it={it} r={r} c={c} editing={editing} />
          </div>
        )),
      )}
    </div>
  )
}

export function tableEdit(it: TableItem, op: 'addRow' | 'addCol' | 'delRow' | 'delCol') {
  const r = tableFocus.id === it.id ? tableFocus.r : it.cells.length - 1
  const c = tableFocus.id === it.id ? tableFocus.c : it.colW.length - 1
  let cells = it.cells.map((row) => row.slice())
  let colW = it.colW.slice(), rowH = it.rowH.slice()
  if (op === 'addRow') { cells.splice(r + 1, 0, Array(colW.length).fill('')); rowH.splice(r + 1, 0, 40) }
  if (op === 'addCol') { cells = cells.map((row) => { row.splice(c + 1, 0, ''); return row }); colW.splice(c + 1, 0, 140) }
  if (op === 'delRow' && cells.length > 1) { cells.splice(r, 1); rowH.splice(r, 1) }
  if (op === 'delCol' && colW.length > 1) { cells = cells.map((row) => { row.splice(c, 1); return row }); colW.splice(c, 1) }
  const sx = it.w / (it.colW.reduce((a, b) => a + b, 0) || 1)
  const sy = it.h / (it.rowH.reduce((a, b) => a + b, 0) || 1)
  apply({ [it.id]: { ...it, cells, colW, rowH, w: colW.reduce((a, b) => a + b, 0) * sx, h: rowH.reduce((a, b) => a + b, 0) * sy } })
}

// ---------- code ----------

export function CodeView({ it, editing }: { it: CodeItem; editing: boolean }) {
  const dark = it.dark !== false
  return (
    <div className={`wc-code ${dark ? 'is-dark' : ''}`} style={{ fontSize: it.fontSize || 13 }}>
      <div className="wc-code-bar">
        {editing ? (
          <input data-editing="true" value={it.lang} onChange={(e) => update(it.id, { lang: e.target.value })} onKeyDown={(e) => e.stopPropagation()} placeholder="language" />
        ) : <span>{it.lang || 'text'}</span>}
      </div>
      {editing ? (
        <textarea
          autoFocus
          data-editing="true"
          spellCheck={false}
          value={it.code}
          onChange={(e) => update(it.id, { code: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Tab') {
              e.preventDefault()
              const t = e.currentTarget
              const s = t.selectionStart, en = t.selectionEnd
              const v = t.value.slice(0, s) + '  ' + t.value.slice(en)
              update(it.id, { code: v })
              requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2 })
            }
          }}
        />
      ) : (
        <pre>{it.code || '// double-click to edit'}</pre>
      )}
    </div>
  )
}

// ---------- file ----------

export function FileView({ it }: { it: FileItem }) {
  return (
    <div className="wc-file">
      <div className="wc-file-icon"><FileText size={22} /></div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{it.name}</div>
        <div className="text-xs opacity-60">{formatBytes(it.size)}</div>
      </div>
      <button
        data-interactive
        className="wc-icon-btn"
        title="Download"
        onClick={async () => { const u = await resolveAsset(it.src); if (u) window.open(u, '_blank', 'noopener') }}
      >
        <Download size={16} />
      </button>
    </div>
  )
}

// ---------- chart ----------

const CHART_COLORS = ['#0090ff', '#f76b15', '#30a46c', '#6e56cf', '#e5484d', '#d9a400', '#12a594', '#d6409f']

export function ChartView({ it }: { it: ChartItem }) {
  const W = it.w, H = it.h
  const top = it.title ? 34 : 14, left = 44, right = 14, bottom = 30
  const pw = Math.max(10, W - left - right), ph = Math.max(10, H - top - bottom)
  const max = Math.max(1, ...it.values.map((v) => (Number.isFinite(v) ? v : 0)))
  const n = it.values.length || 1
  const nice = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v * 10) / 10}`)
  let body: React.ReactNode
  if (it.kind === 'pie') {
    const total = it.values.reduce((a, b) => a + Math.max(0, b), 0) || 1
    const cx = W * 0.36, cy = top + ph / 2 + 8, r = Math.min(W * 0.3, ph / 2 + 6)
    let a0 = -Math.PI / 2
    body = (
      <>
        {it.values.map((v, i) => {
          const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2
          const large = a1 - a0 > Math.PI ? 1 : 0
          const d = `M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z`
          a0 = a1
          return <path key={i} d={n === 1 ? `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0` : d} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="#fff" strokeWidth={1.5} />
        })}
        {it.labels.slice(0, 10).map((l, i) => (
          <g key={i} transform={`translate(${W * 0.72}, ${top + 8 + i * 18})`}>
            <rect width={10} height={10} rx={2} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            <text x={16} y={9} fontSize={11} fill="#3a3d45">{l} · {Math.round((Math.max(0, it.values[i]) / total) * 100)}%</text>
          </g>
        ))}
      </>
    )
  } else {
    const step = pw / n
    const pts = it.values.map((v, i) => `${left + step * (i + 0.5)},${top + ph - (Math.max(0, v) / max) * ph}`)
    body = (
      <>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={left} x2={W - right} y1={top + ph - ph * t} y2={top + ph - ph * t} stroke="#e4e4e0" />
            <text x={left - 6} y={top + ph - ph * t + 4} fontSize={10} textAnchor="end" fill="#7a7d86">{nice(max * t)}</text>
          </g>
        ))}
        {it.kind === 'bar'
          ? it.values.map((v, i) => {
              const h = (Math.max(0, v) / max) * ph
              return <rect key={i} x={left + step * i + step * 0.16} y={top + ph - h} width={step * 0.68} height={h} rx={3} fill={it.fill || CHART_COLORS[0]} />
            })
          : (
            <>
              <polyline points={pts.join(' ')} fill="none" stroke={it.fill || CHART_COLORS[0]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p, i) => { const [x, y] = p.split(','); return <circle key={i} cx={x} cy={y} r={3.5} fill="#fff" stroke={it.fill || CHART_COLORS[0]} strokeWidth={2} /> })}
            </>
          )}
        {it.labels.map((l, i) => (n <= 14 || i % Math.ceil(n / 14) === 0) && (
          <text key={i} x={left + step * (i + 0.5)} y={H - 10} fontSize={10} textAnchor="middle" fill="#7a7d86">{l.length > 10 ? l.slice(0, 9) + '…' : l}</text>
        ))}
      </>
    )
  }
  return (
    <div className="wc-chart">
      <svg width={W} height={H}>
        {it.title && <text x={14} y={22} fontSize={14} fontWeight={600} fill="#1c1e23">{it.title}</text>}
        {body}
      </svg>
    </div>
  )
}

export function useAssetUrl(src: string) { return useAsset(src) }
