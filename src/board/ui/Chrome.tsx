import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, CloudOff, Download, Grid3x3, History, Keyboard, LayoutTemplate, ListTree,
  Magnet, Map as MapIcon, Maximize, MessageCircle, Minus, Moon, MoreHorizontal, MousePointer2, Play, Plus, Search, Send,
  Share2, Sun, Timer, Trash2, Users, X,
} from 'lucide-react'
import { initials, timeAgo, uid } from '../../lib/util'
import { exportImage } from '../export'
import { aabb, itemBox, toScreen, unionBoxes } from '../geometry'
import { make } from '../defaults'
import {
  addItems, copySelection, deleteSelection, duplicateSelection, groupSelection, pasteItems, reorder, selectAll, toggleLock,
  ungroupSelection,
} from '../ops'
import {
  S, apply, canComment, canEdit, commit, fitAll, fitBox, mutate, orderedFrames, toast, useBoard, viewBox, zoomTo,
} from '../store'
import { summon, updateMeta } from '../sync'
import type { CommentItem, Item } from '../types'
import { Pop, useNarrow } from './kit'

// ---------- top bar ----------

function TimerChip() {
  const timer = useBoard((s) => s.meta?.settings.timer)
  const [now, setNow] = useState(() => Date.now())
  const endsAt = timer?.endsAt || 0
  useEffect(() => {
    if (!endsAt) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [endsAt])
  const left = endsAt ? Math.max(0, Math.round((endsAt - now) / 1000)) : 0
  const over = !!endsAt && now >= endsAt
  // announce once, from an effect (never while rendering)
  useEffect(() => {
    if (!over || Date.now() - endsAt > 3000) return
    toast('Time is up')
    navigator.vibrate?.([120, 80, 120])
  }, [over, endsAt])
  // the chip clears itself shortly after the end instead of sitting at 0:00
  if (!endsAt || now - endsAt > 8000) return null
  return (
    <button className="wc-btn" title="Timer — click to stop" aria-label={`Timer, ${Math.floor(left / 60)} minutes ${left % 60} seconds left. Click to stop`} style={{ color: left <= 10 ? 'var(--danger)' : undefined, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }} onClick={() => canEdit() && updateMeta({ settings: { timer: null } })}>
      <Timer size={15} /> {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
    </button>
  )
}

export function TopBar() {
  const nav = useNavigate()
  const meta = useBoard((s) => s.meta)
  const sync = useBoard((s) => s.syncState)
  const role = useBoard((s) => s.role)
  const peers = useBoard((s) => s.peers)
  const following = useBoard((s) => s.following)
  const me = useBoard((s) => s.me)
  const theme = useBoard((s) => s.theme)
  const grid = useBoard((s) => s.grid)
  const snap = useBoard((s) => s.snap)
  const minimap = useBoard((s) => s.minimap)
  const navMode = useBoard((s) => s.navMode)
  const showComments = useBoard((s) => s.showComments)
  const narrow = useNarrow()
  const [title, setTitle] = useState(meta?.title || '')
  useEffect(() => setTitle(meta?.title || ''), [meta?.title])
  const editor = role === 'owner' || role === 'editor'
  const panel = (p: NonNullable<ReturnType<typeof S>['panel']>) => useBoard.setState({ panel: S().panel === p ? null : p, activeComment: null })
  const peerList = Object.values(peers)
  const syncLabel = { synced: 'All changes saved', saving: 'Saving…', offline: 'Offline — changes are kept on this device and sync when you reconnect', local: 'Stored on this device only' }[sync]

  const present = () => {
    const frames = orderedFrames()
    if (!frames.length) { toast('Add a frame first — each frame becomes a slide'); return }
    useBoard.setState({ presenting: 0, selection: [], panel: null, tool: 'select' })
    fitBox(aabb(frames[0]), 24, true, 8)
  }

  return (
    <div className="wc-ui wc-topbar">
      <div className="wc-surface">
        <button className="wc-btn" title="All boards" aria-label="All boards" onClick={() => nav('/')}><ArrowLeft size={18} /></button>
        <input
          className="wc-title" value={title} readOnly={!editor} aria-label="Board title" size={Math.max(6, Math.min(28, title.length))}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          onBlur={() => { const t = title.trim() || 'Untitled board'; setTitle(t); if (t !== meta?.title) updateMeta({ title: t }) }}
        />
        <span className="wc-btn" title={syncLabel} style={{ minWidth: 28, padding: 0 }}>
          {sync === 'offline' ? <CloudOff size={15} color="var(--danger)" /> : <span className={`wc-statusdot is-${sync}`} />}
        </span>
        {role === 'viewer' && <span className="wc-chip mr-1">View only</span>}
        {role === 'commenter' && <span className="wc-chip mr-1">Can comment</span>}
      </div>
      <div className="wc-surface">
        <TimerChip />
        {peerList.length > 0 && (
          <div className="wc-row px-1" style={{ gap: 0 }}>
            {peerList.slice(0, narrow ? 2 : 5).map((p) => (
              <button
                key={p.id} className={`wc-avatar ${following === p.id ? 'is-following' : ''}`} style={{ background: p.color }}
                title={following === p.id ? `Following ${p.name} — click to stop` : `${p.name} — click to follow`}
                onClick={() => useBoard.setState({ following: following === p.id ? null : p.id })}
              >
                {initials(p.name)}
              </button>
            ))}
            {peerList.length > (narrow ? 2 : 5) && <span className="wc-avatar" style={{ background: 'var(--ink-3)' }}>+{peerList.length - (narrow ? 2 : 5)}</span>}
          </div>
        )}
        <span className="wc-avatar wc-hide-narrow" style={{ background: me.color, marginLeft: 2 }} title={`${me.name} (you)`}>{initials(me.name)}</span>
        <button className="wc-btn wc-hide-narrow" title="Search this board (Ctrl+F)" onClick={() => panel('search')}><Search size={17} /></button>
        <button className="wc-btn wc-hide-narrow" title="Comments" onClick={() => panel('comments')}><MessageCircle size={17} /></button>
        <button className="wc-btn wc-hide-narrow" title="Present frames" onClick={present}><Play size={17} /></button>
        {role === 'owner' && <button className="wc-btn is-accent" onClick={() => panel('share')}><Share2 size={15} /><span className="wc-hide-narrow">Share</span></button>}
        <Pop placement="bottom" button={(o, t) => <button className={`wc-btn ${o ? 'is-on' : ''}`} title="Menu" aria-label="Menu" onClick={t}><MoreHorizontal size={18} /></button>}>
          {(close) => (
            <div className="wc-menu" style={{ padding: 0 }} onClick={(e) => { if ((e.target as HTMLElement).closest('button[data-close]')) close() }}>
              {narrow && <button data-close onClick={() => panel('search')}><Search size={16} /> Search board</button>}
              {narrow && <button data-close onClick={() => panel('comments')}><MessageCircle size={16} /> Comments</button>}
              {narrow && <button data-close onClick={present}><Play size={16} /> Present frames</button>}
              <button data-close onClick={() => panel('frames')}><ListTree size={16} /> Frames outline</button>
              {editor && <button data-close onClick={() => panel('templates')}><LayoutTemplate size={16} /> Templates</button>}
              <button data-close onClick={() => panel('export')}><Download size={16} /> Export</button>
              <button data-close onClick={() => panel('versions')}><History size={16} /> Version history</button>
              {editor && <button data-close onClick={() => panel('facilitate')}><Timer size={16} /> Timer and voting</button>}
              {peerList.length > 0 && editor && (
                <button data-close onClick={() => { summon(me.name, viewBox()); toast('Everyone is now looking at your view') }}><Users size={16} /> Bring everyone to me</button>
              )}
              <div className="wc-sep is-h" />
              <button onClick={() => S().setPrefs({ grid: grid === 'dots' ? 'lines' : grid === 'lines' ? 'none' : 'dots' })}><Grid3x3 size={16} /> Grid<kbd>{grid}</kbd></button>
              <button onClick={() => S().setPrefs({ snap: !snap })}><Magnet size={16} /> Snap to objects<kbd>{snap ? 'on' : 'off'}</kbd></button>
              <button onClick={() => S().setPrefs({ minimap: !minimap })}><MapIcon size={16} /> Minimap<kbd>{minimap ? 'on' : 'off'}</kbd></button>
              <button onClick={() => S().setPrefs({ showComments: !showComments })}><MessageCircle size={16} /> Comment pins<kbd>{showComments ? 'shown' : 'hidden'}</kbd></button>
              <button title="Auto detects mouse wheel vs trackpad on every scroll" onClick={() => S().setPrefs({ navMode: navMode === 'auto' ? 'mouse' : navMode === 'mouse' ? 'trackpad' : 'auto' })}><MousePointer2 size={16} /> Scroll mode<kbd>{navMode}</kbd></button>
              <button onClick={() => S().setPrefs({ theme: theme === 'dark' ? 'light' : 'dark' })}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />} {theme === 'dark' ? 'Light' : 'Dark'} theme</button>
              <button data-close onClick={() => panel('shortcuts')}><Keyboard size={16} /> Shortcuts and gestures<kbd>?</kbd></button>
            </div>
          )}
        </Pop>
      </div>
    </div>
  )
}

// ---------- zoom + minimap ----------

export function ZoomBar() {
  const z = useBoard((s) => s.camera.z)
  const minimap = useBoard((s) => s.minimap)
  const lost = useBoard((s) => s.lost)
  return (
    <>
      {minimap && <Minimap />}
      {lost && (
        <button className="wc-ui wc-btn is-accent" style={{ left: '50%', top: 'calc(70px + var(--sat))', transform: 'translateX(-50%)', boxShadow: 'var(--shadow)' }} onClick={() => fitAll()}>
          <Maximize size={15} /> Back to content
        </button>
      )}
      <div className="wc-ui wc-zoombar wc-surface">
        <button className="wc-btn is-wide" title="Zoom out (Ctrl −)" onClick={() => zoomTo(z / 1.25)}><Minus size={15} /></button>
        <button className="wc-btn" title="Reset to 100% (Ctrl 0)" onClick={() => zoomTo(1)} style={{ minWidth: 48 }}>{Math.round(z * 100)}%</button>
        <button className="wc-btn is-wide" title="Zoom in (Ctrl +)" onClick={() => zoomTo(z * 1.25)}><Plus size={15} /></button>
        <button className="wc-btn" title="Fit everything (Shift+1)" onClick={() => fitAll()}><Maximize size={15} /></button>
      </div>
    </>
  )
}

const MinimapItems = memo(function MinimapItems({ items, stroke }: { items: Record<string, Item>; stroke: number }) {
  const list = Object.values(items).filter((i) => i.type !== 'comment' && i.type !== 'connector')
  // sample very large boards so the minimap stays cheap to draw
  const step = Math.max(1, Math.ceil(list.length / 1200))
  return (
    <>
      {list.filter((_, i) => i % step === 0).map((it) => (
        <rect key={it.id} x={it.x} y={it.y} width={it.w} height={it.h} fill={it.type === 'frame' ? 'none' : 'fill' in it && it.fill && it.fill !== 'transparent' ? it.fill : '#b9bbc2'} stroke={it.type === 'frame' ? '#8f939d' : 'none'} strokeWidth={stroke} />
      ))}
    </>
  )
})

function Minimap() {
  const items = useBoard((s) => s.items)
  const camera = useBoard((s) => s.camera)
  const viewport = useBoard((s) => s.viewport)
  const ref = useRef<HTMLDivElement>(null)
  const view = { x: -camera.x / camera.z, y: -camera.y / camera.z, w: viewport.w / camera.z, h: viewport.h / camera.z }
  // content bounds only change when items change, not on every camera frame
  const content = useMemo(() => unionBoxes(Object.values(items).filter((i) => i.type !== 'comment' && i.type !== 'connector').map((i) => aabb(i))), [items])
  const box = unionBoxes(content ? [content, view] : [view]) || view
  const pad = Math.max(box.w, box.h) * 0.05
  const vb = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 }
  const go = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    const k = Math.min(r.width / vb.w, r.height / vb.h)
    const ox = (r.width - vb.w * k) / 2, oy = (r.height - vb.h * k) / 2
    const wx = vb.x + (e.clientX - r.left - ox) / k, wy = vb.y + (e.clientY - r.top - oy) / k
    S().setCamera({ x: viewport.w / 2 - wx * camera.z, y: viewport.h / 2 - wy * camera.z, z: camera.z })
  }
  return (
    <div
      ref={ref} className="wc-ui wc-minimap wc-surface" role="img" aria-label="Minimap: drag to move around the board"
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); go(e) }}
      onPointerMove={(e) => { if (e.buttons) go(e) }}
    >
      <svg width="100%" height="100%" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet">
        <MinimapItems items={items} stroke={Math.round(vb.w / 200)} />
        <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="rgba(47,111,237,.12)" stroke="#2f6fed" strokeWidth={vb.w / 120} />
      </svg>
    </div>
  )
}

