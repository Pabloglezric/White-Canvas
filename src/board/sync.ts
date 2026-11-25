// Loading, saving and realtime collaboration.
// Cloud boards: Supabase rows + Realtime (broadcast for speed, Postgres changes for agent/API writes),
// with an IndexedDB cache and outbox so edits survive flaky or missing connectivity.
// Local boards ("local-…"): IndexedDB only.
import type { RealtimeChannel } from '@supabase/supabase-js'
import { del, get, keys, set } from 'idb-keyval'
import { supabase } from '../lib/supabase'
import { debounce, throttle } from '../lib/util'
import { forgetAssets, isLocalBoard, releaseAssets } from './assets'
import { boardPreview, isOldPreview } from './export'
import { bus } from './interaction'
import { finishEditing } from './items/RichText'
import { adoptForeignFiles } from './ops'
import { S, adoptRev, applyRemote, fitAll, fitBox, hooks, isPending, replaceItem, resetBoard, toast, useBoard } from './store'
import type { BoardMeta, BoardSettings, Camera, Item, Peer, Pt, Role } from './types'
import { normalizeItem, normalizeItems } from './validate'

interface Row { id: string; board_id: string; data: Item; rev: number; deleted: boolean; client_id: string; updated_at?: string }

const LOCAL_LIST = 'wc.local.boards'
// Offline copies are kept per account, so two people sharing a device never see each other's boards.
const cacheKey = (user: string, id: string) => `wc.cache.${user}.${id}`
const outboxKey = (user: string, id: string) => `wc.outbox.${user}.${id}`
const localItemsKey = (id: string) => `wc.local.items.${id}`
const camKey = (id: string) => `wc.cam.${id}`
const roleKey = (id: string) => `wc.role.${id}`

export async function localBoards(): Promise<BoardMeta[]> { return ((await get(LOCAL_LIST)) as BoardMeta[] | undefined) || [] }
export async function saveLocalBoards(list: BoardMeta[]) { await set(LOCAL_LIST, list) }
export async function localItems(id: string): Promise<Item[]> { return normalizeItems(await get(localItemsKey(id))) }
export async function saveLocalItems(id: string, items: Item[]) { await set(localItemsKey(id), items) }
export async function deleteLocalBoard(id: string) {
  await saveLocalBoards((await localBoards()).filter((b) => b.id !== id))
  await del(localItemsKey(id))
}

/** Removes everything this account cached on the device (called on sign-out). Device-only boards are kept. */
export async function purgeAccountData(userId: string) {
  try {
    for (const k of await keys()) {
      if (typeof k === 'string' && (k.startsWith(`wc.cache.${userId}.`) || k.startsWith(`wc.outbox.${userId}.`) || /^wc\.(cache|outbox)\.[0-9a-f-]{36}$/.test(k))) await del(k)
    }
  } catch { /* storage unavailable */ }
  try {
    for (const k of Object.keys(localStorage)) if (k === 'wc.boards.cache' || k.startsWith('wc.role.')) localStorage.removeItem(k)
  } catch { /* ignore */ }
  forgetAssets()
}

function restoreCamera(id: string) {
  try {
    const c = JSON.parse(localStorage.getItem(camKey(id)) || 'null') as Camera | null
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.z)) { S().setCamera(c); return true }
  } catch { /* ignore */ }
  return false
}

async function fetchAllItems(boardId: string): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('board_items').select('id,board_id,data,rev,deleted,client_id,updated_at')
      .eq('board_id', boardId).eq('deleted', false).order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data || []) as Row[]))
    if (!data || data.length < 1000) break
  }
  return out
}

const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 200))

let active: { id: string; close: () => void; flush: () => Promise<void> } | null = null
export const flushNow = () => active?.flush() ?? Promise.resolve()

export async function updateMeta(patch: Partial<Pick<BoardMeta, 'title' | 'link_access' | 'thumbnail'>> & { settings?: BoardSettings }) {
  const s = S()
  if (!s.meta || !s.boardId) return
  const meta = { ...s.meta, ...patch, settings: patch.settings ? { ...s.meta.settings, ...patch.settings } : s.meta.settings } as BoardMeta
  useBoard.setState({ meta })
  if (isLocalBoard(s.boardId)) {
    const list = await localBoards()
    await saveLocalBoards(list.map((b) => (b.id === meta.id ? { ...meta, updated_at: new Date().toISOString() } : b)))
    return
  }
  const body: Record<string, unknown> = { ...patch }
  if (patch.settings) body.settings = meta.settings
  const { error } = await supabase.from('boards').update(body).eq('id', s.boardId)
  if (error) toast('Could not save that change. Check your connection and try again.')
}

