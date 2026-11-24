import {
  AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignLeft, AlignRight,
  AlignStartHorizontal, AlignStartVertical, Bold, Box as BoxIcon, Columns3, Copy, ExternalLink, Group, Italic,
  LayoutGrid, Lock, Minus, MoreHorizontal, MousePointerClick, PaintBucket, Pencil, Play, Plus, Rows3, Shapes, Strikethrough,
  Trash2, Underline, Ungroup, Unlock,
} from 'lucide-react'
import { FILL_COLORS, INK_COLORS, SHAPE_KINDS, STICKY_COLORS } from '../defaults'
import { aabb, itemBox, shapePath, toScreen, unionBoxes } from '../geometry'
import { activate } from '../interaction'
import { tableEdit } from '../items/Blocks'
import { alignSelection, deleteSelection, duplicateSelection, groupSelection, setStyle, toggleLock, ungroupSelection } from '../ops'
import { S, fitBox, orderedFrames, useBoard } from '../store'
import type { Cap, ConnectorItem, Dash, Item, Route, ShapeItem, TableItem } from '../types'
import { Pop, Swatches, useFlexMode, useNarrow } from './kit'

const CAPS: Cap[] = ['none', 'arrow', 'triangle', 'dot', 'diamond', 'bar']
const DASHES: Dash[] = ['solid', 'dashed', 'dotted']
const ROUTES: Route[] = ['straight', 'elbow', 'curve']
const TEXTY = new Set(['sticky', 'text', 'shape', 'table'])
const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96, 144]

function Dot({ color }: { color: string }) {
  return <span style={{ width: 18, height: 18, borderRadius: 9, background: color === 'transparent' ? 'linear-gradient(135deg,#fff 45%,#e5484d 46%,#e5484d 54%,#fff 55%)' : color, border: '1px solid rgba(0,0,0,.2)', display: 'block' }} />
}

