// Loading, saving and realtime collaboration.
// Cloud boards: Supabase rows + Realtime (broadcast for speed, Postgres changes for agent/API writes),
// with an IndexedDB cache and outbox so edits survive flaky or missing connectivity.
// Local boards ("local-…"): IndexedDB only.
import type { RealtimeChannel } from '@supabase/supabase-js'
import { del, get, set } from 'idb-keyval'
import { supabase } from '../lib/supabase'
import { debounce, throttle } from '../lib/util'
import { isLocalBoard } from './assets'
import { bus } from './interaction'
import { S, applyRemote, fitAll, fitBox, hooks, resetBoard, toast, useBoard } from './store'
import { thumbnailSvg } from './export'
import type { BoardMeta, BoardSettings, Camera, Item, Peer, Pt, Role } from './types'

interface Row { id: string; board_id: string; data: Item; rev: number; deleted: boolean; client_id: string }

const LOCAL_LIST = 'wc.local.boards'
const cacheKey = (id: string) => `wc.cache.${id}`
const outboxKey = (id: string) => `wc.outbox.${id}`
const localItemsKey = (id: string) => `wc.local.items.${id}`
const camKey = (id: string) => `wc.cam.${id}`
const roleKey = (id: string) => `wc.role.${id}`

export async function localBoards(): Promise<BoardMeta[]> { return ((await get(LOCAL_LIST)) as BoardMeta[] | undefined) || [] }
export async function saveLocalBoards(list: BoardMeta[]) { await set(LOCAL_LIST, list) }
export async function localItems(id: string): Promise<Item[]> { return ((await get(localItemsKey(id))) as Item[] | undefined) || [] }
export async function saveLocalItems(id: string, items: Item[]) { await set(localItemsKey(id), items) }
export async function deleteLocalBoard(id: string) {
  await saveLocalBoards((await localBoards()).filter((b) => b.id !== id))
  await del(localItemsKey(id))
}

function restoreCamera(id: string) {
  try {
    const c = JSON.parse(localStorage.getItem(camKey(id)) || 'null') as Camera | null
    if (c && Number.isFinite(c.x) && Number.isFinite(c.z)) { S().setCamera(c); return true }
  } catch { /* ignore */ }
  return false
}

async function fetchAllItems(boardId: string): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('board_items').select('id,board_id,data,rev,deleted,client_id')
      .eq('board_id', boardId).eq('deleted', false).order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data || []) as Row[]))
    if (!data || data.length < 1000) break
  }
  return out
}

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
  if (error) toast(`Could not save: ${error.message}`)
}

export function broadcast(event: string, payload: Record<string, unknown>) {
  channels.presence?.send({ type: 'broadcast', event, payload: { ...payload, c: S().clientId } })
}
const channels: { presence?: RealtimeChannel; ops?: RealtimeChannel; db?: RealtimeChannel } = {}

