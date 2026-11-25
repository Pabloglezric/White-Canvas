// Fixes for boards and people that showed up differently on two devices of the same account.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cloud = vi.hoisted(() => ({ boards: [] as any[], items: [] as any[], versions: [] as any[], uploads: [] as string[], deleted: [] as string[], failItems: false, source: [] as any[], files: [] as string[], copies: [] as string[][], failCopy: '' }))
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
    select: () => {
      const q = { eq: () => q, order: () => q, range: async (a: number, b: number) => ({ data: cloud.source.slice(a, b + 1).map((data) => ({ data })), error: null }) }
      return q
    },
    update: () => ({ eq: async () => ({ error: null }) }),
    delete: () => ({ eq: async (_col: string, id: string) => { cloud.deleted.push(id); return { error: null } } }),
  })
  // `files` is what the bucket holds; a copy answers the way the storage service does
  const storage = { from: () => ({
    upload: async (path: string) => { cloud.uploads.push(path); return { error: null } },
    copy: async (src: string, to: string) => {
      if (src === cloud.failCopy) return { data: null, error: { message: 'storage is down', status: 500, statusCode: '500' } }
      if (!cloud.files.includes(src)) return { data: null, error: { message: 'Object not found', status: 400, statusCode: '404' } }
      cloud.copies.push([src, to]); cloud.files.push(to)
      return { data: { path: to }, error: null }
    },
    list: async (folder: string) => ({ data: cloud.files.filter((f) => f.startsWith(`${folder}/`)).map((f) => ({ name: f.slice(folder.length + 1) })) }),
    remove: async (paths: string[]) => { cloud.files = cloud.files.filter((f) => !paths.includes(f)); return { error: null } },
  }) }
  return { supabase: { from, storage }, hasSupabase: true, SUPABASE_URL: '', SUPABASE_KEY: '', FUNCTIONS_URL: '' }
})

import { get, set } from 'idb-keyval'
import { FRAME_PRESETS, framePreset, make } from '../../src/board/defaults'
import { people } from '../../src/board/store'
import { localBoards, saveLocalBoards, saveLocalItems } from '../../src/board/sync'
import { normalizeItem } from '../../src/board/validate'
import { deleteBoard, duplicateBoard, moveToAccount, type BoardRow } from '../../src/lib/boards'
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
    Object.assign(cloud, { boards: [], items: [], versions: [], uploads: [], deleted: [], failItems: false, source: [], files: [], copies: [], failCopy: '' })
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