export function ContextBar() {
  const selection = useBoard((s) => s.selection)
  const items = useBoard((s) => s.items)
  const camera = useBoard((s) => s.camera)
  const viewport = useBoard((s) => s.viewport)
  const tool = useBoard((s) => s.tool)
  const role = useBoard((s) => s.role)
  const editingId = useBoard((s) => s.editingId)
  const presenting = useBoard((s) => s.presenting != null)
  const marquee = useBoard((s) => s.marquee)
  const narrow = useNarrow()
  const flex = useFlexMode()
  const sel = selection.map((id) => items[id]).filter(Boolean) as Item[]
  if (!sel.length || tool !== 'select' || presenting || marquee || (role !== 'owner' && role !== 'editor')) return null

  const first = sel[0]
  const types = new Set(sel.map((i) => i.type))
  const one = sel.length === 1 ? first : null
  const all = (t: string) => types.size === 1 && types.has(t as Item['type'])
  const locked = sel.every((i) => i.locked)
  const texty = sel.every((i) => TEXTY.has(i.type))
  const fillable = sel.every((i) => i.type === 'sticky' || i.type === 'shape' || i.type === 'frame' || i.type === 'card' || i.type === 'text' || i.type === 'table')
  const strokable = sel.every((i) => i.type === 'shape' || i.type === 'connector' || i.type === 'draw')
  const fs = (first as { fontSize?: number }).fontSize || (first.type === 'text' ? 20 : first.type === 'sticky' ? 18 : 16)
  const st = first as { bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; align?: string; color?: string; fill?: string; stroke?: string }

  const cmd = (name: string, key: string, value: boolean) => {
    // While editing with a text range selected, format just that range.
    const range = window.getSelection()
    if (editingId && range && !range.isCollapsed) document.execCommand(name)
    else setStyle({ [key]: value })
  }

  const bar = (
    <div className="wc-context wc-surface" onPointerDown={(e) => { if (editingId && (e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault() }}>
      {locked ? (
        <button className="wc-btn" onClick={() => toggleLock()}><Unlock size={16} /> Unlock</button>
      ) : (
        <>
          {all('shape') && (
            <Pop button={(o, t) => <button className={`wc-btn ${o ? 'is-on' : ''}`} title="Shape" onClick={t}><Shapes size={16} /></button>}>
              <div className="wc-shapes">
                {SHAPE_KINDS.map((k) => (
                  <button key={k.kind} className={`wc-btn ${(first as ShapeItem).kind === k.kind ? 'is-on' : ''}`} title={k.label} style={{ padding: 0 }} onClick={() => setStyle({ kind: k.kind })}>
                    <svg width="22" height="18" viewBox="-1 -1 24 20"><path d={shapePath(k.kind, 22, 18)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
                  </button>
                ))}
              </div>
            </Pop>
          )}
          {fillable && (
            <Pop button={(o, t) => <button className={`wc-btn ${o ? 'is-on' : ''}`} title="Fill colour" onClick={t}><Dot color={st.fill || 'transparent'} /></button>}>
              <Swatches colors={all('sticky') ? STICKY_COLORS : FILL_COLORS} allowNone={!all('sticky') && !all('card')} value={st.fill} onPick={(c) => setStyle({ fill: c === 'transparent' && all('text') ? undefined : c })} />
            </Pop>
          )}
          {strokable && (
            <Pop button={(o, t) => <button className={`wc-btn ${o ? 'is-on' : ''}`} title="Line" onClick={t}><span style={{ width: 18, height: 18, borderRadius: 9, border: `3.5px solid ${st.stroke || '#1c1e23'}`, display: 'block' }} /></button>}>
              <div className="flex flex-col gap-2.5">
                <Swatches colors={INK_COLORS} value={st.stroke} onPick={(c) => setStyle({ stroke: c })} />
                {!all('draw') && (
                  <>
                    <div className="wc-row">
                      {[0, 1, 2, 4, 6, 10].filter((w) => w || all('shape')).map((w) => (
                        <button key={w} className={`wc-btn ${(first as ShapeItem).strokeW === w ? 'is-on' : ''}`} title={`${w}px`} onClick={() => setStyle({ strokeW: w })}>
                          {w ? <span style={{ width: 20, height: Math.max(1, w), background: 'currentColor', borderRadius: 2 }} /> : '∅'}
                        </button>
                      ))}
                    </div>
                    <div className="wc-row">
                      {DASHES.map((d) => (
                        <button key={d} className={`wc-btn ${((first as ShapeItem).dash || 'solid') === d ? 'is-on' : ''}`} title={d} onClick={() => setStyle({ dash: d })}>
                          <svg width="26" height="6"><line x1="1" y1="3" x2="25" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={d === 'dashed' ? '6 4' : d === 'dotted' ? '0.5 4' : undefined} /></svg>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {all('draw') && (
                  <label className="wc-row text-xs">Size<input type="range" min={1} max={60} value={(first as { size: number }).size} onChange={(e) => setStyle({ size: +e.target.value })} /></label>
                )}
              </div>
            </Pop>
          )}
          {all('connector') && (
            <>
              <Pop button={(o, t) => <button className={`wc-btn ${o ? 'is-on' : ''}`} title="Line type and ends" onClick={t}><svg width="22" height="16" viewBox="0 0 22 16"><path d="M2 13 H11 V3 H20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}>
                <div className="flex flex-col gap-2 text-xs">
                  <div className="wc-row">{ROUTES.map((r) => <button key={r} className={`wc-btn ${(first as ConnectorItem).route === r ? 'is-on' : ''}`} onClick={() => setStyle({ route: r })}>{r}</button>)}</div>
                  <div className="wc-label">Start</div>
                  <div className="wc-row flex-wrap">{CAPS.map((c) => <button key={c} className={`wc-btn ${(first as ConnectorItem).capA === c ? 'is-on' : ''}`} onClick={() => setStyle({ capA: c })}>{c}</button>)}</div>
                  <div className="wc-label">End</div>
                  <div className="wc-row flex-wrap">{CAPS.map((c) => <button key={c} className={`wc-btn ${(first as ConnectorItem).capB === c ? 'is-on' : ''}`} onClick={() => setStyle({ capB: c })}>{c}</button>)}</div>
                </div>
              </Pop>
              {one && <button className="wc-btn" title="Edit label" onClick={() => activate(one.id)}><Pencil size={15} /></button>}
            </>
          )}
          {texty && (
            <>
              <div className="wc-sep" />
              <button className="wc-btn" title="Smaller text" onClick={() => setStyle({ fontSize: Math.max(6, [...FONT_SIZES].reverse().find((s) => s < fs) ?? fs - 2) })}><Minus size={14} /></button>
              <Pop button={(o, t) => <button className={`wc-btn ${o ? 'is-on' : ''}`} title="Text size" onClick={t} style={{ minWidth: 30 }}>{Math.round(fs)}</button>}>
                {(close) => (
                  <div className="wc-menu" style={{ minWidth: 80, padding: 0 }}>
                    {FONT_SIZES.map((s) => <button key={s} onClick={() => { setStyle({ fontSize: s }); close() }}>{s}</button>)}
                  </div>
                )}
              </Pop>
              <button className="wc-btn" title="Larger text" onClick={() => setStyle({ fontSize: FONT_SIZES.find((s) => s > fs) ?? fs + 8 })}><Plus size={14} /></button>
              <button className={`wc-btn ${st.bold ? 'is-on' : ''}`} title="Bold (Ctrl+B)" onClick={() => cmd('bold', 'bold', !st.bold)}><Bold size={15} /></button>
              <button className={`wc-btn ${st.italic ? 'is-on' : ''}`} title="Italic (Ctrl+I)" onClick={() => cmd('italic', 'italic', !st.italic)}><Italic size={15} /></button>
              <Pop button={(o, t) => <button className={`wc-btn ${o ? 'is-on' : ''}`} title="More text options" onClick={t}><span style={{ fontWeight: 700, borderBottom: `3px solid ${st.color || '#1c1e23'}`, lineHeight: 1 }}>A</span></button>}>
                <div className="flex flex-col gap-2.5">
                  <div className="wc-row">
                    <button className={`wc-btn ${st.underline ? 'is-on' : ''}`} title="Underline" onClick={() => cmd('underline', 'underline', !st.underline)}><Underline size={15} /></button>
                    <button className={`wc-btn ${st.strike ? 'is-on' : ''}`} title="Strikethrough" onClick={() => cmd('strikeThrough', 'strike', !st.strike)}><Strikethrough size={15} /></button>
                    <div className="wc-sep" />
                    <button className={`wc-btn ${st.align === 'left' ? 'is-on' : ''}`} title="Align left" onClick={() => setStyle({ align: 'left' })}><AlignLeft size={15} /></button>
                    <button className={`wc-btn ${st.align === 'center' ? 'is-on' : ''}`} title="Align centre" onClick={() => setStyle({ align: 'center' })}><AlignCenter size={15} /></button>
                    <button className={`wc-btn ${st.align === 'right' ? 'is-on' : ''}`} title="Align right" onClick={() => setStyle({ align: 'right' })}><AlignRight size={15} /></button>
                  </div>
                  {!all('text') && !all('table') && (
                    <div className="wc-row text-xs">
                      {(['top', 'middle', 'bottom'] as const).map((v) => <button key={v} className={`wc-btn ${((first as ShapeItem).valign || 'middle') === v ? 'is-on' : ''}`} onClick={() => setStyle({ valign: v })}>{v}</button>)}
                    </div>
                  )}
                  <div className="wc-row text-xs">
                    {(['sans', 'serif', 'mono', 'hand'] as const).map((f) => <button key={f} className={`wc-btn ${((first as ShapeItem).font || 'sans') === f ? 'is-on' : ''}`} onClick={() => setStyle({ font: f })}>{f}</button>)}
                  </div>
                  <Swatches colors={INK_COLORS} value={st.color} onPick={(c) => setStyle({ color: c })} />
                  {all('sticky') && (
                    <label className="wc-row text-xs">
                      <input type="checkbox" checked={(first as { autoFit?: boolean }).autoFit !== false} onChange={(e) => setStyle({ autoFit: e.target.checked })} />
                      Shrink text only when it would overflow
                    </label>
                  )}
                </div>
              </Pop>
            </>
          )}
          {one?.type === 'table' && (
            <>
              <div className="wc-sep" />
              <button className="wc-btn" title="Add row below" onClick={() => tableEdit(S().items[one.id] as TableItem, 'addRow')}><Rows3 size={15} /><Plus size={11} /></button>
              <button className="wc-btn" title="Add column right" onClick={() => tableEdit(S().items[one.id] as TableItem, 'addCol')}><Columns3 size={15} /><Plus size={11} /></button>
              <button className="wc-btn" title="Delete row" onClick={() => tableEdit(S().items[one.id] as TableItem, 'delRow')}><Rows3 size={15} /><Minus size={11} /></button>
              <button className="wc-btn" title="Delete column" onClick={() => tableEdit(S().items[one.id] as TableItem, 'delCol')}><Columns3 size={15} /><Minus size={11} /></button>
              <button className={`wc-btn ${(one as TableItem).header ? 'is-on' : ''}`} title="Header row" onClick={() => setStyle({ header: !(one as TableItem).header })}>H</button>
            </>
          )}
          {one && (one.type === 'embed' || one.type === 'ifc') && (
            <>
              <button className="wc-btn" onClick={() => activate(one.id)}>{one.type === 'ifc' ? <BoxIcon size={15} /> : <MousePointerClick size={15} />} {one.type === 'ifc' ? 'Open 3D' : 'Interact'}</button>
              {one.type === 'embed' && one.kind !== 'html' && <a className="wc-btn" href={one.url} target="_blank" rel="noreferrer noopener" title="Open link"><ExternalLink size={15} /></a>}
            </>
          )}
          {one && (one.type === 'card' || one.type === 'code') && <button className="wc-btn" onClick={() => activate(one.id)}><Pencil size={15} /> Edit</button>}
          {one?.type === 'code' && <button className="wc-btn" title="Light or dark" onClick={() => setStyle({ dark: one.dark === false })}><PaintBucket size={15} /></button>}
          {one?.type === 'chart' && (['bar', 'line', 'pie'] as const).map((k) => <button key={k} className={`wc-btn ${one.kind === k ? 'is-on' : ''}`} onClick={() => setStyle({ kind: k })}>{k}</button>)}
          {one?.type === 'frame' && (
            <>
              <button className="wc-btn" title="Rename" onClick={() => activate(one.id)}><Pencil size={15} /></button>
              <button className="wc-btn" title="Present from this frame" onClick={() => { const i = orderedFrames().findIndex((f) => f.id === one.id); useBoard.setState({ presenting: Math.max(0, i), selection: [] }); fitBox(aabb(one), 24, true, 8) }}><Play size={15} /></button>
            </>
          )}
          {sel.length > 1 && (
            <>
              <div className="wc-sep" />
              <Pop button={(o, t) => <button className={`wc-btn ${o ? 'is-on' : ''}`} title="Align and distribute" onClick={t}><AlignStartVertical size={16} /></button>}>
                <div className="grid grid-cols-3 gap-1">
                  <button className="wc-btn" title="Align left (Alt+A)" onClick={() => alignSelection('left')}><AlignStartVertical size={16} /></button>
                  <button className="wc-btn" title="Centre horizontally (Alt+H)" onClick={() => alignSelection('hcenter')}><AlignCenterVertical size={16} /></button>
                  <button className="wc-btn" title="Align right (Alt+D)" onClick={() => alignSelection('right')}><AlignEndVertical size={16} /></button>
                  <button className="wc-btn" title="Align top (Alt+W)" onClick={() => alignSelection('top')}><AlignStartHorizontal size={16} /></button>
                  <button className="wc-btn" title="Centre vertically (Alt+V)" onClick={() => alignSelection('vcenter')}><AlignCenterHorizontal size={16} /></button>
                  <button className="wc-btn" title="Align bottom (Alt+S)" onClick={() => alignSelection('bottom')}><AlignEndHorizontal size={16} /></button>
                  <button className="wc-btn" title="Distribute horizontally" onClick={() => alignSelection('hdist')}><Columns3 size={16} /></button>
                  <button className="wc-btn" title="Distribute vertically" onClick={() => alignSelection('vdist')}><Rows3 size={16} /></button>
                  <button className="wc-btn" title="Tidy into a grid" onClick={() => alignSelection('grid')}><LayoutGrid size={16} /></button>
                </div>
              </Pop>
              {sel.some((i) => i.group)
                ? <button className="wc-btn" title="Ungroup (Ctrl+Shift+G)" onClick={ungroupSelection}><Ungroup size={16} /></button>
                : <button className="wc-btn" title="Group (Ctrl+G)" onClick={groupSelection}><Group size={16} /></button>}
            </>
          )}
          <div className="wc-sep" />
          <button className="wc-btn" title="Duplicate (Ctrl+D)" onClick={() => duplicateSelection()}><Copy size={15} /></button>
          <button className="wc-btn" title="Lock (Ctrl+Shift+L)" onClick={() => toggleLock()}><Lock size={15} /></button>
          <button className="wc-btn is-danger" title="Delete" onClick={deleteSelection}><Trash2 size={15} /></button>
          <button
            className="wc-btn" title="More"
            onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); useBoard.setState({ ctxMenu: { x: r.left, y: r.bottom + 6, world: { x: first.x, y: first.y } } }) }}
          >
            <MoreHorizontal size={16} />
          </button>
        </>
      )}
    </div>
  )

  if (narrow || flex) return <div className="wc-ui wc-context-dock">{bar}</div>

  const box = unionBoxes(sel.map((i) => itemBox(i, items)))
  if (!box) return null
  const tl = toScreen(camera, box.x, box.y)
  const w = box.w * camera.z, h = box.h * camera.z
  const above = tl.y - 58
  const top = above > 62 ? above : Math.min(viewport.h - 60, tl.y + h + 44)
  const cx = Math.max(200, Math.min(viewport.w - 200, tl.x + w / 2))
  return <div className="wc-ui" style={{ left: cx, top, transform: 'translateX(-50%)', zIndex: 25 }}>{bar}</div>
}
