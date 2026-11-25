// A stand-in for the live backend, so tests can sign in and put two devices on one board without a real server:
// REST answers for one account, and a realtime hub (join, heartbeat, broadcast relay, presence) shared by every
// browser context attached to it.
import type { BrowserContext, WebSocketRoute } from '@playwright/test'

export const BACKEND = 'http://localhost:54399' // the address the "live" test build is told to use
export const USER = '22222222-2222-4222-8222-222222222222'
export const BOARD = '33333333-3333-4333-8333-333333333333'

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER, role: 'authenticated', exp: 4102444800, aud: 'authenticated' })}.sig`
const session = { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user: { id: USER, email: 'tester@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-25T00:00:00Z' } }

export const stickyRow = (n: number, x: number, y: number, text: string) => {
  const id = `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`
  return { id, board_id: BOARD, data: { id, type: 'sticky', x, y, w: 200, h: 200, rot: 0, z: n, rev: 1, html: text, fill: '#fff2a8' }, rev: 1, deleted: false, client_id: 'seed', updated_at: '2026-11-25T10:00:01+00:00' }
}

interface Joined { joinRef: string; key: string; ref: string; meta: Record<string, unknown> | null }
interface Socket { ws: WebSocketRoute; topics: Map<string, Joined> }

export function createBackend() {
  const cloud = {
    boards: [{ id: BOARD, owner_id: USER, title: 'Shared plan', link_access: 'none', settings: {}, thumbnail: null as string | null, trashed_at: null, created_at: '2026-11-25T10:00:00+00:00', updated_at: '2026-11-25T10:00:00+00:00' }],
    items: [] as ReturnType<typeof stickyRow>[],
    /** Every change made to a board row (title, thumbnail…), in order. */
    boardPatches: [] as { id: string; body: Record<string, unknown> }[],
  }
  const sockets = new Set<Socket>()
  let serial = 0
  const send = (s: Socket, frame: unknown[]) => { try { s.ws.send(JSON.stringify(frame)) } catch { /* closed */ } }
  const members = (topic: string) => [...sockets].filter((s) => s.topics.has(topic))
  const metas = (t: Joined) => ({ metas: [{ phx_ref: t.ref, ...t.meta }] })
  const leave = (s: Socket, topic: string) => {
    const t = s.topics.get(topic)
    if (!t) return
    s.topics.delete(topic)
    if (t.meta) for (const o of members(topic)) send(o, [o.topics.get(topic)!.joinRef, null, topic, 'presence_diff', { joins: {}, leaves: { [t.key]: metas(t) } }])
  }

  const onMessage = (s: Socket, raw: string | Buffer) => {
    let m: { join_ref: string | null; ref: string | null; topic: string; event: string; payload: any }
    if (typeof raw === 'string') {
      const [join_ref, ref, topic, event, payload] = JSON.parse(raw)
      m = { join_ref, ref, topic, event, payload }
    } else {
      // broadcasts travel as binary frames: a small header of lengths, then the strings, then the JSON payload
      const [kind, joinLen, refLen, topicLen, eventLen, metaLen, encoding] = raw
      if (kind !== 3) return
      let at = 7
      const read = (n: number) => { const v = raw.subarray(at, at + n).toString('utf8'); at += n; return v }
      const join_ref = read(joinLen), ref = read(refLen), topic = read(topicLen), event = read(eventLen)
      read(metaLen)
      m = { join_ref, ref, topic, event: 'broadcast', payload: { type: 'broadcast', event, payload: encoding === 1 ? JSON.parse(raw.subarray(at).toString('utf8')) : null } }
    }
    const ok = (response: unknown = {}) => send(s, [m.join_ref, m.ref, m.topic, 'phx_reply', { status: 'ok', response }])
    switch (m.event) {
      case 'heartbeat': ok(); break
      case 'phx_join': {
        const config = m.payload?.config || {}
        s.topics.set(m.topic, { joinRef: m.join_ref || '', key: config.presence?.key || `k${++serial}`, ref: `p${++serial}`, meta: null })
        ok({ postgres_changes: (config.postgres_changes || []).map((c: object, i: number) => ({ ...c, id: i + 1 })) })
        const state: Record<string, unknown> = {}
        for (const o of members(m.topic)) { const t = o.topics.get(m.topic)!; if (t.meta) state[t.key] = metas(t) }
        send(s, [m.join_ref, null, m.topic, 'presence_state', state])
        break
      }
      case 'phx_leave': leave(s, m.topic); ok(); break
      case 'presence': {
        const t = s.topics.get(m.topic)
        if (t && m.payload.event === 'track') {
          t.meta = m.payload.payload
          for (const o of members(m.topic)) send(o, [o.topics.get(m.topic)!.joinRef, null, m.topic, 'presence_diff', { joins: { [t.key]: metas(t) }, leaves: {} }])
        }
        ok()
        break
      }
      case 'broadcast':
        for (const o of members(m.topic)) if (o !== s) send(o, [null, null, m.topic, 'broadcast', m.payload])
        if (m.ref) ok()
        break
    }
  }

  /** Signs a browser context in and points its backend calls and live connection at this stand-in. */
  async function attach(context: BrowserContext) {
    await context.addInitScript((s) => { localStorage.setItem('wc.debug', '1'); localStorage.setItem('wc.auth', JSON.stringify(s)) }, session)
    await context.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      const s: Socket = { ws, topics: new Map() }
      sockets.add(s)
      ws.onMessage((msg) => onMessage(s, msg))
      ws.onClose(() => { for (const topic of [...s.topics.keys()]) leave(s, topic); sockets.delete(s) })
    })
    await context.route(`${BACKEND}/**`, async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      const method = req.method(), path = url.pathname
      const one = (req.headers()['accept'] || '').includes('vnd.pgrst.object')
      const eq = (name: string) => (url.searchParams.get(name) || '').replace('eq.', '')
      const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' }, body: JSON.stringify(body) })
      if (method === 'OPTIONS') return json({})
      if (path === '/rest/v1/profiles') return json({ display_name: 'Pablo Test', color: '#e5484d' })
      if (path === '/rest/v1/boards' && method === 'GET') return json(one ? cloud.boards.find((b) => b.id === eq('id')) || null : cloud.boards)
      if (path === '/rest/v1/boards' && method === 'PATCH') {
        const body = req.postDataJSON()
        cloud.boardPatches.push({ id: eq('id'), body })
        Object.assign(cloud.boards.find((b) => b.id === eq('id')) || {}, body)
        return json(null, 204)
      }
      if (path === '/rest/v1/board_user_state' || path === '/rest/v1/board_versions') return json(method === 'GET' ? [] : null, method === 'GET' ? 200 : 201)
      if (path === '/rest/v1/rpc/board_role') return json('owner')
      if (path === '/rest/v1/board_items' && method === 'GET') return json(url.search.includes('updated_at=gte') ? [] : cloud.items.filter((r) => !r.deleted && r.board_id === eq('board_id')))
      if (path === '/rest/v1/board_items') {
        for (const row of [].concat(req.postDataJSON() || []) as ReturnType<typeof stickyRow>[]) {
          const i = cloud.items.findIndex((x) => x.id === row.id)
          const next = { ...row, updated_at: new Date().toISOString() }
          if (i >= 0) cloud.items[i] = next
          else cloud.items.push(next)
        }
        return json(null, 201)
      }
      if (path.startsWith('/storage/v1/object/list')) return json([])
      return json({})
    })
  }

  return { attach, cloud }
}
