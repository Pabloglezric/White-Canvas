import { describe, expect, it } from 'vitest'
import { aabb, capPath, connectorGeom, rotatePt, shapePath, snapBox, toScreen, toWorld } from '../../src/board/geometry'
import { SHAPE_KINDS, make } from '../../src/board/defaults'
import type { Item } from '../../src/board/types'

const finite = (s: string) => !/NaN|Infinity|undefined/.test(s)

describe('rotation and bounds', () => {
  it('rotates a point a quarter turn around a centre', () => {
    const p = rotatePt({ x: 10, y: 0 }, { x: 0, y: 0 }, 90)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(10)
  })
  it('gives rotated items a larger axis-aligned box', () => {
    const b = aabb({ x: 0, y: 0, w: 100, h: 20, rot: 90 })
    expect(b.w).toBeCloseTo(20)
    expect(b.h).toBeCloseTo(100)
    expect(b.x + b.w / 2).toBeCloseTo(50)
  })
  it('converts between screen and world consistently', () => {
    const cam = { x: 120, y: -40, z: 0.37 }
    const w = toWorld(cam, 500, 300)
    const s = toScreen(cam, w.x, w.y)
    expect(s.x).toBeCloseTo(500)
    expect(s.y).toBeCloseTo(300)
  })
})

describe('shape outlines', () => {
  it.each(SHAPE_KINDS.map((k) => k.kind))('%s produces a finite path at normal and tiny sizes', (kind) => {
    expect(finite(shapePath(kind, 160, 100))).toBe(true)
    expect(finite(shapePath(kind, 1, 1))).toBe(true)
    expect(finite(shapePath(kind, 0, 0))).toBe(true)
  })
})

describe('connectors', () => {
  const a = make.shape({ x: 0, y: 0, w: 100, h: 60 })
  const b = make.shape({ x: 400, y: 200, w: 100, h: 60 })
  const items: Record<string, Item> = { [a.id]: a, [b.id]: b }
  for (const route of ['straight', 'elbow', 'curve'] as const) {
    it(`${route}: joins facing sides and stays finite`, () => {
      const c = make.connector({ item: a.id, x: 0, y: 0 }, { item: b.id, x: 0, y: 0 }, { route })
      const g = connectorGeom(c, items)
      expect(finite(g.d)).toBe(true)
      expect(g.pts[0].x).toBeCloseTo(100) // leaves from the right side of a
      expect(g.pts[g.pts.length - 1].x).toBeCloseTo(400) // enters the left side of b
      expect(g.box.w).toBeGreaterThan(0)
    })
  }
  it('elbow routes only use horizontal and vertical segments', () => {
    const c = make.connector({ item: a.id, x: 0, y: 0 }, { item: b.id, x: 0, y: 0 }, { route: 'elbow' })
    const { pts } = connectorGeom(c, items)
    for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i].x - pts[i - 1].x) < 0.01 || Math.abs(pts[i].y - pts[i - 1].y) < 0.01).toBe(true)
  })
  it('falls back to the stored point when the attached item is gone', () => {
    const c = make.connector({ item: 'missing', x: 5, y: 6 }, { x: 50, y: 60 })
    const g = connectorGeom(c, {})
    expect(g.pts[0]).toEqual({ x: 5, y: 6 })
  })
  it('handles both ends at the same point', () => {
    const c = make.connector({ x: 10, y: 10 }, { x: 10, y: 10 }, { route: 'elbow' })
    expect(finite(connectorGeom(c, {}).d)).toBe(true)
  })
  it('draws every arrowhead style', () => {
    for (const cap of ['arrow', 'triangle', 'dot', 'diamond', 'bar']) expect(finite(capPath(cap, { x: 0, y: 0 }, { x: 1, y: 0 }, 12)!.d)).toBe(true)
    expect(capPath('none', { x: 0, y: 0 }, { x: 1, y: 0 }, 12)).toBeNull()
  })
})

describe('snapping', () => {
  it('snaps a moving box to a neighbour edge within tolerance', () => {
    const r = snapBox({ x: 103, y: 0, w: 50, h: 50 }, [{ x: 100, y: 200, w: 80, h: 40 }], 6)
    expect(r.dx).toBe(-3)
    expect(r.guides.length).toBe(1)
  })
  it('leaves the box alone when nothing is near', () => {
    const r = snapBox({ x: 0, y: 0, w: 50, h: 50 }, [{ x: 500, y: 500, w: 80, h: 40 }], 6)
    expect(r.dx).toBe(0)
    expect(r.dy).toBe(0)
    expect(r.guides.length).toBe(0)
  })
})
