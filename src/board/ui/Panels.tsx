import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3, Box as BoxIcon, Check, Code2, Copy, CreditCard, FileUp, Frame, Globe, LayoutTemplate, Link2, Play, StickyNote,
  Table2, ThumbsUp,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { htmlToText, isMac, parseCsv, timeAgo } from '../../lib/util'
import { isLocalBoard } from '../assets'
import { STICKY_COLORS, make } from '../defaults'
import { exportCsv, exportImage, exportJson, exportPdf } from '../export'
import { aabb, itemBox, unionBoxes } from '../geometry'
import { addEmbed, addStickiesFromLines, importFiles, pickFiles } from '../importers'
import { addItems, cloneItems } from '../ops'
import { S, apply, canEdit, fitBox, orderedFrames, toast, useBoard, viewCenter, type PanelId, type Patch } from '../store'
import { listVersions, loadVersion, saveVersion, updateMeta, type Version } from '../sync'
import { TEMPLATES } from '../templates'
import type { CommentItem, Item } from '../types'
import { Modal, Panel } from './kit'

const close = () => useBoard.setState({ panel: null })

export function itemText(it: Item): string {
  switch (it.type) {
    case 'sticky': case 'text': case 'shape': return htmlToText(it.html)
    case 'card': return [it.title, it.desc, it.status, it.assignee, ...(it.tags || [])].filter(Boolean).join(' ')
    case 'table': return it.cells.map((r) => r.join(' ')).join(' ')
    case 'code': return it.code
    case 'frame': return it.title
    case 'embed': return [it.title, it.url].filter(Boolean).join(' ')
    case 'comment': return it.thread.map((t) => t.text).join(' ')
    case 'connector': return it.label || ''
    case 'file': case 'ifc': return it.name
    case 'image': return it.alt || ''
    case 'chart': return [it.title, ...it.labels].filter(Boolean).join(' ')
  }
  return ''
}

function goTo(it: Item, select = true) {
  const { items } = S()
  fitBox(itemBox(it, items), 160, true, 1.25)
  if (select && it.type !== 'comment') useBoard.setState({ selection: [it.id] })
  if (it.type === 'comment') useBoard.setState({ activeComment: it.id })
}

// ---------- insert ----------

