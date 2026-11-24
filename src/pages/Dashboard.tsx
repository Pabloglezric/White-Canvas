import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Copy, HardDrive, LogIn, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Settings as Cog, Star, Trash2, Users } from 'lucide-react'
import { useAuth } from '../auth/Auth'
import { Pop } from '../board/ui/kit'
import {
  createBoard, deleteBoard, duplicateBoard, leaveBoard, listCloudBoards, listLocalBoards, renameBoard, starBoard, trashBoard,
  type BoardRow,
} from '../lib/boards'
import { hasSupabase } from '../lib/supabase'
import { initials, timeAgo } from '../lib/util'

export function Logo() {
  return (
    <span className="wc-logo">
      <i><svg width="18" height="18" viewBox="0 0 512 512"><rect x="60" y="80" width="392" height="352" rx="40" fill="#fbfaf7" /><path d="M130 330c52-120 88-120 124-36s68 68 124-98" fill="none" stroke="#ff5a36" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" /></svg></i>
      White Canvas
    </span>
  )
}

type Tab = 'all' | 'starred' | 'shared' | 'device' | 'trash'

export default function Dashboard() {
  const { me, loading } = useAuth()
  const nav = useNavigate()
  const [boards, setBoards] = useState<BoardRow[] | null>(null)
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      const local = await listLocalBoards()
      let cloud: BoardRow[] = []
      if (me.signedIn) {
        try { cloud = await listCloudBoards(me.id); localStorage.setItem('wc.boards.cache', JSON.stringify(cloud.map((b) => ({ ...b, thumbnail: null })))) }
        catch (e) {
          // offline: show the last list we saw so boards cached on this device stay reachable
          try { cloud = JSON.parse(localStorage.getItem('wc.boards.cache') || '[]') } catch { /* ignore */ }
          setErr(navigator.onLine ? (e as Error).message : 'You are offline — boards you have opened before still work.')
        }
      }
      setBoards([...cloud, ...local])
    } catch (e) { setErr((e as Error).message); setBoards([]) }
  }
  useEffect(() => { if (!loading) load() }, [loading, me.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (boards || []).filter((b) => {
      if (needle && !b.title.toLowerCase().includes(needle)) return false
      if (tab === 'trash') return !!b.trashed_at
      if (b.trashed_at) return false
      if (tab === 'starred') return b.starred
      if (tab === 'shared') return b.shared
      if (tab === 'device') return b.local
      return true
    })
  }, [boards, tab, q])

  const create = async (cloud: boolean) => {
    setBusy(true)
    try { nav(`/board/${await createBoard('Untitled board', cloud)}`) } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const act = (fn: () => Promise<unknown>) => async () => { try { await fn(); await load() } catch (e) { setErr((e as Error).message) } }
  const tabs: [Tab, string][] = [['all', 'All boards'], ['starred', 'Starred'], ['shared', 'Shared with me'], ['device', 'This device'], ['trash', 'Trash']]

  return (
    <div className="wc-page">
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <header className="wc-row flex-wrap" style={{ gap: 12, marginBottom: 22 }}>
          <Logo />
          <div className="flex-1" />
          {me.signedIn ? (
            <Link to="/settings" className="wc-btn is-line" title="Settings and agent access"><Cog size={16} /><span className="wc-avatar" style={{ background: me.color, width: 24, height: 24, margin: 0, border: 0 }}>{initials(me.name)}</span></Link>
          ) : (
            hasSupabase && <Link to="/login" className="wc-btn is-line"><LogIn size={16} /> Sign in to sync and share</Link>
          )}
        </header>

        <div className="wc-row flex-wrap" style={{ gap: 10, marginBottom: 14 }}>
          <h1 className="text-2xl font-semibold" style={{ letterSpacing: '-.02em' }}>Boards</h1>
          <div className="flex-1" />
          <div className="relative" style={{ width: 'min(260px, 100%)' }}>
            <Search size={15} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--ink-3)' }} />
            <input className="wc-input" style={{ paddingLeft: 32 }} placeholder="Search boards" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {me.signedIn ? (
            <Pop placement="bottom" button={(_o, t) => (
              <span className="wc-row" style={{ gap: 0 }}>
                <button className="wc-btn is-accent" style={{ height: 38, borderRadius: '10px 0 0 10px' }} disabled={busy} onClick={() => create(true)}><Plus size={17} /> New board</button>
                <button className="wc-btn is-accent" style={{ height: 38, minWidth: 30, padding: 0, borderRadius: '0 10px 10px 0', borderLeft: '1px solid rgba(255,255,255,.35)' }} onClick={t} aria-label="More ways to create">▾</button>
              </span>
            )}>
              {(close) => (
                <div className="wc-menu" style={{ padding: 0 }}>
                  <button onClick={() => { close(); create(true) }}><Plus size={16} /> Cloud board (synced, shareable)</button>
                  <button onClick={() => { close(); create(false) }}><HardDrive size={16} /> Device-only board</button>
                </div>
              )}
            </Pop>
          ) : (
            <button className="wc-btn is-accent" style={{ height: 38 }} disabled={busy} onClick={() => create(false)}><Plus size={17} /> New board</button>
          )}
        </div>

        <div className="wc-row" style={{ gap: 4, marginBottom: 16, overflowX: 'auto', scrollbarWidth: 'none' }}>
          {tabs.filter(([t]) => me.signedIn || t === 'all' || t === 'trash').map(([t, label]) => (
            <button key={t} className={`wc-btn ${tab === t ? 'is-on' : ''}`} style={{ height: 34, padding: '0 12px' }} onClick={() => setTab(t)}>{label}</button>
          ))}
        </div>

        {err && <p className="mb-3" style={{ color: 'var(--danger)' }}>{err}</p>}
        {!me.signedIn && !loading && (
          <p className="mb-4 wc-surface" style={{ padding: '10px 14px', boxShadow: 'none' }}>
            You are working without an account: boards are saved on this device only. {hasSupabase && <><Link className="underline" to="/login">Sign in</Link> to sync across devices, share boards and connect your coding agent.</>}
          </p>
        )}

        {boards === null ? <div className="wc-spin" /> : shown.length === 0 ? (
          <div className="wc-surface" style={{ padding: 36, textAlign: 'center', boxShadow: 'none' }}>
            <p className="text-lg font-medium mb-1">{tab === 'all' && !q ? 'Start with a blank board' : 'Nothing here'}</p>
            <p style={{ color: 'var(--ink-2)' }}>{tab === 'all' && !q ? 'Sketch, drop in drawings and PDFs, embed sites and 3D models.' : 'Try another tab or search.'}</p>
            {tab === 'all' && !q && <button className="wc-btn is-accent mt-4" style={{ height: 40 }} onClick={() => create(me.signedIn)}><Plus size={17} /> New board</button>}
          </div>
        ) : (
          <div className="wc-board-grid">
            {shown.map((b) => (
              <div key={b.id} className="wc-board-card" role="link" tabIndex={0} onClick={() => !b.trashed_at && nav(`/board/${b.id}`)} onKeyDown={(e) => { if (e.key === 'Enter' && !b.trashed_at) nav(`/board/${b.id}`) }}>
                <div className="wc-board-thumb" dangerouslySetInnerHTML={b.thumbnail?.startsWith('<svg') ? { __html: b.thumbnail } : undefined} />
                <div className="wc-row" style={{ padding: '9px 6px 9px 12px', gap: 4 }}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{b.title}</div>
                    <div className="wc-row text-xs" style={{ color: 'var(--ink-3)', gap: 5 }}>
                      {b.local ? <HardDrive size={11} /> : b.shared ? <Users size={11} /> : null}
                      <span className="truncate">{b.local ? 'This device · ' : b.shared ? 'Shared · ' : ''}{timeAgo(b.updated_at)}</span>
                    </div>
                  </div>
                  {!b.local && !b.trashed_at && (
                    <button className="wc-icon-btn" title={b.starred ? 'Unstar' : 'Star'} onClick={(e) => { e.stopPropagation(); act(() => starBoard(b, me.id, !b.starred))() }}>
                      <Star size={15} fill={b.starred ? '#f5b400' : 'none'} color={b.starred ? '#f5b400' : 'currentColor'} />
                    </button>
                  )}
                  <span onClick={(e) => e.stopPropagation()}>
                    <Pop placement="bottom" button={(_o, t) => <button className="wc-icon-btn" aria-label="Board actions" onClick={t}><MoreHorizontal size={16} /></button>}>
                      {(close) => (
                        <div className="wc-menu" style={{ padding: 0 }} onClick={close}>
                          {b.trashed_at ? (
                            <>
                              <button onClick={act(() => trashBoard(b, false))}><RotateCcw size={15} /> Restore</button>
                              <button style={{ color: 'var(--danger)' }} onClick={() => { if (confirm(`Delete "${b.title}" forever? This cannot be undone.`)) act(() => deleteBoard(b))() }}><Trash2 size={15} /> Delete forever</button>
                            </>
                          ) : b.shared ? (
                            <>
                              <button onClick={act(async () => nav(`/board/${await duplicateBoard(b, true)}`))}><Copy size={15} /> Make my own copy</button>
                              <button onClick={act(() => leaveBoard(b, me.id))}><Trash2 size={15} /> Leave board</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => { const t = prompt('Board name', b.title); if (t?.trim()) act(() => renameBoard(b, t.trim()))() }}><Pencil size={15} /> Rename</button>
                              <button onClick={act(() => duplicateBoard(b, !b.local))}><Copy size={15} /> Duplicate</button>
                              {b.local && me.signedIn && <button onClick={act(async () => nav(`/board/${await duplicateBoard(b, true)}`))}><Users size={15} /> Copy to cloud</button>}
                              <button onClick={act(() => trashBoard(b, true))}><Trash2 size={15} /> Move to trash</button>
                            </>
                          )}
                        </div>
                      )}
                    </Pop>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
