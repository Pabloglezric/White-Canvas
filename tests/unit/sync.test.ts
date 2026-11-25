// Fixes for boards and people that showed up differently on two devices of the same account.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cloud = vi.hoisted(() => ({ boards: [] as any[], items: [] as any[], versions: [] as any[], uploads: [] as string[], deleted: [] as string[], failItems: false }))
const NEW_ID = '11111111-1111-4111-8111-111111111111'

vi.mock('idb-keyval', () => {
  const m = new Map<string, unknown>()
  return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v) }, del: async (k: string) => { m.delete(k) }, keys: async () => [...m.keys()] }
})
vi.mock('../../src/lib/supabase', () => {
  const from = (table: string) => ({
    insert: (rows: any) => {
      if (table === 'boards') { cloud.boards.push({ id: NEW_ID, ...rows }); return { select: () => ({ single: async () => ({ data: { id: NEW_ID }, error: null }) }) } }
      if (table === 'board_items') { if (cloud.failItems) return Promise.resolve({ error: { message: 'refused' } }); cloud.items.push(...rows) }
      if (table === 'board_versions') cloud.versions.push(rows)
      return Promise.resolve({ error: null })
    },
    update: () => ({ eq: async () => ({ error: null }) }),
    delete: () => ({ eq: async (_col: string, id: string) => { cloud.deleted.push(id); return { error: null } } }),
  })
  const storage = { from: () => ({ upload: async (path: string) => { cloud.uploads.push(path); return { error: null } }, list: async () => ({ data: [] }), remove: async () => ({ error: null }) }) }
  return { supabase: { from, storage }, hasSupabase: true, SUPABASE_URL: '', SUPABASE_KEY: '', FUNCTIONS_URL: '' }
})

import { get, set } from 'idb-keyval'
import { FRAME_PRESETS, framePreset, make } from '../../src/board/defaults'
import { people } from '../../src/board/store'
import { localBoards, saveLocalBoards, saveLocalItems } from '../../src/board/sync'
import { normalizeItem } from '../../src/board/validate'
import { moveToAccount, type BoardRow } from '../../src/lib/boards'
import type { BoardMeta, FrameItem, ImageItem, Item, Peer } from '../../src/board/types'

describe('frame preset tag', () => {
  const a4 = FRAME_PRESETS.find((p) => p.label === 'A4 portrait')!
  it('shows while the frame keeps the preset proportions, at any size', () => {
    expect(framePreset({ preset: '16:9', w: 1600, h: 900 })).toBe('16:9')
    expect(framePreset({ preset: '16:9', w: 800, h: 450 })).toBe('16:9')
    expect(framePreset({ preset: 'A4 portrait', w: a4.w * 2.5, h: a4.h * 2.5 })).toBe('A4 portrait')
  })
  it('goes away once the proportions are lost', () => {
    expect(framePreset({ preset: '16:9', w: 1600, h: 1000 })).toBeUndefined()
    expect(framePreset({ preset: 'Square', w: 1000, h: 800 })).toBeUndefined()
    expect(framePreset({ w: 1600, h: 900 })).toBeUndefined()
  })
  it('lifts the preset out of titles written by older versions', () => {
    const old = normalizeItem({ ...make.frame({ x: 0, y: 0, w: 1600, h: 1200, title: '16:9 3' }) }) as FrameItem
    expect(old.title).toBe('Frame 3')
    expect(old.preset).toBe('16:9')
    expect(framePreset(old)).toBeUndefined() // it was stretched to 4:3 long ago: no stale tag
    const named = normalizeItem({ ...make.frame({ x: 0, y: 0, title: 'Ground floor 2' }) }) as FrameItem
    expect(named.title).toBe('Ground floor 2')
    expect(named.preset).toBeUndefined()
    expect((normalizeItem({ ...make.frame({ x: 0, y: 0 }), preset: '<b>' }) as FrameItem).preset).toBeUndefined()
  })
})

describe('people on a board', () => {
  const peer = (id: string, user: string, seen: number): Peer => ({ id, user, name: user, color: '#112233', seen })
  it('lists one entry per account and never your own other devices', () => {
    const list = people({ a: peer('a', 'ana', 10), b: peer('b', 'ana', 30), c: peer('c', 'me', 20), d: peer('d', 'bo', 5) }, 'me')
    expect(list.map((p) => p.user).sort()).toEqual(['ana', 'bo'])
    const ana = list.find((p) => p.user === 'ana')!
    expect(ana.id).toBe('b') // the device heard from most recently is the one to follow
    expect(ana.clients.sort()).toEqual(['a', 'b'])
  })
})

describe('moving a device-only board into the account', () => {
  const meta = (id: string): BoardMeta => ({ id, title: 'Site plan', owner_id: 'local-user', link_access: 'none', settings: {}, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z' })
  const image = (src: string, thumb?: string) => ({ ...make.image({ x: 0, y: 0, src }), ...(thumb ? { thumb } : null) }) as ImageItem
  let board: BoardRow
  let items: Item[]

  beforeEach(async () => {
    Object.assign(cloud, { boards: [], items: [], versions: [], uploads: [], deleted: [], failItems: false })
    board = { ...meta(`local-${Math.random().toString(36).slice(2)}`), local: true }
    items = [make.sticky({ x: 0, y: 0, html: 'note' }), image('local:plan', 'local:plan-small'), image('local:plan'), image('local:lost')]
    await saveLocalBoards([board])
    await saveLocalItems(board.id, items)
    await set('wc.asset.plan', new Blob(['plan']))
    await set('wc.asset.plan-small', new Blob(['small']))
    await set(`wc.local.versions.${board.id}`, [{ id: 'v-1', name: 'First issue', auto: false, item_count: 1, created_at: '2026-11-02T00:00:00.000Z', created_by: null }])
    await set('wc.local.version.v-1', [image('local:plan')])
  })

  it('uploads its files once, repoints the items, keeps versions and removes the device copy', async () => {
    const id = await moveToAccount(board)
    expect(id).toBe(NEW_ID)
    expect(cloud.boards[0].title).toBe('Site plan')
    expect(cloud.items).toHaveLength(4)
    expect(cloud.items.every((r) => r.board_id === NEW_ID)).toBe(true)
    expect(cloud.uploads).toHaveLength(2) // the plan (used by two items and a version) and its preview
    const images = cloud.items.map((r) => r.data).filter((d) => d.type === 'image')
    expect(images.filter((d) => d.src.startsWith(`asset:${NEW_ID}/`))).toHaveLength(2)
    expect(images[0].src).toBe(images[1].src)
    expect(images[0].thumb).toMatch(new RegExp(`^asset:${NEW_ID}/`))
    expect(images[2].src).toBe('local:lost') // already missing on the device: left as it was, nothing invented
    expect(cloud.versions).toHaveLength(1)
    expect(cloud.versions[0].snapshot[0].src).toBe(images[0].src)
    expect(await localBoards()).toEqual([])
    expect(await get(`wc.local.items.${board.id}`)).toBeUndefined()
  })

  it('leaves the device copy alone, and nothing half-made in the account, when the upload fails', async () => {
    cloud.failItems = true
    await expect(moveToAccount(board)).rejects.toThrow('refused')
    expect(cloud.deleted).toEqual([NEW_ID])
    expect((await localBoards()).map((b) => b.id)).toEqual([board.id])
    expect(await get(`wc.local.items.${board.id}`)).toHaveLength(4)
  })
})
