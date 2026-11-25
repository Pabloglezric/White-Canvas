// Layer, status, subject and custom fields on every item, and the board-wide lists behind them.
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('idb-keyval', () => {
  const m = new Map<string, unknown>()
  return { get: async (k: string) => m.get(k), set: async (k: string, v: unknown) => { m.set(k, v) }, del: async (k: string) => { m.delete(k) }, keys: async () => [...m.keys()] }
})
vi.mock('../../src/lib/supabase', () => ({ supabase: {}, hasSupabase: false, SUPABASE_URL: '', SUPABASE_KEY: '', FUNCTIONS_URL: '' }))

import { make } from '../../src/board/defaults'
import { addField, addLayer, adoptLists, removeField, removeLayer, setDetail, setField, setLayerHidden, setStatuses } from '../../src/board/details'
import { exportArea } from '../../src/board/export'
import { DEFAULT_STATUSES, common, fieldsOf, layersOf, sharedLists, statusColor, statusesOf } from '../../src/board/layers'
import { addItems, selectAll } from '../../src/board/ops'
import { S, isHidden, resetBoard, undo, useBoard } from '../../src/board/store'
import type { BoardMeta, Item } from '../../src/board/types'
import { normalizeItem } from '../../src/board/validate'

const BOARD = 'local-details'
const meta = (): BoardMeta => ({ id: BOARD, title: 'T', owner_id: 'local-user', link_access: 'none', settings: {}, created_at: '', updated_at: '' })
beforeEach(() => { localStorage.clear(); resetBoard({ boardId: BOARD, role: 'owner', status: 'ready', meta: meta() }) })

const base = { id: 'a1', x: 0, y: 0, w: 100, h: 100, rev: 1 }
const SAMPLES: Record<string, object> = {
  sticky: {}, text: {}, shape: {}, frame: {}, card: {}, table: {}, code: {}, chart: {}, connector: {},
  draw: { pts: [0, 0, 0.5, 5, 5, 0.5] }, image: { src: 'https://example.com/a.png' }, embed: { url: 'https://example.com/' },
  ifc: { src: 'local:model' }, file: { src: 'local:file' },
}

describe('details survive validation', () => {
  it('keeps layer, status, subject and fields on every kind of item', () => {
    for (const [type, extra] of Object.entries(SAMPLES)) {
      const it = normalizeItem({ ...base, ...extra, type, layer: 'L1', status: 'Open', subject: 'Fire stopping', fields: { Trade: 'Joinery', Cost: 12 } })!
      expect(it, type).not.toBeNull()
      expect([it.layer, it.status, it.subject], type).toEqual(['L1', 'Open', 'Fire stopping'])
      expect(it.fields, type).toEqual({ Trade: 'Joinery', Cost: '12' })
    }
  })
  it('leaves an item without details exactly as before', () => {
    const it = normalizeItem({ ...base, type: 'sticky' })!
    for (const k of ['layer', 'status', 'subject', 'fields']) expect(k in it, k).toBe(false)
  })
  it('bounds and cleans hostile values', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, 'v']))
    const it = normalizeItem({ ...base, type: 'shape', layer: 'x'.repeat(200), status: 'y'.repeat(200), subject: { a: 1 }, fields: { ...many, big: 'z'.repeat(2000) } })!
    expect(it.layer!.length).toBe(64)
    expect(it.status!.length).toBe(80)
    expect(it.subject).toBeUndefined()
    expect(Object.keys(it.fields!).length).toBe(20)
    const odd = normalizeItem({ ...base, type: 'shape', fields: JSON.parse('{"__proto__":"x","constructor":"y","  ":"z","Empty":"","List":["a"],"Ok":"<b>kept as text</b>"}') })!
    expect(odd.fields).toEqual({ Ok: '<b>kept as text</b>' })
    expect(normalizeItem({ ...base, type: 'shape', fields: ['a'] })!.fields).toBeUndefined()
    expect(normalizeItem({ ...base, type: 'shape', fields: 'a' })!.fields).toBeUndefined()
  })
  it('keeps a card status where it always was', () => {
    const it = normalizeItem({ ...base, type: 'card', title: 'Snag', status: 'Needs you' })!
    expect(it.status).toBe('Needs you')
  })
})