// ---------- context menu ----------

export function ContextMenu() {
  const ctx = useBoard((s) => s.ctxMenu)
  const selection = useBoard((s) => s.selection)
  const items = useBoard((s) => s.items)
  const viewport = useBoard((s) => s.viewport)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!ctx) { setPos(null); return }
    const r = ref.current?.getBoundingClientRect()
    setPos({ x: Math.max(8, Math.min(ctx.x, viewport.w - (r?.width || 220) - 8)), y: Math.max(8, Math.min(ctx.y, viewport.h - (r?.height || 300) - 8)) })
  }, [ctx, viewport])
  useEffect(() => {
    if (!ctx) return
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) useBoard.setState({ ctxMenu: null }) }
    window.addEventListener('pointerdown', down, true)
    return () => window.removeEventListener('pointerdown', down, true)
  }, [ctx])
  if (!ctx) return null
  const sel = selection.map((id) => items[id]).filter(Boolean)
  const editor = canEdit()
  const run = (fn: () => void) => () => { fn(); useBoard.setState({ ctxMenu: null }) }
  const locked = sel.length > 0 && sel.every((i) => i.locked)
  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      const { importText } = await import('../importers')
      if (text) { await importText(text, '', ctx.world); return }
    } catch { /* fall through to the in-memory clipboard */ }
    pasteItems(undefined, ctx.world)
  }
  return (
    <div ref={ref} role="menu" className="wc-ui wc-surface wc-menu wc-ctx" style={{ left: pos?.x ?? ctx.x, top: pos?.y ?? ctx.y, zIndex: 65, visibility: pos ? 'visible' : 'hidden' }}>
      {sel.length > 0 ? (
        <>
          {locked ? (
            editor && <button onClick={run(() => toggleLock())}>Unlock</button>
          ) : (
            <>
              <button onClick={run(() => copySelection())}>Copy<kbd>Ctrl C</kbd></button>
              {editor && <button onClick={run(() => copySelection(true))}>Cut<kbd>Ctrl X</kbd></button>}
              {editor && <button onClick={run(() => duplicateSelection())}>Duplicate<kbd>Ctrl D</kbd></button>}
              {editor && (
                <>
                  <div className="wc-sep is-h" />
                  <button onClick={run(() => reorder('front'))}>Bring to front<kbd>Ctrl ⇧ ]</kbd></button>
                  <button onClick={run(() => reorder('forward'))}>Bring forward<kbd>Ctrl ]</kbd></button>
                  <button onClick={run(() => reorder('backward'))}>Send backward<kbd>Ctrl [</kbd></button>
                  <button onClick={run(() => reorder('back'))}>Send to back<kbd>Ctrl ⇧ [</kbd></button>
                  <div className="wc-sep is-h" />
                  {sel.length > 1 && <button onClick={run(groupSelection)}>Group<kbd>Ctrl G</kbd></button>}
                  {sel.some((i) => i.group) && <button onClick={run(ungroupSelection)}>Ungroup<kbd>Ctrl ⇧ G</kbd></button>}
                  <button onClick={run(() => toggleLock())}>Lock<kbd>Ctrl ⇧ L</kbd></button>
                </>
              )}
              <button onClick={run(() => { exportImage('png', 'selection', 2).catch((e) => toast(e.message)) })}>Export selection as PNG</button>
              <button onClick={run(() => fitBox(unionBoxes(sel.map((i) => itemBox(i, items)))))}>Zoom to selection<kbd>⇧ 2</kbd></button>
              {editor && <><div className="wc-sep is-h" /><button className="is-danger" style={{ color: 'var(--danger)' }} onClick={run(deleteSelection)}>Delete<kbd>Del</kbd></button></>}
            </>
          )}
        </>
      ) : (
        <>
          {editor && <button onClick={run(paste)}>Paste here<kbd>Ctrl V</kbd></button>}
          {editor && <button onClick={run(() => { const it = make.sticky({ x: ctx.world.x - 100, y: ctx.world.y - 100, fill: S().stickyColor }); addItems([it]); useBoard.setState({ editingId: it.id }) })}>Add sticky note</button>}
          {canComment() && <button onClick={run(() => { const c = make.comment({ x: ctx.world.x, y: ctx.world.y }); addItems([c], { select: false }); useBoard.setState({ activeComment: c.id }) })}>Add comment</button>}
          <button onClick={run(selectAll)}>Select all<kbd>Ctrl A</kbd></button>
          <button onClick={run(() => fitAll())}>Fit to screen<kbd>⇧ 1</kbd></button>
        </>
      )}
    </div>
  )
}