describe('duplicating a cloud board', () => {
  const SRC = '22222222-2222-4222-8222-222222222222'
  const OTHER = '33333333-3333-4333-8333-333333333333'
  const original: BoardRow = { id: SRC, title: 'Site plan', owner_id: 'someone-else', link_access: 'view', settings: {}, created_at: '2026-11-01T00:00:00.000Z', updated_at: '2026-11-01T00:00:00.000Z', shared: true }
  const image = (src: string, thumb?: string) => ({ ...make.image({ x: 0, y: 0, src }), ...(thumb ? { thumb } : null) }) as ImageItem
  const mine = (f: string) => f.startsWith(`${NEW_ID}/`)

  beforeEach(() => {
    Object.assign(cloud, { boards: [], items: [], versions: [], uploads: [], deleted: [], failItems: false, copies: [], failCopy: '' })
    cloud.files = [`${SRC}/plan.png`, `${SRC}/plan-small.webp`, `${SRC}/page-1.png`, `${SRC}/tower.ifc`, `${SRC}/brief.PDF`, `${OTHER}/pasted.png`]
    cloud.source = [
      make.sticky({ x: 0, y: 0, html: 'note' }),
      image(`asset:${SRC}/plan.png`, `asset:${SRC}/plan-small.webp`),
      image(`asset:${SRC}/plan.png`), // the same file placed twice
      image(`asset:${SRC}/page-1.png`), // a PDF page
      make.ifc({ x: 0, y: 0, src: `asset:${SRC}/tower.ifc`, name: 'tower.ifc' }),
      make.file({ x: 0, y: 0, src: `asset:${SRC}/brief.PDF`, name: 'brief.pdf' }),
      image(`asset:${OTHER}/pasted.png`), // pasted in from a third board
      image(`asset:${SRC}/gone.png`), // already missing from storage
      image('https://example.com/photo.jpg'),
    ]
  })

  it('gives the copy its own files, so it outlives the original and any access to it', async () => {
    const id = await duplicateBoard(original, true)
    expect(id).toBe(NEW_ID)
    expect(cloud.boards[0].title).toBe('Site plan (copy)')
    expect(cloud.items).toHaveLength(9)
    expect(cloud.copies.map(([from]) => from).sort()).toEqual([`${SRC}/brief.PDF`, `${OTHER}/pasted.png`, `${SRC}/page-1.png`, `${SRC}/plan-small.webp`, `${SRC}/plan.png`, `${SRC}/tower.ifc`].sort()) // once per file
    const data = cloud.items.map((r) => r.data)
    const [plan, again, page, pasted, gone, web] = data.filter((d) => d.type === 'image')
    expect(plan.src).toMatch(new RegExp(`^asset:${NEW_ID}/[\\w-]+\\.png$`))
    expect(plan.thumb).toMatch(new RegExp(`^asset:${NEW_ID}/[\\w-]+\\.webp$`))
    expect(again.src).toBe(plan.src)
    expect(page.src).toMatch(new RegExp(`^asset:${NEW_ID}/`))
    expect(pasted.src).toMatch(new RegExp(`^asset:${NEW_ID}/`))
    expect(data.find((d) => d.type === 'ifc').src).toMatch(new RegExp(`^asset:${NEW_ID}/[\\w-]+\\.ifc$`))
    expect(data.find((d) => d.type === 'file').src).toMatch(new RegExp(`^asset:${NEW_ID}/[\\w-]+\\.pdf$`))
    expect(gone.src).toBe(`asset:${SRC}/gone.png`) // nothing to copy: left as it was, nothing invented
    expect(web.src).toBe('https://example.com/photo.jpg')
    expect(data.every((d) => normalizeItem(d))).toBe(true) // the new references are ones the board accepts

    // the original is deleted (or sharing is switched off): its folder is out of reach, and the copy does not need it
    await deleteBoard({ id: SRC } as BoardRow)
    await deleteBoard({ id: OTHER } as BoardRow)
    expect(cloud.files).toHaveLength(6)
    expect(cloud.files.every(mine)).toBe(true)
    const refs = data.flatMap((d) => [d.src, d.thumb]).filter((s) => typeof s === 'string' && s.startsWith('asset:') && s !== gone.src)
    expect(refs).toHaveLength(7)
    expect(refs.every((s) => cloud.files.includes(s.slice(6)))).toBe(true)
  })

  it('leaves nothing half-made in the account, and the original untouched, when a file cannot be copied', async () => {
    cloud.failCopy = `${SRC}/tower.ifc`
    await expect(duplicateBoard(original, true)).rejects.toThrow('storage is down')
    expect(cloud.copies.length).toBeGreaterThan(0) // other files in the batch did arrive, and were cleaned up
    expect(cloud.files.some(mine)).toBe(false)
    expect(cloud.files).toHaveLength(6)
    expect(cloud.items).toEqual([])
    expect(cloud.deleted).toEqual([NEW_ID])
  })

  it('removes the copy when its items are refused', async () => {
    cloud.failItems = true
    await expect(duplicateBoard(original, true)).rejects.toThrow('refused')
    expect(cloud.files.some(mine)).toBe(false)
    expect(cloud.deleted).toEqual([NEW_ID])
  })

  it('still shares device files between a device-only board and its copy', async () => {
    const local: BoardRow = { ...original, id: 'local-original', owner_id: 'local-user', shared: false, local: true }
    await saveLocalItems(local.id, [image('local:plan')])
    const id = await duplicateBoard(local, false)
    expect(id).toMatch(/^local-/)
    expect(((await get(`wc.local.items.${id}`)) as ImageItem[])[0].src).toBe('local:plan')
    expect(cloud.copies).toEqual([])
    expect(cloud.uploads).toEqual([])
    expect(cloud.boards).toEqual([])
  })
})
