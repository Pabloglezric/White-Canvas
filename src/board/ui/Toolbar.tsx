import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowUpRight, Eraser, Frame, Hand, Highlighter, Lock, MessageCircle, MousePointer2, PenLine, Plus, Redo2, Shapes,
  StickyNote, Type, Undo2,
} from 'lucide-react'
import { FRAME_PRESETS, HL_COLORS, INK_COLORS, SHAPE_KINDS, STICKY_COLORS, make } from '../defaults'
import { shapePath } from '../geometry'
import { addItems, freeSpot } from '../ops'
import { S, canComment, canEdit, redo, undo, useBoard, viewCenter } from '../store'
import type { Route, Tool } from '../types'
import { Swatches, useNarrow } from './kit'

const ROUTES: { route: Route; label: string; d: string }[] = [
  { route: 'straight', label: 'Straight', d: 'M3 17 L21 5' },
  { route: 'elbow', label: 'Elbow', d: 'M3 17 H12 V5 H21' },
  { route: 'curve', label: 'Curved', d: 'M3 17 C12 17 12 5 21 5' },
]

export function Toolbar() {
  const tool = useBoard((s) => s.tool)
  const toolLock = useBoard((s) => s.toolLock)
  const role = useBoard((s) => s.role)
  const canUndo = useBoard((s) => s.undo.length > 0)
  const canRedo = useBoard((s) => s.redo.length > 0)
  const prefs = useBoard(useShallow((s) => ({ stickyColor: s.stickyColor, shapeKind: s.shapeKind, connRoute: s.connRoute, fingerDraws: s.fingerDraws, penColor: s.penColor, hlColor: s.hlColor, penSize: s.penSize, hlSize: s.hlSize, setPrefs: s.setPrefs })))
  const [fly, setFly] = useState<Tool | null>(null)
  const editor = role === 'owner' || role === 'editor'
  const narrow = useNarrow()

  useEffect(() => {
    const down = (e: PointerEvent) => { if ((e.target as HTMLElement).closest?.('[data-canvas]')) setFly(null) }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [])

  const pick = (t: Tool, hasFly = false) => {
    if (tool === t && hasFly) setFly(fly === t ? null : t)
    else { S().setTool(t); setFly(hasFly ? t : null) }
  }
  const inkTool = tool === 'pen' || tool === 'highlighter' || tool === 'eraser'
  const btn = (t: Tool, icon: React.ReactNode, label: string, hasFly = false) => (
    <button
      key={t}
      className={`wc-btn ${tool === t ? 'is-on' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={tool === t}
      onClick={() => pick(t, hasFly)}
      onDoubleClick={() => { if (t !== 'select' && t !== 'hand') useBoard.setState({ tool: t, toolLock: true }) }}
    >
      {icon}
    </button>
  )

  const history = (
    <>
      <button className="wc-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={undo}><Undo2 size={18} /></button>
      <button className="wc-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={redo}><Redo2 size={18} /></button>
    </>
  )

  return (
    <>
    {narrow && editor && <div className="wc-ui wc-undo wc-surface">{history}</div>}
    <div className="wc-ui wc-toolbar wc-surface" role="toolbar" aria-label="Tools">
      {btn('select', <MousePointer2 size={19} />, 'Select (V)')}
      {!narrow && btn('hand', <Hand size={19} />, 'Pan (H or hold Space)')}
      {editor && (
        <>
          <div className="wc-sep is-h" />
          {btn('sticky', <StickyNote size={19} />, 'Sticky note (N)', true)}
          {btn('text', <Type size={19} />, 'Text (T)')}
          {btn('shape', <Shapes size={19} />, 'Shape (S)', true)}
          {btn('connector', <ArrowUpRight size={19} />, 'Connector (L)', true)}
          <button className={`wc-btn ${inkTool ? 'is-on' : ''}`} title="Pen (P)" aria-label="Pen" onClick={() => pick(inkTool ? tool : 'pen', true)}>
            {tool === 'highlighter' ? <Highlighter size={19} /> : tool === 'eraser' ? <Eraser size={19} /> : <PenLine size={19} />}
          </button>
          {btn('frame', <Frame size={19} />, 'Frame (F)', true)}
        </>
      )}
      {canComment() && btn('comment', <MessageCircle size={19} />, 'Comment (C)')}
      {editor && (
        <>
          <button className="wc-btn" title="Insert: files, embeds, 3D models, tables, templates" aria-label="Insert" onClick={() => useBoard.setState({ panel: S().panel === 'insert' ? null : 'insert' })}>
            <Plus size={20} />
          </button>
          {!narrow && <><div className="wc-sep is-h" />{history}</>}
        </>
      )}
      {toolLock && tool !== 'select' && (
        <span className="wc-btn" title="Tool locked — press Esc to release" style={{ color: 'var(--accent)' }}><Lock size={14} /></span>
      )}

    </div>
      {fly && fly === tool && (
        <div className="wc-ui wc-flyout wc-surface" onPointerDown={(e) => e.stopPropagation()}>
          {fly === 'sticky' && <Swatches colors={STICKY_COLORS} value={prefs.stickyColor} onPick={(c) => prefs.setPrefs({ stickyColor: c })} />}
          {fly === 'shape' && (
            <div className="wc-shapes">
              {SHAPE_KINDS.map((k) => (
                <button key={k.kind} className={`wc-btn ${prefs.shapeKind === k.kind ? 'is-on' : ''}`} title={k.label} onClick={() => prefs.setPrefs({ shapeKind: k.kind })} style={{ padding: 0 }}>
                  <svg width="22" height="18" viewBox="-1 -1 24 20"><path d={shapePath(k.kind, 22, 18)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
                </button>
              ))}
            </div>
          )}
          {fly === 'connector' && (
            <div className="wc-row">
              {ROUTES.map((r) => (
                <button key={r.route} className={`wc-btn ${prefs.connRoute === r.route ? 'is-on' : ''}`} title={r.label} onClick={() => prefs.setPrefs({ connRoute: r.route })}>
                  <svg width="24" height="22" viewBox="0 0 24 22"><path d={r.d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
              ))}
            </div>
          )}
          {inkTool && (
            <div className="flex flex-col gap-2">
              <div className="wc-row">
                <button className={`wc-btn ${tool === 'pen' ? 'is-on' : ''}`} title="Pen (P)" onClick={() => S().setTool('pen')}><PenLine size={18} /></button>
                <button className={`wc-btn ${tool === 'highlighter' ? 'is-on' : ''}`} title="Highlighter (Shift+H)" onClick={() => S().setTool('highlighter')}><Highlighter size={18} /></button>
                <button className={`wc-btn ${tool === 'eraser' ? 'is-on' : ''}`} title="Eraser (E)" onClick={() => S().setTool('eraser')}><Eraser size={18} /></button>
                <label className="wc-row ml-2 text-xs" title="When off, one finger pans and only a stylus draws">
                  <input type="checkbox" checked={prefs.fingerDraws} onChange={(e) => prefs.setPrefs({ fingerDraws: e.target.checked })} /> Finger draws
                </label>
              </div>
              {tool !== 'eraser' && (
                <>
                  <Swatches
                    colors={tool === 'pen' ? INK_COLORS : HL_COLORS}
                    value={tool === 'pen' ? prefs.penColor : prefs.hlColor}
                    onPick={(c) => prefs.setPrefs(tool === 'pen' ? { penColor: c } : { hlColor: c })}
                  />
                  <label className="wc-row text-xs">
                    Size
                    <input
                      type="range" min={tool === 'pen' ? 1 : 8} max={tool === 'pen' ? 24 : 48} className="flex-1"
                      value={tool === 'pen' ? prefs.penSize : prefs.hlSize}
                      onChange={(e) => prefs.setPrefs(tool === 'pen' ? { penSize: +e.target.value } : { hlSize: +e.target.value })}
                    />
                    <span className="w-6 text-right tabular-nums">{tool === 'pen' ? prefs.penSize : prefs.hlSize}</span>
                  </label>
                </>
              )}
            </div>
          )}
          {fly === 'frame' && (
            <div className="wc-menu" style={{ padding: 0, minWidth: 170 }}>
              <div className="wc-label px-2 py-1">Drag to draw, or add a preset</div>
              {FRAME_PRESETS.filter((p) => p.w).map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    const c = freeSpot(viewCenter(), p.w, p.h)
                    const n = Object.values(S().items).filter((i) => i.type === 'frame').length + 1
                    addItems([make.frame({ x: c.x - p.w / 2, y: c.y - p.h / 2, w: p.w, h: p.h, title: `Frame ${n}`, preset: p.label })])
                    S().setTool('select'); setFly(null)
                  }}
                >
                  {p.label}<kbd>{p.w}×{p.h}</kbd>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

export { canEdit }