// ---------- comment thread ----------

export function CommentThread() {
  const id = useBoard((s) => s.activeComment)
  const it = useBoard((s) => (id ? (s.items[id] as CommentItem | undefined) : undefined))
  const camera = useBoard((s) => s.camera)
  const viewport = useBoard((s) => s.viewport)
  const me = useBoard((s) => s.me)
  const [text, setText] = useState('')
  const narrow = useNarrow()
  const last = useRef<string | null>(null)

  // An empty thread that is closed without a message is discarded.
  useEffect(() => {
    const prev = last.current
    last.current = id
    if (prev && prev !== id) {
      const old = S().items[prev] as CommentItem | undefined
      // an abandoned empty thread disappears without leaving anything in undo history
      if (old && old.type === 'comment' && !old.thread.length) { mutate({ [prev]: null }); commit({ history: false }) }
    }
    setText('')
  }, [id])

  if (!id || !it || it.type !== 'comment') return null
  const p = toScreen(camera, it.x, it.y)
  // beside the pin, never on top of it
  const left = narrow ? 10 : p.x + 50 + 300 < viewport.w ? Math.max(10, p.x + 50) : Math.max(10, p.x - 320)
  const top = narrow ? undefined : Math.max(70, Math.min(viewport.h - 300, p.y - 40))
  const send = () => {
    const t = text.trim()
    if (!t || !canComment()) return
    apply({ [it.id]: { ...it, thread: [...it.thread, { id: uid(), by: me.id, name: me.name, text: t, at: Date.now() }], resolved: false } })
    setText('')
  }
  return (
    <div className="wc-ui wc-thread wc-surface" role="dialog" aria-label="Comment thread" style={narrow ? { left, right: 10, bottom: 'calc(76px + var(--sab))', width: 'auto' } : { left, top }}>
      <div className="wc-panel-head" style={{ padding: '8px 8px 8px 14px' }}>
        <span className="flex-1 text-sm">{it.thread.length ? 'Comment' : 'New comment'}</span>
        {it.thread.length > 0 && canComment() && (
          <button className="wc-icon-btn" title={it.resolved ? 'Reopen' : 'Resolve'} onClick={() => { apply({ [it.id]: { ...it, resolved: !it.resolved } }); if (!it.resolved) useBoard.setState({ activeComment: null }) }}>
            <Check size={16} color={it.resolved ? 'var(--ok)' : undefined} />
          </button>
        )}
        {(canEdit() || it.by === me.id) && <button className="wc-icon-btn" title="Delete thread" onClick={() => { apply({ [it.id]: null }); useBoard.setState({ activeComment: null }) }}><Trash2 size={15} /></button>}
        <button className="wc-icon-btn" title="Close" onClick={() => useBoard.setState({ activeComment: null })}><X size={16} /></button>
      </div>
      {it.thread.length > 0 && (
        <div className="overflow-y-auto px-3.5 py-2 flex flex-col gap-3">
          {it.thread.map((c) => (
            <div key={c.id}>
              <div className="text-xs"><b>{c.name}</b> <span style={{ color: 'var(--ink-3)' }}>{timeAgo(c.at)}</span></div>
              <div className="text-sm whitespace-pre-wrap break-words">{c.text}</div>
            </div>
          ))}
        </div>
      )}
      {canComment() && (
        <div className="wc-row p-2" style={{ borderTop: it.thread.length ? '1px solid var(--line)' : undefined }}>
          <textarea
            autoFocus className="wc-input" rows={1} maxLength={4000} aria-label={it.thread.length ? 'Reply' : 'Comment'} placeholder={it.thread.length ? 'Reply…' : 'Write a comment…'} value={text} style={{ resize: 'none', minHeight: 38 }}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } if (e.key === 'Escape') useBoard.setState({ activeComment: null }) }}
          />
          <button className="wc-btn is-accent" style={{ padding: 0 }} onClick={send} aria-label="Send"><Send size={16} /></button>
        </div>
      )}
    </div>
  )
}