const channels: { presence?: RealtimeChannel; ops?: RealtimeChannel; db?: RealtimeChannel } = {}
/** Editors only: asks everyone on the board to look at a given area. */
export function summon(name: string, box: { x: number; y: number; w: number; h: number }) {
  channels.ops?.send({ type: 'broadcast', event: 'summon', payload: { c: S().clientId, name, box } })
}

// Fields that are large and change rarely: they travel on commit, not in every in-flight packet.
const HEAVY = new Set(['pts', 'preview', 'thread'])

export async function openBoard(boardId: string, me: { id: string; name: string; color: string }): Promise<void> {
  active?.close()
  active = null
  resetBoard({ boardId, status: 'loading', me, meta: null, role: 'viewer', syncState: isLocalBoard(boardId) ? 'local' : 'synced' })
  const stale = () => S().boardId !== boardId
  const toMap = (list: Item[]) => { const m: Record<string, Item> = {}; for (const i of list) m[i.id] = i; return m }
  const ready = (items: Record<string, Item>) => {
    useBoard.setState({ items, status: 'ready' })
    if (!restoreCamera(boardId)) fitAll(false)
  }
  const saveCam = debounce(() => { try { localStorage.setItem(camKey(boardId), JSON.stringify(S().camera)) } catch { /* ignore */ } }, 500)
  const unsubCam = useBoard.subscribe((s, p) => { if (s.camera !== p.camera) saveCam() })
  const unsubTitle = useBoard.subscribe((s, p) => { if (s.meta?.title !== p.meta?.title) document.title = s.meta?.title ? `${s.meta.title} · White Canvas` : 'White Canvas' })
  const cleanupBase = () => { unsubCam(); unsubTitle(); document.title = 'White Canvas'; releaseAssets() }

  // ---------- local-only board ----------
  if (isLocalBoard(boardId)) {
    const list = await localBoards()
    const meta = list.find((b) => b.id === boardId)
    if (stale()) { cleanupBase(); return }
    if (!meta) { useBoard.setState({ status: 'denied' }); cleanupBase(); return }
    useBoard.setState({ meta, role: 'owner' })
    ready(toMap(await localItems(boardId)))
    const writeItems = () => { if (S().boardId === boardId) saveLocalItems(boardId, Object.values(S().items)).catch(() => {}) }
    // changes to this board's entry in the list happen one after another, so none overwrites another
    let listWrite: Promise<unknown> = Promise.resolve()
    const editEntry = (change: (b: BoardMeta) => BoardMeta) => (listWrite = listWrite.then(async () => saveLocalBoards((await localBoards()).map((b) => (b.id === boardId ? change(b) : b)))).catch(() => {}))
    const writeMeta = () => idle(() => {
      const s = S()
      if (s.boardId !== boardId) return
      editEntry((b) => ({ ...b, title: s.meta?.title || b.title, settings: s.meta?.settings || b.settings, updated_at: new Date().toISOString() }))
    })
    // The dashboard picture of the board. Drawing it costs more than saving, so it follows edits at a slower pace.
    let previewDue = isOldPreview(meta.thumbnail)
    const writePreview = async (items: Record<string, Item>) => {
      previewDue = false
      const thumbnail = Object.keys(items).length ? await boardPreview(items) : null
      await editEntry((b) => ({ ...b, thumbnail }))
      window.dispatchEvent(new Event('wc-boards-changed'))
    }
    const savePreview = debounce(() => idle(() => { if (S().boardId === boardId) writePreview(S().items).catch(() => {}) }), 2500)
    if (previewDue) savePreview()
    const save = debounce(() => { writeItems(); writeMeta(); previewDue = true; savePreview() }, 400)
    // text being typed is saved too, so closing the tab mid-sentence loses nothing
    const saveLive = debounce(writeItems, 900)
    const persistNow = () => { finishEditing(); save.cancel(); saveLive.cancel(); writeItems() }
    const onHide = () => { if (document.visibilityState === 'hidden') persistNow() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', persistNow)
    hooks.onCommit = () => save()
    hooks.onLive = () => saveLive()
    bus.cursor = undefined
    active = {
      id: boardId,
      flush: async () => { save.cancel(); writeItems() },
      close: () => {
        finishEditing()
        save.cancel(); saveLive.cancel(); writeItems(); writeMeta()
        // leaving with edits not yet pictured: draw the preview now, from the board as it is being left
        savePreview.cancel()
        if (previewDue) writePreview(S().items).catch(() => {})
        document.removeEventListener('visibilitychange', onHide)
        window.removeEventListener('pagehide', persistNow)
        hooks.onCommit = undefined; hooks.onLive = undefined
        cleanupBase()
      },
    }
    return
  }

  // ---------- cloud board ----------
  const CACHE = cacheKey(me.id, boardId), OUTBOX = outboxKey(me.id, boardId)
  const cachedRaw = (await get(CACHE)) as unknown
  if (stale()) { cleanupBase(); return }
  const cached = normalizeItems(cachedRaw)
  if (cached.length) ready(toMap(cached))

  let meta: BoardMeta | null = null
  let role: Role | null = null
  let unreachable = false
  /** The board and our role on it, straight from the server. Throws when the server cannot be reached. */
  const loadAccess = async () => {
    let res = await supabase.from('boards').select('*').eq('id', boardId).maybeSingle()
    if (!res.data && !res.error) {
      const joined = await supabase.rpc('join_board', { b: boardId })
      if (joined.error) throw new Error(joined.error.message)
      if (joined.data) res = await supabase.from('boards').select('*').eq('id', boardId).maybeSingle()
    }
    if (res.error) throw new Error(res.error.message)
    meta = res.data as BoardMeta | null
    role = null
    if (meta) {
      const r = await supabase.rpc('board_role', { b: boardId })
      if (r.error) throw new Error(r.error.message)
      role = (r.data as Role | null) || null
    }
  }
  const showAccess = () => {
    if (!meta) return
    useBoard.setState({ meta: { ...meta, settings: meta.settings || {} }, role: role || 'viewer' })
    document.title = `${meta.title} · White Canvas`
    try { localStorage.setItem(roleKey(boardId), role || 'viewer') } catch { /* ignore */ }
  }
  try {
    await loadAccess()
  } catch {
    if (stale()) { cleanupBase(); return }
    unreachable = true
    if (cached.length) {
      // No connection: keep working on the saved copy with the role we last had here.
      let lastRole: Role = 'viewer'
      try { lastRole = (localStorage.getItem(roleKey(boardId)) as Role) || 'viewer' } catch { /* ignore */ }
      useBoard.setState({ syncState: 'offline', role: lastRole })
      toast('Offline — showing the last saved copy')
    } else { useBoard.setState({ status: 'error' }); cleanupBase(); return }
  }
  if (stale()) { cleanupBase(); return }
  const lockOut = () => {
    // The server answered and we have no access (deleted, or sharing was turned off): drop any local copy.
    del(CACHE).catch(() => {}); del(OUTBOX).catch(() => {})
    try { localStorage.removeItem(roleKey(boardId)) } catch { /* ignore */ }
    useBoard.setState({ status: 'denied', items: {}, selection: [], editingId: null })
  }
  if (!unreachable && (!meta || !role)) { lockOut(); cleanupBase(); return }
  showAccess()

  // The newest server change seen so far; catching up later asks only for what changed after it.
  let since = 0
  const seen = (rows: Row[]) => { for (const r of rows) { const t = r.updated_at ? Date.parse(r.updated_at) : 0; if (t > since) since = t } }

  // outbox: edits that never reached the server
  const dirty = new Map<string, Row>()
  const outboxRaw = ((await get(OUTBOX)) as Row[] | undefined) || []
  const outbox: Row[] = []
  for (const o of Array.isArray(outboxRaw) ? outboxRaw : []) {
    const data = o && normalizeItem(o.data)
    if (data) outbox.push({ id: data.id, board_id: boardId, data, rev: data.rev, deleted: !!o.deleted, client_id: S().clientId })
  }

  if (meta) {
    try {
      const rows = await fetchAllItems(boardId)
      if (stale()) { cleanupBase(); return }
      const items: Record<string, Item> = {}
      const serverRev = new Map<string, number>()
      seen(rows)
      for (const r of rows) {
        serverRev.set(r.id, r.rev)
        const it = normalizeItem({ ...r.data, id: r.id, rev: r.rev })
        if (it) items[r.id] = it
      }
      for (const o of outbox) {
        if ((serverRev.get(o.id) || 0) > o.rev) continue // the server moved on while we were away
        dirty.set(o.id, o)
        if (o.deleted) delete items[o.id]
        else items[o.id] = o.data
      }
      const hadView = cached.length > 0
      useBoard.setState({ items, status: 'ready' })
      if (!hadView && !restoreCamera(boardId)) fitAll(false)
    } catch {
      if (!cached.length) { useBoard.setState({ status: 'error' }); cleanupBase(); return }
      useBoard.setState({ syncState: 'offline' })
    }
  }

  // ---------- persistence ----------
  const saveOutbox = debounce(() => { set(OUTBOX, [...dirty.values()]).catch(() => {}) }, 250)
  const saveCache = debounce(() => idle(() => { if (S().boardId === boardId) set(CACHE, Object.values(S().items)).catch(() => {}) }), 1500)
  let flushing = false
  let retry: ReturnType<typeof setTimeout> | undefined
  // Errors that will never succeed on retry: no permission, or data the server refuses.
  const permanent = (code?: string) => !!code && /^(42501|23\d{3}|22\d{3}|P0001)$/.test(code)

  /** A change the server refused is undone locally (using the server's copy) instead of blocking every later save. */
  const reject = async (row: Row) => {
    dirty.delete(row.id)
    const { data } = await supabase.from('board_items').select('id,data,rev,deleted').eq('id', row.id).maybeSingle()
    const server = data && !data.deleted ? normalizeItem({ ...(data.data as Item), id: data.id, rev: data.rev }) : null
    replaceItem(row.id, server)
  }

  const flush = async () => {
    if (flushing || !dirty.size) return
    if (!navigator.onLine) { useBoard.setState({ syncState: 'offline' }); return }
    flushing = true
    useBoard.setState({ syncState: 'saving' })
    let refused = 0
    try {
      while (dirty.size) {
        const batch = [...dirty.values()].slice(0, 150)
        const { error } = await supabase.from('board_items').upsert(batch, { onConflict: 'id' })
        if (error) {
          if (!permanent(error.code)) throw new Error(error.message)
          // find the rows at fault one by one; the rest still save
          for (const row of batch) {
            const one = await supabase.from('board_items').upsert(row, { onConflict: 'id' })
            if (!one.error) { if (dirty.get(row.id)?.rev === row.rev) dirty.delete(row.id) }
            else if (permanent(one.error.code)) { refused++; await reject(row) }
            else throw new Error(one.error.message)
          }
          continue
        }
        for (const r of batch) if (dirty.get(r.id)?.rev === r.rev) dirty.delete(r.id)
      }
      saveOutbox()
      useBoard.setState({ syncState: 'synced' })
      if (refused) toast(refused === 1 ? 'One change could not be saved and was undone' : `${refused} changes could not be saved and were undone`)
    } catch {
      useBoard.setState({ syncState: 'offline' })
      clearTimeout(retry)
      retry = setTimeout(flush, 5000)
    } finally {
      flushing = false
    }
  }
  const flushSoon = debounce(flush, 450)
  // filled in once the live connection is set up further down
  let catchUp: (force?: boolean) => void = () => {}
  const onOnline = () => { flush(); catchUp(true); void adoptForeignFiles({ quiet: true }) }
  const leave = () => { finishEditing(); flushSoon.flush(); saveOutbox.flush(); set(CACHE, Object.values(S().items)).catch(() => {}) }
  const onHide = () => { if (document.visibilityState === 'hidden') leave(); else { checkAccess(); catchUp() } }
  window.addEventListener('online', onOnline)
  window.addEventListener('pagehide', leave)
  document.addEventListener('visibilitychange', onHide)

  // The dashboard picture of the board: redrawn a little after edits, and when leaving with edits not yet pictured.
  const mayEdit = () => S().role === 'owner' || S().role === 'editor'
  let previewDue = false
  let lastPreview = S().meta?.thumbnail || ''
  const writePreview = async (items: Record<string, Item>) => {
    previewDue = false
    const thumbnail = Object.keys(items).length ? await boardPreview(items) : ''
    if (thumbnail === lastPreview) return
    lastPreview = thumbnail
    await supabase.from('boards').update({ thumbnail: thumbnail || null }).eq('id', boardId)
  }
  const saveThumb = debounce(() => idle(() => { if (S().boardId === boardId && mayEdit()) writePreview(S().items).catch(() => {}) }), 8000)

  // ----- live updates: only what changed since the last packet -----
  const liveIds = new Set<string>()
  const lastSent = new Map<string, Item>()
  const sendLive = throttle(() => {
    const { items } = S()
    const patches: Record<string, unknown>[] = []
    for (const id of liveIds) {
      const it = items[id] as (Item & Record<string, unknown>) | undefined
      if (!it) continue
      const prev = lastSent.get(id) as (Item & Record<string, unknown>) | undefined
      const patch: Record<string, unknown> = { id, rev: it.rev }
      if (!prev) patch.full = it
      else for (const k in it) if (it[k] !== prev[k] && !HEAVY.has(k)) patch[k] = it[k]
      lastSent.set(id, it)
      if (Object.keys(patch).length > 2) patches.push(patch)
    }
    liveIds.clear()
    if (patches.length && patches.length <= 80) channels.ops?.send({ type: 'broadcast', event: 'live', payload: { c: S().clientId, patches } })
  }, 60)

  // Text being typed is checkpointed to the server after a pause, without touching local undo history.
  const checkpoint = debounce(() => {
    const s = S()
    if (s.boardId !== boardId || !s.editingId) return
    const it = s.items[s.editingId]
    if (!it || !isPending(it.id) || (s.role !== 'owner' && s.role !== 'editor')) return
    dirty.set(it.id, { id: it.id, board_id: boardId, data: it, rev: (it.rev || 0) + 1, deleted: false, client_id: s.clientId })
    saveOutbox(); flushSoon()
  }, 2500)

  hooks.onLive = (changed) => { for (const it of changed) liveIds.add(it.id); sendLive(); checkpoint() }
  hooks.onCommit = (changed, removed) => {
    const clientId = S().clientId
    for (const it of changed) { dirty.set(it.id, { id: it.id, board_id: boardId, data: it, rev: it.rev, deleted: false, client_id: clientId }); lastSent.set(it.id, it) }
    for (const it of removed) { dirty.set(it.id, { id: it.id, board_id: boardId, data: it, rev: it.rev, deleted: true, client_id: clientId }); lastSent.delete(it.id) }
    // big payloads (long ink strokes, model previews) reach peers through the database stream instead
    const light = changed.length <= 80 ? changed.filter((it) => !('pts' in it && it.pts.length > 1500) && !('preview' in it && it.preview)) : []
    channels.ops?.send({ type: 'broadcast', event: 'commit', payload: { c: clientId, items: light, removed: removed.map((r) => ({ id: r.id, rev: r.rev })) } })
    useBoard.setState({ syncState: navigator.onLine ? 'saving' : 'offline' })
    previewDue = true
    saveOutbox(); saveCache(); flushSoon(); saveThumb()
  }
  if (dirty.size) flush()
  saveCache()
  // a preview from an older version (plain boxes), or none at all: draw a real one
  if (S().meta && mayEdit() && isOldPreview(S().meta?.thumbnail) && Object.keys(S().items).length) { previewDue = true; saveThumb() }
  // files that items brought in from another board and that have not been copied here yet (a paste made offline,
  // a copy that failed, a board left before the copy landed)
  void adoptForeignFiles({ quiet: true })

  // ---------- realtime ----------
  const myClient = S().clientId
  const peers = () => S().peers
  const setPeer = (id: string, patch: Partial<Peer>) => {
    const cur = peers()[id]
    if (!cur && !patch.name) return
    const base: Peer = cur || { id, user: '', name: 'Guest', color: '#888', seen: Date.now() }
    useBoard.setState({ peers: { ...peers(), [id]: { ...base, ...patch } } })
  }
  const dropPeer = (id: string) => {
    if (!peers()[id]) return
    const next = { ...peers() }
    delete next[id]
    useBoard.setState({ peers: next, following: S().following === id ? null : S().following })
  }
  const safeName = (v: unknown) => (typeof v === 'string' ? v.slice(0, 60) : 'Guest')
  const safeHex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '#888888')
  const finiteCam = (c: unknown): Peer['cam'] | undefined => {
    const v = c as Record<string, unknown> | undefined
    return v && ['x', 'y', 'z', 'vw', 'vh'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k])) && (v.z as number) > 0 && (v.vw as number) > 0 && (v.vh as number) > 0 ? (v as unknown as Peer['cam']) : undefined
  }
  const finiteBox = (b: unknown) => {
    const v = b as Record<string, unknown> | undefined
    return v && ['x', 'y', 'w', 'h'].every((k) => typeof v[k] === 'number' && Number.isFinite(v[k])) ? (v as unknown as { x: number; y: number; w: number; h: number }) : null
  }
  try { await supabase.realtime.setAuth() } catch { /* not signed in */ }
  if (stale()) { cleanupBase(); return }

  const presence = supabase.channel(`board:${boardId}`, { config: { private: true, presence: { key: myClient }, broadcast: { self: false } } })
  presence
    .on('presence', { event: 'sync' }, () => {
      const state = presence.presenceState() as Record<string, { user: string; name: string; color: string }[]>
      const next: Record<string, Peer> = {}
      const now = Date.now()
      // keep peers we heard from recently even if a presence update was missed
      for (const key in peers()) if (now - peers()[key].seen < 30000) next[key] = peers()[key]
      for (const key in state) {
        if (key === myClient) continue
        const p = state[key][0]
        next[key] = { ...(peers()[key] || { id: key, seen: now }), id: key, user: String(p.user || ''), name: safeName(p.name), color: safeHex(p.color) } as Peer
      }
      const following = S().following
      useBoard.setState({ peers: next, following: following && next[following] ? following : null })
    })
    .on('broadcast', { event: 'cursor' }, ({ payload }) => {
      const p = payload as { c: string; n?: string; col?: string; u?: string; x?: number; y?: number; off?: unknown; sel?: string[]; cam?: unknown }
      if (typeof p?.c !== 'string' || p.c === myClient) return
      const known = !!peers()[p.c]
      const patch: Partial<Peer> = { seen: Date.now() }
      if (Array.isArray(p.sel)) patch.sel = p.sel.filter((x) => typeof x === 'string').slice(0, 30)
      if (p.n) { patch.name = safeName(p.n); patch.color = safeHex(p.col); patch.user = String(p.u || '') }
      if (typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y)) patch.cursor = { x: p.x, y: p.y }
      else if (p.off) patch.cursor = null // their pointer left the board, or their app went to the background
      const cam = finiteCam(p.cam)
      if (cam) patch.cam = cam
      setPeer(p.c, patch)
      if (!known && p.n) hello()
      if (S().following === p.c && cam) fitBox({ x: -cam.x / cam.z, y: -cam.y / cam.z, w: cam.vw / cam.z, h: cam.vh / cam.z }, 0, false, 8)
    })
    .on('broadcast', { event: 'bye' }, ({ payload }) => dropPeer(String((payload as { c: unknown }).c)))
    // a device whose connection has gone is removed at once, with its cursor, instead of lingering as a ghost
    .on('presence', { event: 'leave' }, ({ key }) => { if (!(presence.presenceState()[key] || []).length) dropPeer(key) })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') { presence.track({ user: me.id, name: me.name, color: me.color }); hello() }
    })
  channels.presence = presence

  const ops = supabase.channel(`ops:${boardId}`, { config: { private: true, broadcast: { self: false } } })
  ops
    .on('broadcast', { event: 'live' }, ({ payload }) => {
      const list = (payload as { patches?: Record<string, unknown>[] }).patches
      if (!Array.isArray(list)) return
      const { items } = S()
      const out: unknown[] = []
      for (const p of list.slice(0, 80)) {
        if (!p || typeof p.id !== 'string') continue
        if (p.full) out.push(p.full)
        else if (items[p.id]) out.push({ ...items[p.id], ...p })
      }
      applyRemote(out as Item[], [])
    })
    .on('broadcast', { event: 'commit' }, ({ payload }) => {
      const p = payload as { items?: Item[]; removed?: { id: string; rev: number }[] }
      applyRemote(Array.isArray(p.items) ? p.items.slice(0, 200) : [], Array.isArray(p.removed) ? p.removed.filter((r) => r && typeof r.id === 'string' && typeof r.rev === 'number').slice(0, 5000) : [])
    })
    .on('broadcast', { event: 'summon' }, ({ payload }) => {
      const p = payload as { name?: unknown; box?: unknown }
      const box = finiteBox(p.box)
      if (!box) return
      fitBox(box, 0, true, 8)
      toast(`${safeName(p.name)} brought everyone to their view`)
    })
    .subscribe()
  channels.ops = ops

  // Database changes (from the agent API and from other clients) are merged once per frame, not once per row.
  let inbox: Row[] = []
  let inboxRaf = 0
  const drain = () => {
    inboxRaf = 0
    const rows = inbox
    inbox = []
    const ups: Item[] = [], gone: { id: string; rev: number }[] = []
    for (const r of rows) {
      if (r.client_id === myClient) { if (!r.deleted) adoptRev(r.id, r.rev); continue }
      if (r.deleted) gone.push({ id: r.id, rev: r.rev })
      else ups.push({ ...r.data, id: r.id, rev: r.rev } as Item)
    }
    if (ups.length || gone.length) { applyRemote(ups, gone); saveCache() }
  }

  /**
   * Asks the server what changed since we last heard from it, deletions included. Live updates are lost while a
   * device sleeps, an installed app sits in the background or the connection drops; without this the board would
   * stay out of date until it was reopened.
   */
  let catching = false
  let caughtAt = 0
  catchUp = async (force = false) => {
    if (catching || !navigator.onLine || S().boardId !== boardId || (!force && Date.now() - caughtAt < 5000)) return
    catching = true
    try {
      if (unreachable) {
        // the board was opened from the saved copy; now that the server answers, get the real thing
        try { await loadAccess() } catch { return }
        if (S().boardId !== boardId) return
        if (!meta || !role) { active?.close(); active = null; lockOut(); toast('You no longer have access to this board'); return }
        unreachable = false
        showAccess()
      }
      const from = new Date(Math.max(0, since - 15000)).toISOString() // overlap, in case writes landed out of order
      for (let at = 0; ; at += 1000) {
        const { data, error } = await supabase.from('board_items').select('id,board_id,data,rev,deleted,client_id,updated_at')
          .eq('board_id', boardId).gte('updated_at', from).order('updated_at').order('id').range(at, at + 999)
        if (error || S().boardId !== boardId) return
        const rows = (data || []) as Row[]
        seen(rows)
        inbox.push(...rows)
        drain()
        if (rows.length < 1000) break
      }
      // the title, sharing and shared settings (timer, voting) may have changed too
      const fresh = await supabase.from('boards').select('title,link_access,settings').eq('id', boardId).maybeSingle()
      const cur = S().meta
      if (fresh.data && cur && S().boardId === boardId) useBoard.setState({ meta: { ...cur, title: String(fresh.data.title || cur.title).slice(0, 200), link_access: fresh.data.link_access, settings: fresh.data.settings || {} } })
      caughtAt = Date.now()
      if (dirty.size) flush()
      else if (S().syncState === 'offline') useBoard.setState({ syncState: 'synced' })
    } catch { /* still unreachable: the next trigger tries again */ } finally { catching = false }
  }

  const db = supabase.channel(`db:${boardId}`)
  db
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
      const r = payload.new as Row
      if (!r || !r.id) return
      inbox.push(r)
      if (!inboxRaf) inboxRaf = requestAnimationFrame(drain)
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'boards', filter: `id=eq.${boardId}` }, (payload) => {
      const b = payload.new as BoardMeta
      const cur = S().meta
      if (cur && b) useBoard.setState({ meta: { ...cur, title: String(b.title || cur.title).slice(0, 200), link_access: b.link_access, settings: b.settings || {} } })
    })
    // (re)connected: collect whatever changed between loading and going live, or while the connection was down
    .subscribe((status) => { if (status === 'SUBSCRIBED') catchUp(true) })
  channels.db = db

  let lastCam = 0
  // Every packet says where the pointer is now, or that it is off the board, so a missed packet cannot leave
  // a cursor stranded on someone else's screen.
  let away = document.visibilityState === 'hidden'
  const cursorPayload = (full: boolean) => {
    const s = S()
    const now = Date.now()
    const payload: Record<string, unknown> = { c: myClient, sel: s.selection.slice(0, 30) }
    if (full) Object.assign(payload, { n: me.name, col: me.color, u: me.id })
    const p: Pt | null = away ? null : bus.pointer?.() ?? null
    if (p) { payload.x = Math.round(p.x * 10) / 10; payload.y = Math.round(p.y * 10) / 10 }
    else payload.off = 1
    if (full || now - lastCam > 200) { lastCam = now; payload.cam = { ...s.camera, vw: s.viewport.w, vh: s.viewport.h } }
    return payload
  }
  // Announce ourselves over broadcast too: presence updates alone can be missed.
  function hello() { presence.send({ type: 'broadcast', event: 'cursor', payload: cursorPayload(true) }) }
  const sendCursor = throttle(() => { presence.send({ type: 'broadcast', event: 'cursor', payload: cursorPayload(false) }) }, 60)
  // In the background (another app, a locked phone) timers stop, so say the pointer is gone before that happens.
  const onAway = () => {
    away = document.visibilityState === 'hidden'
    if (Object.keys(peers()).length) presence.send({ type: 'broadcast', event: 'cursor', payload: cursorPayload(false) })
  }
  document.addEventListener('visibilitychange', onAway)

  /** Access can be withdrawn while a board is open; check now and then, and close the board if it has gone. */
  let checking = false
  async function checkAccess() {
    if (checking || !navigator.onLine || S().boardId !== boardId) return
    checking = true
    try {
      const r = await supabase.rpc('board_role', { b: boardId })
      if (r.error || S().boardId !== boardId) return
      if (!r.data) { active?.close(); active = null; lockOut(); toast('You no longer have access to this board'); return }
      if (r.data !== S().role) {
        useBoard.setState({ role: r.data as Role, tool: 'select', editingId: null })
        try { localStorage.setItem(roleKey(boardId), r.data as string) } catch { /* ignore */ }
      }
    } finally { checking = false }
  }

  let beats = 0
  const heartbeat = setInterval(() => {
    hello()
    const now = Date.now()
    const state = presence.presenceState()
    for (const key in peers()) {
      const peer = peers()[key]
      if (now - peer.seen > 35000 && !state[key]) dropPeer(key)
      // nothing heard for more than one heartbeat: the device is asleep or cut off, so its pointer is not there
      else if (peer.cursor && now - peer.seen > 15000) setPeer(key, { cursor: null })
    }
    if (++beats % 6 === 0) checkAccess()
  }, 10000)
  const onLeave = () => { presence.send({ type: 'broadcast', event: 'bye', payload: { c: myClient } }) }
  window.addEventListener('pagehide', onLeave)
  bus.cursor = () => { if (Object.keys(peers()).length) sendCursor() }
  const unsubSel = useBoard.subscribe((s, p) => {
    if ((s.selection !== p.selection || s.camera !== p.camera) && Object.keys(s.peers).length) sendCursor()
  })

  if (meta) {
    supabase.from('board_user_state').upsert({ board_id: boardId, user_id: me.id, last_opened_at: new Date().toISOString() }, { onConflict: 'user_id,board_id' }).then(() => {})
    autoSnapshot(boardId, meta).catch(() => {})
  }

  active = {
    id: boardId,
    flush: async () => { flushSoon.cancel(); await flush() },
    close: () => {
      finishEditing()
      flushSoon.flush(); saveOutbox.flush(); checkpoint.cancel()
      saveThumb.cancel()
      if (previewDue && mayEdit() && S().boardId === boardId && S().status === 'ready') writePreview(S().items).catch(() => {})
      if (S().boardId === boardId && S().status === 'ready') set(CACHE, Object.values(S().items)).catch(() => {})
      saveCache.cancel()
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pagehide', leave)
      document.removeEventListener('visibilitychange', onHide)
      clearTimeout(retry)
      cancelAnimationFrame(inboxRaf)
      unsubSel()
      clearInterval(heartbeat); window.removeEventListener('pagehide', onLeave); onLeave()
      document.removeEventListener('visibilitychange', onAway)
      hooks.onCommit = undefined; hooks.onLive = undefined; bus.cursor = undefined
      for (const ch of [ops, db]) supabase.removeChannel(ch)
      setTimeout(() => supabase.removeChannel(presence), 400) // let the goodbye message leave first
      channels.presence = channels.ops = channels.db = undefined
      cleanupBase()
    },
  }
}