export async function openBoard(boardId: string, me: { id: string; name: string; color: string }): Promise<void> {
  active?.close()
  active = null
  resetBoard({ boardId, status: 'loading', me, meta: null, role: 'viewer', syncState: isLocalBoard(boardId) ? 'local' : 'synced' })
  const stale = () => S().boardId !== boardId
  const toMap = (list: Item[]) => { const m: Record<string, Item> = {}; for (const i of list) if (i && i.id) m[i.id] = i; return m }
  const ready = (items: Record<string, Item>) => {
    useBoard.setState({ items, status: 'ready' })
    if (!restoreCamera(boardId)) fitAll(false)
  }
  const saveCam = debounce(() => { try { localStorage.setItem(camKey(boardId), JSON.stringify(S().camera)) } catch { /* ignore */ } }, 500)
  const unsubCam = useBoard.subscribe((s, p) => { if (s.camera !== p.camera) saveCam() })

  // ---------- local-only board ----------
  if (isLocalBoard(boardId)) {
    const list = await localBoards()
    const meta = list.find((b) => b.id === boardId)
    if (stale()) return
    if (!meta) { useBoard.setState({ status: 'denied' }); unsubCam(); return }
    useBoard.setState({ meta, role: 'owner' })
    ready(toMap(await localItems(boardId)))
    const save = debounce(async () => {
      const s = S()
      if (s.boardId !== boardId) return
      await saveLocalItems(boardId, Object.values(s.items))
      const all = await localBoards()
      await saveLocalBoards(all.map((b) => (b.id === boardId ? { ...b, title: s.meta?.title || b.title, settings: s.meta?.settings || b.settings, updated_at: new Date().toISOString(), thumbnail: thumbnailSvg(s.items) } : b)))
    }, 400)
    hooks.onCommit = () => save()
    hooks.onLive = undefined
    bus.cursor = undefined
    active = { id: boardId, close: () => { save.flush(); unsubCam(); hooks.onCommit = undefined }, flush: async () => { save.flush() } }
    return
  }

  // ---------- cloud board ----------
  const cached = (await get(cacheKey(boardId))) as Item[] | undefined
  if (stale()) return
  if (cached?.length) ready(toMap(cached))

  let meta: BoardMeta | null = null
  let role: Role | null = null
  let unreachable = false
  try {
    let res = await supabase.from('boards').select('*').eq('id', boardId).maybeSingle()
    if (!res.data) {
      const joined = await supabase.rpc('join_board', { b: boardId })
      if (joined.data) res = await supabase.from('boards').select('*').eq('id', boardId).maybeSingle()
    }
    if (res.error) throw new Error(res.error.message)
    meta = res.data as BoardMeta | null
    if (meta) role = ((await supabase.rpc('board_role', { b: boardId })).data as Role | null) || null
  } catch (e) {
    if (stale()) return
    unreachable = true
    if (cached?.length) {
      // No connection: keep working on the saved copy with the role we last had here.
      let lastRole: Role = 'viewer'
      try { lastRole = (localStorage.getItem(roleKey(boardId)) as Role) || 'viewer' } catch { /* ignore */ }
      useBoard.setState({ syncState: 'offline', role: lastRole })
      toast('Offline — showing the last saved copy')
    } else { useBoard.setState({ status: 'error' }); unsubCam(); return }
  }
  if (stale()) return
  if (!meta && !unreachable) {
    // The server answered and we have no access (deleted, or sharing was turned off): drop any local copy.
    del(cacheKey(boardId)).catch(() => {}); del(outboxKey(boardId)).catch(() => {})
    try { localStorage.removeItem(roleKey(boardId)) } catch { /* ignore */ }
    useBoard.setState({ status: 'denied', items: {} }); unsubCam(); return
  }
  if (meta) {
    useBoard.setState({ meta: { ...meta, settings: meta.settings || {} }, role: role || 'viewer' })
    try { localStorage.setItem(roleKey(boardId), role || 'viewer') } catch { /* ignore */ }
  }

  // outbox: edits that never reached the server
  const dirty = new Map<string, Row>()
  const outbox = ((await get(outboxKey(boardId))) as Row[] | undefined) || []

  if (meta) {
    try {
      const rows = await fetchAllItems(boardId)
      if (stale()) return
      const items: Record<string, Item> = {}
      for (const r of rows) items[r.id] = { ...r.data, id: r.id, rev: r.rev }
      for (const o of outbox) {
        const remote = rows.find((r) => r.id === o.id)
        if (remote && remote.rev > o.rev) continue
        dirty.set(o.id, o)
        if (o.deleted) delete items[o.id]
        else items[o.id] = { ...o.data, rev: o.rev }
      }
      const hadCam = cached?.length
      useBoard.setState({ items, status: 'ready' })
      if (!hadCam && !restoreCamera(boardId)) fitAll(false)
    } catch {
      if (!cached?.length) { useBoard.setState({ status: 'error' }); unsubCam(); return }
      useBoard.setState({ syncState: 'offline' })
    }
  }

  // ---------- persistence ----------
  const saveOutbox = debounce(() => { set(outboxKey(boardId), [...dirty.values()]).catch(() => {}) }, 250)
  const saveCache = debounce(() => { if (S().boardId === boardId) set(cacheKey(boardId), Object.values(S().items)).catch(() => {}) }, 1500)
  let flushing = false
  let retry: ReturnType<typeof setTimeout> | undefined

  const flush = async () => {
    if (flushing || !dirty.size) return
    if (!navigator.onLine) { useBoard.setState({ syncState: 'offline' }); return }
    flushing = true
    useBoard.setState({ syncState: 'saving' })
    try {
      while (dirty.size) {
        const batch = [...dirty.values()].slice(0, 150)
        const { error } = await supabase.from('board_items').upsert(batch, { onConflict: 'id' })
        if (error) throw new Error(error.message)
        for (const r of batch) if (dirty.get(r.id)?.rev === r.rev) dirty.delete(r.id)
      }
      saveOutbox()
      useBoard.setState({ syncState: 'synced' })
    } catch (e) {
      useBoard.setState({ syncState: 'offline' })
      clearTimeout(retry)
      retry = setTimeout(flush, 5000)
    } finally {
      flushing = false
    }
  }
  const flushSoon = debounce(flush, 450)
  const onOnline = () => { flush() }
  const onHide = () => { if (document.visibilityState === 'hidden') { flushSoon.flush(); saveCache.flush(); saveOutbox.flush() } }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onHide)

  const saveThumb = debounce(() => {
    const s = S()
    if (s.boardId !== boardId || (s.role !== 'owner' && s.role !== 'editor')) return
    supabase.from('boards').update({ thumbnail: thumbnailSvg(s.items) }).eq('id', boardId).then(() => {})
  }, 8000)

  const liveIds = new Set<string>()
  const sendLive = throttle(() => {
    const { items } = S()
    const list = [...liveIds].map((id) => items[id]).filter(Boolean)
    liveIds.clear()
    if (list.length && list.length <= 60) channels.ops?.send({ type: 'broadcast', event: 'live', payload: { c: S().clientId, items: list } })
  }, 60)

  hooks.onLive = (changed) => { for (const it of changed) liveIds.add(it.id); sendLive() }
  hooks.onCommit = (changed, removed) => {
    const clientId = S().clientId
    for (const it of changed) dirty.set(it.id, { id: it.id, board_id: boardId, data: it, rev: it.rev, deleted: false, client_id: clientId })
    for (const it of removed) dirty.set(it.id, { id: it.id, board_id: boardId, data: it, rev: it.rev, deleted: true, client_id: clientId })
    channels.ops?.send({
      type: 'broadcast', event: 'commit',
      payload: { c: clientId, items: changed.length <= 80 ? changed : [], removed: removed.map((r) => ({ id: r.id, rev: r.rev })) },
    })
    useBoard.setState({ syncState: navigator.onLine ? 'saving' : 'offline' })
    saveOutbox(); saveCache(); flushSoon(); saveThumb()
  }
  if (dirty.size) flush()
  saveCache()

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
  try { await supabase.realtime.setAuth() } catch { /* not signed in */ }
  if (stale()) return

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
        next[key] = { ...(peers()[key] || { id: key, seen: now }), id: key, user: p.user, name: p.name, color: p.color } as Peer
      }
      const following = S().following
      useBoard.setState({ peers: next, following: following && next[following] ? following : null })
    })
    .on('broadcast', { event: 'cursor' }, ({ payload }) => {
      const p = payload as { c: string; n?: string; col?: string; u?: string; x?: number; y?: number; sel?: string[]; cam?: Peer['cam'] }
      const known = !!peers()[p.c]
      const patch: Partial<Peer> = { sel: p.sel, seen: Date.now() }
      if (p.n) { patch.name = p.n; patch.color = p.col; patch.user = p.u }
      if (p.x != null) patch.cursor = { x: p.x, y: p.y! }
      if (p.cam) patch.cam = p.cam
      setPeer(p.c, patch)
      if (!known && p.n) hello()
      if (S().following === p.c && p.cam) fitBox({ x: -p.cam.x / p.cam.z, y: -p.cam.y / p.cam.z, w: p.cam.vw / p.cam.z, h: p.cam.vh / p.cam.z }, 0, false, 8)
    })
    .on('broadcast', { event: 'bye' }, ({ payload }) => dropPeer((payload as { c: string }).c))
    .on('broadcast', { event: 'summon' }, ({ payload }) => {
      const p = payload as { name: string; box: { x: number; y: number; w: number; h: number } }
      fitBox(p.box, 0, true, 8)
      toast(`${p.name} brought everyone to their view`)
    })
    .on('broadcast', { event: 'react' }, ({ payload }) => {
      window.dispatchEvent(new CustomEvent('wc-react', { detail: payload }))
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') { presence.track({ user: me.id, name: me.name, color: me.color }); hello() }
    })
  channels.presence = presence

  const ops = supabase.channel(`ops:${boardId}`, { config: { private: true, broadcast: { self: false } } })
  ops
    .on('broadcast', { event: 'live' }, ({ payload }) => { applyRemote((payload as { items: Item[] }).items || [], []) })
    .on('broadcast', { event: 'commit' }, ({ payload }) => {
      const p = payload as { items: Item[]; removed: { id: string; rev: number }[] }
      applyRemote(p.items || [], p.removed || [])
    })
    .subscribe()
  channels.ops = ops

  const db = supabase.channel(`db:${boardId}`)
  db
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_items', filter: `board_id=eq.${boardId}` }, (payload) => {
      const r = payload.new as Row
      if (!r || !r.id || r.client_id === myClient) return
      if (r.deleted) applyRemote([], [{ id: r.id, rev: r.rev }])
      else applyRemote([{ ...r.data, id: r.id, rev: r.rev }], [])
      saveCache()
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'boards', filter: `id=eq.${boardId}` }, (payload) => {
      const b = payload.new as BoardMeta
      const cur = S().meta
      if (cur && b) useBoard.setState({ meta: { ...cur, title: b.title, link_access: b.link_access, settings: b.settings || {} } })
    })
    .subscribe()
  channels.db = db

  let lastCam = 0
  const cursorPayload = (p: Pt | null, full: boolean) => {
    const s = S()
    const now = Date.now()
    const payload: Record<string, unknown> = { c: myClient, sel: s.selection.slice(0, 30) }
    if (full) Object.assign(payload, { n: me.name, col: me.color, u: me.id })
    if (p) { payload.x = Math.round(p.x); payload.y = Math.round(p.y) }
    if (full || now - lastCam > 200) { lastCam = now; payload.cam = { ...s.camera, vw: s.viewport.w, vh: s.viewport.h } }
    return payload
  }
  // Announce ourselves over broadcast too: presence updates alone can be missed.
  function hello() { presence.send({ type: 'broadcast', event: 'cursor', payload: cursorPayload(null, true) }) }
  const sendCursor = throttle((p: Pt | null) => { presence.send({ type: 'broadcast', event: 'cursor', payload: cursorPayload(p, false) }) }, 60)
  const heartbeat = setInterval(() => {
    hello()
    const now = Date.now()
    const state = presence.presenceState()
    for (const key in peers()) if (now - peers()[key].seen > 35000 && !state[key]) dropPeer(key)
  }, 10000)
  const onLeave = () => { presence.send({ type: 'broadcast', event: 'bye', payload: { c: myClient } }) }
  window.addEventListener('pagehide', onLeave)
  bus.cursor = (p) => { if (Object.keys(peers()).length) sendCursor(p) }
  const unsubSel = useBoard.subscribe((s, p) => {
    if ((s.selection !== p.selection || s.camera !== p.camera) && Object.keys(s.peers).length) sendCursor(null)
  })

  if (meta) {
    supabase.from('board_user_state').upsert({ board_id: boardId, user_id: me.id, last_opened_at: new Date().toISOString() }, { onConflict: 'user_id,board_id' }).then(() => {})
    autoSnapshot(boardId, meta).catch(() => {})
  }

  active = {
    id: boardId,
    flush: async () => { flushSoon.cancel(); await flush() },
    close: () => {
      flushSoon.flush(); saveCache.flush(); saveOutbox.flush(); saveThumb.flush()
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onHide)
      clearTimeout(retry)
      unsubCam(); unsubSel()
      clearInterval(heartbeat); window.removeEventListener('pagehide', onLeave); onLeave()
      hooks.onCommit = undefined; hooks.onLive = undefined; bus.cursor = undefined
      for (const ch of [ops, db]) supabase.removeChannel(ch)
      setTimeout(() => supabase.removeChannel(presence), 400) // let the goodbye message leave first
      channels.presence = channels.ops = channels.db = undefined
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
  if (error) throw new Error(error.message)
  return (data || []) as Version[]
}

export async function saveVersion(boardId: string, name: string) {
  const items = Object.values(S().items)
  if (isLocalBoard(boardId)) {
    const id = `v-${Date.now()}`
    const list = await listVersions(boardId)
    await set(`wc.local.versions.${boardId}`, [{ id, name, auto: false, item_count: items.length, created_at: new Date().toISOString(), created_by: null }, ...list].slice(0, 40))
    await set(`wc.local.version.${id}`, items)
    return
  }
  const { error } = await supabase.from('board_versions').insert({ board_id: boardId, name, auto: false, item_count: items.length, snapshot: items })
  if (error) throw new Error(error.message)
}

export async function loadVersion(boardId: string, versionId: string): Promise<Item[]> {
  if (isLocalBoard(boardId)) return ((await get(`wc.local.version.${versionId}`)) as Item[] | undefined) || []
  const { data, error } = await supabase.from('board_versions').select('snapshot').eq('id', versionId).single()
  if (error) throw new Error(error.message)
  return (data.snapshot || []) as Item[]
}