// ---------- presentation ----------

export function Presenter() {
  const idx = useBoard((s) => s.presenting)
  const items = useBoard((s) => s.items)
  if (idx == null) return null
  const frames = orderedFrames(items)
  const go = (i: number) => {
    const n = Math.max(0, Math.min(frames.length - 1, i))
    useBoard.setState({ presenting: n })
    if (frames[n]) fitBox(aabb(frames[n]), 24, true, 8)
  }
  const f = frames[idx]
  const cam = S().camera
  const tl = f ? toScreen(cam, f.x, f.y) : null
  return (
    <>
    {/* everything outside the current frame is masked so only the slide shows */}
    {f && tl && <PresenterMask />}
    <div className="wc-ui wc-surface wc-row" role="toolbar" aria-label="Presentation" style={{ left: '50%', bottom: 'calc(14px + var(--sab))', transform: 'translateX(-50%)', padding: 4, zIndex: 50 }}>
      <button className="wc-btn" disabled={idx <= 0} onClick={() => go(idx - 1)} aria-label="Previous"><ChevronLeft size={18} /></button>
      <span className="px-2 text-sm whitespace-nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>{idx + 1} / {frames.length}<span className="wc-hide-narrow"> · {(frames[idx] as { title?: string })?.title}</span></span>
      <button className="wc-btn" disabled={idx >= frames.length - 1} onClick={() => go(idx + 1)} aria-label="Next"><ChevronRight size={18} /></button>
      <div className="wc-sep" />
      <button className="wc-btn" onClick={() => useBoard.setState({ presenting: null })}><X size={16} /> Exit</button>
    </div>
    </>
  )
}

function PresenterMask() {
  const camera = useBoard((s) => s.camera)
  const f = useBoard((s) => (s.presenting != null ? orderedFrames(s.items)[s.presenting] : null))
  if (!f) return null
  const p = toScreen(camera, f.x, f.y)
  return <div className="wc-present-mask" style={{ left: p.x, top: p.y, width: f.w * camera.z, height: f.h * camera.z }} />
}

export function Toast() {
  const t = useBoard((s) => s.toast)
  // the live region is always present so screen readers announce new messages
  return <div className="wc-ui wc-toast" role="status" aria-live="polite" style={t ? undefined : { visibility: 'hidden' }}>{t?.text}</div>
}

export function selectedItems(): Item[] {
  const s = S()
  return s.selection.map((id) => s.items[id]).filter(Boolean)
}
