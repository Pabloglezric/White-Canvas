import { beforeEach, describe, expect, it } from 'vitest'
import { make } from '../../src/board/defaults'
import { S, apply, applyRemote, commit, mutate, redo, resetBoard, rollback, undo, useBoard } from '../../src/board/store'
import { addItems, cloneItems, groupSelection, moveSet, removeItems } from '../../src/board/ops'
import type { ConnectorItem, Item } from '../../src/board/types'

beforeEach(() => resetBoard({ boardId: 'local-test', role: 'owner', status: 'ready' }))

describe('history', () => {
  it('undoes and redoes an add', () => {
    const s = make.sticky({ x: 0, y: 0 })
    apply({ [s.id]: s })
    expect(S().items[s.id].rev).toBe(1)
    undo()
    expect(S().items[s.id]).toBeUndefined()
    redo()
    expect(S().items[s.id]).toBeDefined()
    expect(S().items[s.id].rev).toBeGreaterThan(1)
  })
  it('groups a whole gesture into one undo step', () => {
    const s = make.sticky({ x: 0, y: 0 })
    apply({ [s.id]: s })
    for (let i = 1; i <= 20; i++) mutate({ [s.id]: { ...S().items[s.id], x: i * 5 } })
    commit()
    expect(S().items[s.id].x).toBe(100)
    undo()
    expect(S().items[s.id].x).toBe(0)
  })
  it('rollback discards an unfinished gesture', () => {
    const s = make.sticky({ x: 0, y: 0 })
    apply({ [s.id]: s })
    mutate({ [s.id]: { ...S().items[s.id], x: 999 } })
    rollback()
    expect(S().items[s.id].x).toBe(0)
    expect(S().undo.length).toBe(1)
  })
})

describe('merging remote changes', () => {
  it('accepts newer revisions and ignores older ones', () => {
    const s = make.sticky({ x: 0, y: 0 })
    apply({ [s.id]: s })
    applyRemote([{ ...S().items[s.id], x: 50, rev: 5 } as Item], [])
    expect(S().items[s.id].x).toBe(50)
    applyRemote([{ ...S().items[s.id], x: 7, rev: 2 } as Item], [])
    expect(S().items[s.id].x).toBe(50)
  })
  it('does not resurrect a deleted item from a stale update', () => {
    const s = make.sticky({ x: 0, y: 0 })
    apply({ [s.id]: s })
    const stale = { ...S().items[s.id] } as Item
    apply({ [s.id]: null })
    applyRemote([stale], [])
    expect(S().items[s.id]).toBeUndefined()
  })
  it('removes items deleted elsewhere and clears them from the selection', () => {
    const s = make.sticky({ x: 0, y: 0 })
    apply({ [s.id]: s })
    useBoard.setState({ selection: [s.id] })
    applyRemote([], [{ id: s.id, rev: 9 }])
    expect(S().items[s.id]).toBeUndefined()
    expect(S().selection).toEqual([])
  })
})

describe('operations', () => {
  it('detaches connectors when their target is deleted', () => {
    const a = make.shape({ x: 0, y: 0 }), b = make.shape({ x: 400, y: 0 })
    const c = make.connector({ item: a.id, x: 0, y: 0 }, { item: b.id, x: 0, y: 0 })
    addItems([a, b, c])
    removeItems([b.id])
    const left = S().items[c.id] as ConnectorItem
    expect(left.b.item).toBeUndefined()
    expect(Number.isFinite(left.b.x)).toBe(true)
    undo()
    expect((S().items[c.id] as ConnectorItem).b.item).toBe(b.id)
  })
  it('moves frame children and group members together', () => {
    const f = make.frame({ x: 0, y: 0 })
    const s1 = make.sticky({ x: 50, y: 50 }), s2 = make.sticky({ x: 2000, y: 0 }), s3 = make.sticky({ x: 2300, y: 0 })
    addItems([f, s1, s2, s3])
    expect(S().items[s1.id].parent).toBe(f.id)
    expect(moveSet([f.id]).sort()).toEqual([f.id, s1.id].sort())
    useBoard.setState({ selection: [s2.id, s3.id] })
    groupSelection()
    expect(moveSet([s2.id]).sort()).toEqual([s2.id, s3.id].sort())
  })
  it('clones with fresh ids and remapped connector ends', () => {
    const a = make.shape({ x: 0, y: 0 }), b = make.shape({ x: 400, y: 0 })
    const c = make.connector({ item: a.id, x: 0, y: 0 }, { item: b.id, x: 0, y: 0 })
    const copy = cloneItems([a, b, c], 10, 10)
    const ids = new Set(copy.map((i) => i.id))
    expect(ids.has(a.id) || ids.has(b.id) || ids.has(c.id)).toBe(false)
    const cc = copy.find((i) => i.type === 'connector') as ConnectorItem
    expect(ids.has(cc.a.item!)).toBe(true)
    expect(ids.has(cc.b.item!)).toBe(true)
  })
})