function InsertPanel() {
  const [url, setUrl] = useState('')
  const [bulk, setBulk] = useState('')
  const [data, setData] = useState('')
  const stickyColor = useBoard((s) => s.stickyColor)
  const at = () => viewCenter()
  const done = () => { if (window.matchMedia('(max-width: 640px)').matches) close() }
  const tool = (t: 'card' | 'table' | 'code') => { S().setTool(t); close(); toast('Tap the board to place it') }
  const tile = (icon: React.ReactNode, label: string, sub: string, onClick: () => void) => (
    <button className="wc-list-item" onClick={onClick} style={{ alignItems: 'flex-start' }}>
      <span className="wc-file-icon" style={{ width: 36, height: 36, background: 'var(--surface-2)', color: 'var(--ink)' }}>{icon}</span>
      <span className="min-w-0"><span className="block font-medium">{label}</span><span className="block text-xs" style={{ color: 'var(--ink-3)' }}>{sub}</span></span>
    </button>
  )
  return (
    <Panel title="Insert" onClose={close}>
      <div className="flex flex-col gap-1">
        {tile(<FileUp size={18} />, 'Upload files', 'Images, PDF (pages become markup-ready images), CSV, IFC, any file', () => pickFiles('', (f) => { importFiles(f, at()); done() }))}
        {tile(<BoxIcon size={18} />, '3D model (IFC)', 'Orbit, section and inspect a BIM model on the board', () => pickFiles('.ifc', (f) => { importFiles(f, at()); done() }))}
        {tile(<Table2 size={18} />, 'Table', 'Or paste cells straight from a spreadsheet', () => tool('table'))}
        {tile(<CreditCard size={18} />, 'Card', 'Task with status, assignee and due date', () => tool('card'))}
        {tile(<Code2 size={18} />, 'Code block', 'Monospaced snippet', () => tool('code'))}
        {tile(<LayoutTemplate size={18} />, 'Templates', 'Kanban, flowchart, mind map, review sheet and more', () => useBoard.setState({ panel: 'templates' }))}
      </div>
      <div className="wc-label mt-4 mb-1.5">Embed a website or link</div>
      <form className="wc-row" onSubmit={(e) => { e.preventDefault(); if (url.trim()) { addEmbed(url, at()); setUrl(''); done() } }}>
        <input className="wc-input" placeholder="Paste a URL or <iframe> code" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button className="wc-btn is-accent" type="submit"><Globe size={15} /></button>
      </form>
      <p className="text-xs mt-1.5" style={{ color: 'var(--ink-3)' }}>YouTube, Figma, Google Docs, Speckle, Sketchfab and most sites embed live. Sites that refuse framing become a link preview instead of a blank box.</p>

      <div className="wc-label mt-4 mb-1.5">Sticky notes in bulk</div>
      <textarea className="wc-input" rows={3} placeholder="One note per line" value={bulk} onChange={(e) => setBulk(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <button className="wc-btn is-line mt-1.5" disabled={!bulk.trim()} onClick={() => { addStickiesFromLines(bulk, at(), stickyColor); setBulk(''); done() }}><StickyNote size={15} /> Add notes</button>

      <div className="wc-label mt-4 mb-1.5">Chart from data</div>
      <textarea className="wc-input" rows={3} placeholder={'Label, value per line\nQ1, 120\nQ2, 180'} value={data} onChange={(e) => setData(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <button
        className="wc-btn is-line mt-1.5" disabled={!data.trim()}
        onClick={() => {
          const rows = parseCsv(data).filter((r) => r.length >= 2 && Number.isFinite(parseFloat(r[1])))
          if (!rows.length) { toast('Use "label, number" on each line'); return }
          const c = at()
          addItems([make.chart({ x: c.x - 210, y: c.y - 140, labels: rows.map((r) => r[0].trim()), values: rows.map((r) => parseFloat(r[1])) })])
          setData(''); done()
        }}
      >
        <BarChart3 size={15} /> Add chart
      </button>
    </Panel>
  )
}

// ---------- templates ----------

function TemplatesPanel() {
  const insert = (id: string) => {
    const t = TEMPLATES.find((x) => x.id === id)
    if (!t) return
    const list = t.build()
    const box = unionBoxes(list.filter((i) => i.type !== 'connector').map((i) => aabb(i)))!
    // place to the right of existing content when the view is busy, else centre it
    const c = viewCenter()
    let dx = c.x - (box.x + box.w / 2)
    const dy = c.y - (box.y + box.h / 2)
    const { items } = S()
    const existing = Object.values(items).filter((i) => i.type !== 'connector').map((i) => aabb(i))
    const target = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }
    if (existing.some((b) => b.x < target.x + target.w && b.x + b.w > target.x && b.y < target.y + target.h && b.y + b.h > target.y)) {
      const all = unionBoxes(existing)!
      dx = all.x + all.w + 160 - box.x
    }
    const moved = cloneItems(list, dx, dy)
    addItems(moved.sort((a, b) => (a.type === 'frame' ? -1 : 0) - (b.type === 'frame' ? -1 : 0)))
    fitBox(unionBoxes(moved.filter((i) => i.type !== 'connector').map((i) => aabb(i))), 80)
    close()
  }
  return (
    <Panel title="Templates" onClose={close}>
      <div className="flex flex-col gap-1">
        {TEMPLATES.map((t) => (
          <button key={t.id} className="wc-list-item" onClick={() => insert(t.id)}>
            <span className="wc-file-icon" style={{ width: 36, height: 36, background: 'var(--surface-2)', color: 'var(--ink)' }}><LayoutTemplate size={17} /></span>
            <span><span className="block font-medium">{t.name}</span><span className="block text-xs" style={{ color: 'var(--ink-3)' }}>{t.desc}</span></span>
          </button>
        ))}
      </div>
    </Panel>
  )
}

// ---------- comments ----------

function CommentsPanel() {
  const items = useBoard((s) => s.items)
  const [showResolved, setShowResolved] = useState(false)
  const threads = (Object.values(items).filter((i) => i.type === 'comment' && i.thread.length) as CommentItem[])
    .filter((c) => showResolved || !c.resolved)
    .sort((a, b) => (b.thread[b.thread.length - 1]?.at || 0) - (a.thread[a.thread.length - 1]?.at || 0))
  return (
    <Panel title="Comments" onClose={close} actions={<label className="wc-row text-xs font-normal"><input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Resolved</label>}>
      {!threads.length && <p style={{ color: 'var(--ink-3)' }}>No comments yet. Pick the comment tool (C) and tap anywhere on the board.</p>}
      {threads.map((c) => (
        <button key={c.id} className="wc-list-item" style={{ alignItems: 'flex-start', opacity: c.resolved ? 0.6 : 1 }} onClick={() => goTo(c)}>
          <span className="min-w-0 flex-1">
            <span className="block text-xs"><b>{c.thread[0].name}</b> <span style={{ color: 'var(--ink-3)' }}>{timeAgo(c.thread[c.thread.length - 1].at)}{c.thread.length > 1 ? ` · ${c.thread.length - 1} repl${c.thread.length > 2 ? 'ies' : 'y'}` : ''}</span></span>
            <span className="block text-sm break-words">{c.thread[0].text}</span>
          </span>
          {c.resolved && <Check size={15} color="var(--ok)" />}
        </button>
      ))}
    </Panel>
  )
}

// ---------- frames ----------

function FramesPanel() {
  const items = useBoard((s) => s.items)
  const frames = orderedFrames(items)
  return (
    <Panel title="Frames" onClose={close}>
      {!frames.length && <p style={{ color: 'var(--ink-3)' }}>Frames group content, act as slides and export as pages. Press F and drag to add one.</p>}
      {frames.map((f, i) => (
        <div key={f.id} className="wc-row">
          <button className="wc-list-item" onClick={() => { fitBox(aabb(f), 60, true, 2); useBoard.setState({ selection: [f.id] }) }}>
            <Frame size={16} /> <span className="flex-1 truncate">{(f as { title: string }).title}</span>
            <span className="text-xs" style={{ color: 'var(--ink-3)' }}>{Object.values(items).filter((x) => x.parent === f.id).length}</span>
          </button>
          <button className="wc-icon-btn" title="Present from here" onClick={() => { useBoard.setState({ presenting: i, selection: [], panel: null }); fitBox(aabb(f), 24, true, 8) }}><Play size={15} /></button>
        </div>
      ))}
    </Panel>
  )
}

// ---------- search ----------

function SearchPanel() {
  const items = useBoard((s) => s.items)
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return []
    const out: { it: Item; text: string }[] = []
    for (const it of Object.values(items)) {
      const text = itemText(it)
      if (text && text.toLowerCase().includes(needle)) out.push({ it, text })
      if (out.length >= 80) break
    }
    return out
  }, [q, items])
  return (
    <Panel title="Search this board" onClose={close}>
      <input autoFocus className="wc-input" placeholder="Find text in notes, shapes, cards, tables, comments…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && results[0]) goTo(results[0].it); if (e.key === 'Escape') close() }} />
      <div className="mt-2">
        {q.trim() && !results.length && <p style={{ color: 'var(--ink-3)' }}>Nothing matches “{q}”.</p>}
        {results.map(({ it, text }) => {
          const i = text.toLowerCase().indexOf(q.trim().toLowerCase())
          const start = Math.max(0, i - 24)
          return (
            <button key={it.id} className="wc-list-item" onClick={() => goTo(it)}>
              <span className="wc-chip" style={{ flex: 'none' }}>{it.type}</span>
              <span className="truncate text-sm">{start > 0 ? '…' : ''}{text.slice(start, start + 90)}</span>
            </button>
          )
        })}
      </div>
    </Panel>
  )
}

// ---------- versions ----------

function VersionsPanel() {
  const boardId = useBoard((s) => s.boardId)!
  const [list, setList] = useState<Version[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const load = () => listVersions(boardId).then(setList).catch((e) => { toast(e.message); setList([]) })
  useEffect(() => { load() }, [boardId]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    setBusy(true)
    try { await saveVersion(boardId, name.trim() || `Version ${new Date().toLocaleString()}`); setName(''); await load(); toast('Version saved') } catch (e) { toast((e as Error).message) }
    setBusy(false)
  }
  const restore = async (v: Version) => {
    if (!canEdit()) return
    if (!confirm(`Restore "${v.name || 'version'}" from ${new Date(v.created_at).toLocaleString()}? You can undo this.`)) return
    try {
      const snap = await loadVersion(boardId, v.id)
      const patch: Patch = {}
      for (const id of Object.keys(S().items)) patch[id] = null
      for (const it of snap) patch[it.id] = it
      apply(patch)
      useBoard.setState({ selection: [] })
      toast('Version restored — press Ctrl+Z to undo')
    } catch (e) { toast((e as Error).message) }
  }
  return (
    <Panel title="Version history" onClose={close}>
      {canEdit() && (
        <div className="wc-row mb-3">
          <input className="wc-input" placeholder="Name this version (optional)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') save() }} />
          <button className="wc-btn is-accent" disabled={busy} onClick={save}>Save</button>
        </div>
      )}
      <p className="text-xs mb-2" style={{ color: 'var(--ink-3)' }}>Snapshots are also taken automatically while you work. History is free and unlimited in length.</p>
      {list === null && <div className="wc-spin" />}
      {list?.length === 0 && <p style={{ color: 'var(--ink-3)' }}>No versions yet.</p>}
      {list?.map((v) => (
        <div key={v.id} className="wc-row py-1.5" style={{ borderBottom: '1px solid var(--line)' }}>
          <div className="flex-1 min-w-0">
            <div className="truncate font-medium">{v.name || 'Version'}{v.auto && <span className="wc-chip ml-1.5">auto</span>}</div>
            <div className="text-xs" style={{ color: 'var(--ink-3)' }}>{new Date(v.created_at).toLocaleString()} · {v.item_count} items</div>
          </div>
          {canEdit() && <button className="wc-btn is-line" onClick={() => restore(v)}>Restore</button>}
        </div>
      ))}
    </Panel>
  )
}

// ---------- export ----------

function ExportPanel() {
  const hasSel = useBoard((s) => s.selection.length > 0)
  const frames = useBoard((s) => orderedFrames(s.items).length)
  const [scope, setScope] = useState<'all' | 'selection'>(hasSel ? 'selection' : 'all')
  const [scale, setScale] = useState(2)
  const [transparent, setTransparent] = useState(false)
  const run = (fn: () => Promise<void> | void) => async () => { try { toast('Preparing export…'); await fn() } catch (e) { toast((e as Error).message) } }
  return (
    <Panel title="Export" onClose={close}>
      <div className="wc-label mb-1.5">What</div>
      <div className="wc-row mb-3">
        <button className={`wc-btn is-line ${scope === 'all' ? 'is-on' : ''}`} onClick={() => setScope('all')}>Whole board</button>
        <button className={`wc-btn is-line ${scope === 'selection' ? 'is-on' : ''}`} disabled={!hasSel} onClick={() => setScope('selection')}>Selection</button>
      </div>
      <div className="wc-label mb-1.5">Image</div>
      <div className="wc-row mb-1.5 flex-wrap">
        {[1, 2, 4, 8].map((s) => <button key={s} className={`wc-btn is-line ${scale === s ? 'is-on' : ''}`} onClick={() => setScale(s)}>{s}×</button>)}
        <label className="wc-row text-xs"><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Transparent</label>
      </div>
      <div className="wc-row mb-3 flex-wrap">
        <button className="wc-btn is-accent" onClick={run(() => exportImage('png', scope, scale, transparent))}>PNG</button>
        <button className="wc-btn is-line" onClick={run(() => exportImage('svg', scope, 1, transparent))}>SVG (vector)</button>
      </div>
      <div className="wc-label mb-1.5">PDF (vector, via print dialog)</div>
      <div className="wc-row mb-3 flex-wrap">
        <button className="wc-btn is-line" disabled={!frames} onClick={run(() => exportPdf('frames'))}>One page per frame{frames ? ` (${frames})` : ''}</button>
        <button className="wc-btn is-line" onClick={run(() => exportPdf(scope))}>Single page</button>
      </div>
      <div className="wc-label mb-1.5">Data</div>
      <div className="wc-row flex-wrap">
        <button className="wc-btn is-line" onClick={run(exportCsv)}>CSV of notes and cards</button>
        <button className="wc-btn is-line" onClick={run(exportJson)}>Full backup (JSON)</button>
      </div>
      <p className="text-xs mt-3" style={{ color: 'var(--ink-3)' }}>No watermark and no resolution cap. Drop a backup file onto any board to restore it. Live embeds export as labelled placeholders.</p>
    </Panel>
  )
}

// ---------- share ----------

interface Member { user_id: string; role: string; via_link: boolean; profiles?: { display_name: string } | null }

function ShareDialog() {
  const meta = useBoard((s) => s.meta)
  const boardId = useBoard((s) => s.boardId)!
  const [members, setMembers] = useState<Member[]>([])
  const local = isLocalBoard(boardId)
  const url = `${location.origin}/board/${boardId}`
  const load = async () => {
    const { data } = await supabase.from('board_members').select('user_id,role,via_link').eq('board_id', boardId)
    const list = (data || []) as Member[]
    if (list.length) {
      const { data: profs } = await supabase.from('profiles').select('id,display_name').in('id', list.map((m) => m.user_id))
      for (const m of list) m.profiles = (profs || []).find((p) => p.id === m.user_id) || null
    }
    setMembers(list)
  }
  useEffect(() => { if (!local) load() }, [boardId]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!meta) return null
  return (
    <Modal title="Share board" onClose={close}>
      {local ? (
        <p>This board lives only on this device. Sign in and create a cloud board to share it — or use Export → Full backup and import that file into a cloud board.</p>
      ) : (
        <>
          <div className="wc-label mb-1.5">Anyone with the link</div>
          <select className="wc-input" value={meta.link_access} onChange={async (e) => { await updateMeta({ link_access: e.target.value as 'none' }); load() }}>
            <option value="none">No access — only people listed below</option>
            <option value="view">Can view</option>
            <option value="comment">Can comment</option>
            <option value="edit">Can edit</option>
          </select>
          <div className="wc-row mt-2">
            <input className="wc-input" readOnly value={url} onFocus={(e) => e.target.select()} />
            <button className="wc-btn is-accent" onClick={() => { navigator.clipboard?.writeText(url); toast('Link copied') }}><Copy size={15} /> Copy</button>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--ink-3)' }}>People open the link, sign in, and join with the role above. Guests never cost anything, and turning the link off removes everyone who joined through it.</p>
          <div className="wc-label mt-4 mb-1.5">People with access</div>
          {!members.length && <p style={{ color: 'var(--ink-3)' }}>Only you.</p>}
          {members.map((m) => (
            <div key={m.user_id} className="wc-row py-1">
              <span className="flex-1 truncate">{m.profiles?.display_name || 'Member'}{m.via_link && <span className="wc-chip ml-1.5"><Link2 size={10} /> link</span>}</span>
              <select className="wc-input" style={{ width: 130, height: 32 }} value={m.role} onChange={async (e) => { await supabase.from('board_members').update({ role: e.target.value, via_link: false }).eq('board_id', boardId).eq('user_id', m.user_id); load() }}>
                <option value="viewer">Viewer</option><option value="commenter">Commenter</option><option value="editor">Editor</option>
              </select>
              <button className="wc-btn is-danger" onClick={async () => { await supabase.from('board_members').delete().eq('board_id', boardId).eq('user_id', m.user_id); load() }}>Remove</button>
            </div>
          ))}
        </>
      )}
    </Modal>
  )
}

// ---------- timer + voting ----------

function FacilitatePanel() {
  const settings = useBoard((s) => s.meta?.settings)
  const items = useBoard((s) => s.items)
  const [mins, setMins] = useState(5)
  const [max, setMax] = useState(3)
  const voting = settings?.voting
  const ranked = Object.values(items).filter((i) => i.votes?.length).sort((a, b) => (b.votes?.length || 0) - (a.votes?.length || 0))
  const clearVotes = () => {
    const patch: Patch = {}
    for (const it of Object.values(S().items)) if (it.votes?.length) patch[it.id] = { ...it, votes: [] }
    if (Object.keys(patch).length) apply(patch)
  }
  return (
    <Panel title="Timer and voting" onClose={close}>
      <div className="wc-label mb-1.5">Timer</div>
      <div className="wc-row flex-wrap mb-1.5">
        {[1, 3, 5, 10, 15, 30].map((m) => <button key={m} className={`wc-btn is-line ${mins === m ? 'is-on' : ''}`} onClick={() => setMins(m)}>{m}m</button>)}
      </div>
      <div className="wc-row mb-4">
        <button className="wc-btn is-accent" onClick={() => updateMeta({ settings: { timer: { endsAt: Date.now() + mins * 60000, duration: mins * 60 } } })}>Start {mins} min for everyone</button>
        {settings?.timer?.endsAt && <button className="wc-btn is-line" onClick={() => updateMeta({ settings: { timer: null } })}>Stop</button>}
      </div>
      <div className="wc-label mb-1.5">Voting</div>
      {voting?.open ? (
        <>
          <p className="mb-2">Voting is open — everyone has {voting.max} votes. Click the thumb on notes, shapes, cards and images.</p>
          <button className="wc-btn is-accent" onClick={() => updateMeta({ settings: { voting: { ...voting, open: false } } })}>End voting</button>
        </>
      ) : (
        <div className="wc-row flex-wrap">
          <label className="wc-row">Votes each <input className="wc-input" type="number" min={1} max={20} value={max} style={{ width: 70 }} onChange={(e) => setMax(Math.max(1, +e.target.value || 1))} onKeyDown={(e) => e.stopPropagation()} /></label>
          <button className="wc-btn is-accent" onClick={() => { clearVotes(); updateMeta({ settings: { voting: { open: true, max } } }) }}>Start voting</button>
        </div>
      )}
      {ranked.length > 0 && (
        <>
          <div className="wc-row mt-4 mb-1"><span className="wc-label flex-1">Results</span><button className="wc-btn is-line" style={{ height: 28 }} onClick={clearVotes}>Clear votes</button></div>
          {ranked.map((it) => (
            <button key={it.id} className="wc-list-item" onClick={() => goTo(it)}>
              <span className="wc-chip" style={{ flex: 'none' }}><ThumbsUp size={11} /> {it.votes!.length}</span>
              <span className="truncate text-sm">{itemText(it) || it.type}</span>
            </button>
          ))}
        </>
      )}
    </Panel>
  )
}

// ---------- shortcuts ----------

function ShortcutsDialog() {
  const mod = isMac ? '⌘' : 'Ctrl'
  const rows: [string, string][] = [
    ['V / H', 'Select / pan'], ['N / T / S', 'Sticky note / text / shape'], ['R / O', 'Rectangle / ellipse'], ['L', 'Connector'],
    ['P / Shift+H / E', 'Pen / highlighter / eraser'], ['F / C / K', 'Frame / comment / card'], ['Space + drag', 'Pan'],
    [`${mod} + scroll`, 'Zoom'], [`${mod} 0 / Shift 1 / Shift 2`, '100% / fit board / fit selection'], [`${mod} Z / ${mod} Shift Z`, 'Undo / redo'],
    [`${mod} C / X / V / D`, 'Copy / cut / paste / duplicate'], ['Alt + drag', 'Duplicate while dragging'], [`${mod} A`, 'Select all'],
    [`${mod} G / ${mod} Shift G`, 'Group / ungroup'], [`${mod} Shift L`, 'Lock / unlock'], [`${mod} ] / [`, 'Bring forward / send backward'],
    ['Alt A D W S H V', 'Align left, right, top, bottom, centre'], ['Arrows (Shift = ×10)', 'Nudge selection'], ['Enter / Esc', 'Edit / stop editing'],
    ['Shift while drawing', 'Square shape, straight move, 15° rotation'], [`${mod} F`, 'Search the board'], ['Double-click canvas', 'Add text'],
  ]
  const touch: [string, string][] = [
    ['One finger on empty space', 'Pan'], ['Two fingers', 'Pan and pinch-zoom'], ['Tap an item', 'Select'], ['Tap it again', 'Edit or interact'],
    ['Drag an item', 'Move'], ['Long-press empty space', 'Start a selection box'], ['Long-press an item', 'Context menu'],
    ['Pen tool', 'Finger or stylus draws; with a stylus, fingers pan'],
  ]
  return (
    <Modal title="Shortcuts and gestures" onClose={close} wide>
      <div className="grid gap-x-8 gap-y-1" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        <div>
          <div className="wc-label mb-1.5">Keyboard</div>
          {rows.map(([k, v]) => <div key={k} className="wc-row py-1 text-sm" style={{ borderBottom: '1px solid var(--line)' }}><span className="flex-1">{v}</span><kbd className="text-xs" style={{ color: 'var(--ink-2)' }}>{k}</kbd></div>)}
        </div>
        <div>
          <div className="wc-label mb-1.5">Touch</div>
          {touch.map(([k, v]) => <div key={k} className="wc-row py-1 text-sm" style={{ borderBottom: '1px solid var(--line)' }}><span className="flex-1">{k}</span><span className="text-xs text-right" style={{ color: 'var(--ink-2)' }}>{v}</span></div>)}
        </div>
      </div>
    </Modal>
  )
}

export function Panels() {
  const panel = useBoard((s) => s.panel) as PanelId
  switch (panel) {
    case 'insert': return <InsertPanel />
    case 'templates': return <TemplatesPanel />
    case 'comments': return <CommentsPanel />
    case 'frames': return <FramesPanel />
    case 'search': return <SearchPanel />
    case 'versions': return <VersionsPanel />
    case 'export': return <ExportPanel />
    case 'share': return <ShareDialog />
    case 'facilitate': return <FacilitatePanel />
    case 'shortcuts': return <ShortcutsDialog />
  }
  return null
}