export function closeBoard() {
  active?.close()
  active = null
  resetBoard({ boardId: null, status: 'idle', meta: null })
}

// ---------- versions ----------

export interface Version { id: string; name: string; auto: boolean; item_count: number; created_at: string; created_by: string | null }

async function autoSnapshot(boardId: string, meta: BoardMeta) {
  const role = S().role
  if (role !== 'owner' && role !== 'editor') return
  const { data } = await supabase.from('board_versions').select('created_at').eq('board_id', boardId).order('created_at', { ascending: false }).limit(1)
  const last = data?.[0]?.created_at ? new Date(data[0].created_at).getTime() : 0
  const changed = new Date(meta.updated_at).getTime()
  const items = Object.values(S().items)
  if (!items.length || changed <= last || Date.now() - last < 4 * 3600 * 1000) return
  await supabase.from('board_versions').insert({ board_id: boardId, name: 'Auto-save', auto: true, item_count: items.length, snapshot: items })
}

export async function listVersions(boardId: string): Promise<Version[]> {
  if (isLocalBoard(boardId)) return ((await get(`wc.local.versions.${boardId}`)) as Version[] | undefined) || []
  const { data, error } = await supabase.from('board_versions').select('id,name,auto,item_count,created_at,created_by').eq('board_id', boardId).order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error('Could not load version history')
  return (data || []) as Version[]
}

export async function saveVersion(boardId: string, name: string) {
  const items = Object.values(S().items)
  if (isLocalBoard(boardId)) {
    const id = `v-${Date.now()}`
    const list = await listVersions(boardId)
    const keep = [{ id, name, auto: false, item_count: items.length, created_at: new Date().toISOString(), created_by: null }, ...list]
    for (const old of keep.slice(40)) del(`wc.local.version.${old.id}`).catch(() => {})
    await set(`wc.local.versions.${boardId}`, keep.slice(0, 40))
    await set(`wc.local.version.${id}`, items)
    return
  }
  const { error } = await supabase.from('board_versions').insert({ board_id: boardId, name: name.slice(0, 200), auto: false, item_count: items.length, snapshot: items })
  if (error) throw new Error('Could not save this version')
}

export async function loadVersion(boardId: string, versionId: string): Promise<Item[]> {
  if (isLocalBoard(boardId)) return normalizeItems(await get(`wc.local.version.${versionId}`))
  const { data, error } = await supabase.from('board_versions').select('snapshot').eq('id', versionId).single()
  if (error) throw new Error('Could not load this version')
  return normalizeItems(data.snapshot)
}