describe('board-wide lists', () => {
  it('reads safe lists from whatever the settings hold', () => {
    expect(layersOf(undefined)).toEqual([])
    expect(layersOf({ layers: 'x' } as never)).toEqual([])
    const layers = layersOf({ layers: [{ id: 'a', name: ' Structure ', color: 'red; background:url(x)' }, { id: 'a', name: 'Dup' }, { id: '', name: 'No id' }, null, { id: 'b', name: 'MEP', color: '#30a46c' }] } as never)
    expect(layers.map((l) => [l.id, l.name])).toEqual([['a', 'Structure'], ['b', 'MEP']])
    expect(layers[0].color).toMatch(/^#[0-9a-f]{6}$/)
    expect(statusesOf({})).toBe(DEFAULT_STATUSES)
    expect(statusesOf({ statuses: [{ name: 'Snag', color: '#e5484d' }, { name: 'snag', color: '#000' }, { name: '' }] } as never).map((s) => s.name)).toEqual(['Snag'])
    expect(statusesOf({ statuses: [] })).toEqual([])
    expect(fieldsOf({ fields: ['Trade', 'trade', 5, ' Cost code '] } as never)).toEqual(['Trade', 'Cost code'])
  })
  it('colours a listed status and leaves free text grey', () => {
    expect(statusColor('closed', DEFAULT_STATUSES)).toBe('#30a46c')
    expect(statusColor('Needs you', DEFAULT_STATUSES)).toBe('#6b6f7a')
  })
  it('adds, renames away and removes layers, statuses and fields', () => {
    const a = addLayer('Structure')!, again = addLayer('structure')!
    expect(again.id).toBe(a.id)
    expect(layersOf(S().meta!.settings).length).toBe(1)
    expect(addLayer('   ')).toBeNull()
    expect(addField('Trade')).toBe('Trade')
    expect(addField('__proto__')).toBeNull()
    expect(fieldsOf(S().meta!.settings)).toEqual(['Trade'])
    removeField('Trade')
    expect(fieldsOf(S().meta!.settings)).toEqual([])
    setStatuses([{ name: 'Snag', color: '#e5484d' }])
    expect(statusesOf(S().meta!.settings).map((s) => s.name)).toEqual(['Snag'])
  })
  it('travels with the items: only the lists, never the timer or voting', () => {
    expect(sharedLists({ timer: { endsAt: 1, duration: 60 }, voting: { open: true, max: 3 } })).toEqual({})
    const lists = sharedLists({ timer: { endsAt: 1, duration: 60 }, layers: [{ id: 'a', name: 'Structure', color: '#30a46c' }], statuses: [], fields: ['Trade'] })
    expect(lists).toEqual({ layers: [{ id: 'a', name: 'Structure', color: '#30a46c' }], statuses: [], fields: ['Trade'] })
  })
  it('takes in the lists of an opened board file without losing its own', () => {
    const mine = addLayer('Structure')!
    addField('Trade')
    adoptLists({ layers: [{ id: 'theirs', name: 'MEP', color: '#0090ff' }, { id: mine.id, name: 'Renamed elsewhere', color: '#000000' }], fields: ['trade', 'Cost code'], statuses: [{ name: 'X', color: '#000000' }] })
    expect(layersOf(S().meta!.settings).map((l) => [l.id, l.name])).toEqual([[mine.id, 'Structure'], ['theirs', 'MEP']])
    expect(fieldsOf(S().meta!.settings)).toEqual(['Trade', 'Cost code'])
    expect(S().meta!.settings.statuses).toBeUndefined()
    adoptLists('junk'); adoptLists(null); adoptLists({ layers: 'x' })
    expect(layersOf(S().meta!.settings).length).toBe(2)
  })
  it('lets nobody but an editor change them', () => {
    useBoard.setState({ role: 'viewer' })
    expect(addLayer('Structure')).toBeNull()
    expect(addField('Trade')).toBeNull()
    expect(S().meta!.settings).toEqual({})
  })
})

describe('details on items', () => {
  const two = () => { const a = make.sticky({ x: 0, y: 0 }), b = make.shape({ x: 400, y: 0 }); addItems([a, b]); return [a.id, b.id] }
  it('sets a status on the whole selection as one undo step, and clears it', () => {
    const ids = two()
    useBoard.setState({ selection: ids })
    setDetail('status', 'Open')
    expect(ids.map((id) => S().items[id].status)).toEqual(['Open', 'Open'])
    setDetail('status', '')
    expect(ids.every((id) => !('status' in S().items[id]))).toBe(true)
    undo()
    expect(ids.map((id) => S().items[id].status)).toEqual(['Open', 'Open'])
    undo()
    expect(ids.every((id) => !S().items[id].status)).toBe(true)
  })
  it('sets and removes one custom field without touching the others', () => {
    const ids = two()
    setField('Trade', 'Joinery', ids)
    setField('Cost code', 'C-12', ids)
    setField('Trade', '', [ids[0]])
    expect(S().items[ids[0]].fields).toEqual({ 'Cost code': 'C-12' })
    expect(S().items[ids[1]].fields).toEqual({ Trade: 'Joinery', 'Cost code': 'C-12' })
    setField('Cost code', '', [ids[0]])
    expect('fields' in S().items[ids[0]]).toBe(false)
  })
  it('leaves locked items and comment pins alone', () => {
    const a = make.sticky({ x: 0, y: 0 })
    addItems([{ ...a, locked: true } as Item])
    setDetail('subject', 'Doors', [a.id])
    expect(S().items[a.id].subject).toBeUndefined()
  })
  it('reports the shared value of a selection, or that it is mixed', () => {
    const list = [{ status: 'Open' }, { status: 'Open' }] as Item[]
    expect(common(list, (i) => i.status)).toBe('Open')
    expect(common([...list, {} as Item], (i) => i.status)).toBeNull()
    expect(common([{} as Item, {} as Item], (i) => i.status)).toBe('')
  })
})

describe('hiding a layer', () => {
  const setup = () => {
    const layer = addLayer('Structure')!
    const a = make.sticky({ x: 0, y: 0 }), b = make.sticky({ x: 400, y: 0 })
    addItems([a, b])
    setDetail('layer', layer.id, [a.id])
    return { layer, a: a.id, b: b.id }
  }
  it('takes its items out of selecting and out of pictures, for this person only', () => {
    const { layer, a, b } = setup()
    useBoard.setState({ selection: [a, b], editingId: a })
    setLayerHidden(layer.id, true)
    expect(isHidden(S().items[a])).toBe(true)
    expect(S().selection).toEqual([b])
    expect(S().editingId).toBeNull()
    selectAll()
    expect(S().selection).toEqual([b])
    expect(exportArea('all')!.ids).toEqual([b])
    // the item itself is unchanged: nothing about hiding is written to the board
    expect(S().items[a].layer).toBe(layer.id)
    expect(S().meta!.settings.layers!.length).toBe(1)
    setLayerHidden(layer.id, false)
    expect(exportArea('all')!.ids.sort()).toEqual([a, b].sort())
  })
  it('is remembered per board on this device', () => {
    const { layer } = setup()
    setLayerHidden(layer.id, true)
    resetBoard({ boardId: 'local-other', role: 'owner', status: 'ready', meta: { ...meta(), id: 'local-other' } })
    expect(S().hiddenLayers).toEqual([])
    resetBoard({ boardId: BOARD, role: 'owner', status: 'ready', meta: meta() })
    expect(S().hiddenLayers).toEqual([layer.id])
  })
  it('never hides anything for a layer that no longer exists', () => {
    const { a } = setup()
    expect(isHidden({ ...S().items[a], layer: 'gone' } as Item, [])).toBe(false)
    setLayerHidden('gone', true)
    expect(S().hiddenLayers).toEqual([])
  })
  it('deleting a layer keeps its items, on no layer, and shows them again', () => {
    const { layer, a } = setup()
    setLayerHidden(layer.id, true)
    removeLayer(layer.id)
    expect('layer' in S().items[a]).toBe(false)
    expect(S().hiddenLayers).toEqual([])
    expect(layersOf(S().meta!.settings)).toEqual([])
  })
})
