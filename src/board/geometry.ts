import type { Box, Camera, ConnEnd, ConnectorItem, Item, Pt, ShapeKind } from './types'

export const rad = (deg: number) => (deg * Math.PI) / 180

export function rotatePt(p: Pt, c: Pt, deg: number): Pt {
  if (!deg) return p
  const r = rad(deg)
  const cos = Math.cos(r), sin = Math.sin(r)
  const dx = p.x - c.x, dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

export const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** Axis-aligned bounds of a (possibly rotated) item. */
export function aabb(it: { x: number; y: number; w: number; h: number; rot?: number }): Box {
  if (!it.rot) return { x: it.x, y: it.y, w: it.w, h: it.h }
  const c = center(it)
  const pts = [
    rotatePt({ x: it.x, y: it.y }, c, it.rot),
    rotatePt({ x: it.x + it.w, y: it.y }, c, it.rot),
    rotatePt({ x: it.x + it.w, y: it.y + it.h }, c, it.rot),
    rotatePt({ x: it.x, y: it.y + it.h }, c, it.rot),
  ]
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export function unionBoxes(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const b of boxes) {
    if (b.x < x1) x1 = b.x
    if (b.y < y1) y1 = b.y
    if (b.x + b.w > x2) x2 = b.x + b.w
    if (b.y + b.h > y2) y2 = b.y + b.h
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

export const intersects = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
export const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
export const ptInBox = (p: Pt, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h

export const toWorld = (cam: Camera, sx: number, sy: number): Pt => ({ x: (sx - cam.x) / cam.z, y: (sy - cam.y) / cam.z })
export const toScreen = (cam: Camera, wx: number, wy: number): Pt => ({ x: wx * cam.z + cam.x, y: wy * cam.z + cam.y })

// ---------- connectors ----------

type Side = 'l' | 'r' | 't' | 'b'
const SIDE_DIR: Record<Side, Pt> = { l: { x: -1, y: 0 }, r: { x: 1, y: 0 }, t: { x: 0, y: -1 }, b: { x: 0, y: 1 } }

export interface ResolvedEnd { p: Pt; dir: Pt | null; box?: Box }

function sideOfAnchor(ax: number, ay: number): Side {
  const dl = ax, dr = 1 - ax, dt = ay, db = 1 - ay
  const m = Math.min(dl, dr, dt, db)
  return m === dl ? 'l' : m === dr ? 'r' : m === dt ? 't' : 'b'
}

function anchorPoint(it: Item, ax: number, ay: number): Pt {
  const p = { x: it.x + it.w * ax, y: it.y + it.h * ay }
  return rotatePt(p, center(it), it.rot || 0)
}

function refPoint(end: ConnEnd, items: Record<string, Item>): Pt {
  const it = end.item ? items[end.item] : undefined
  if (it && it.type !== 'connector') {
    if (end.ax != null && end.ay != null) return anchorPoint(it, end.ax, end.ay)
    return center(it)
  }
  return { x: end.x, y: end.y }
}

function resolveEnd(end: ConnEnd, other: Pt, items: Record<string, Item>): ResolvedEnd {
  const it = end.item ? items[end.item] : undefined
  if (!it || it.type === 'connector') return { p: { x: end.x, y: end.y }, dir: null }
  if (end.ax != null && end.ay != null) {
    const side = sideOfAnchor(end.ax, end.ay)
    const d = rotatePt(SIDE_DIR[side], { x: 0, y: 0 }, it.rot || 0)
    return { p: anchorPoint(it, end.ax, end.ay), dir: d, box: aabb(it) }
  }
  // Auto: use the side that faces the other end.
  const c = center(it)
  const local = rotatePt(other, c, -(it.rot || 0))
  const dx = local.x - c.x, dy = local.y - c.y
  let side: Side
  if (Math.abs(dx) * it.h > Math.abs(dy) * it.w) side = dx > 0 ? 'r' : 'l'
  else side = dy > 0 ? 'b' : 't'
  const a = side === 'l' ? [0, 0.5] : side === 'r' ? [1, 0.5] : side === 't' ? [0.5, 0] : [0.5, 1]
  return { p: anchorPoint(it, a[0], a[1]), dir: rotatePt(SIDE_DIR[side], { x: 0, y: 0 }, it.rot || 0), box: aabb(it) }
}

export interface ConnGeom {
  pts: Pt[] // polyline (straight/elbow) or [p1, c1, c2, p2] for curve
  d: string
  mid: Pt
  tanA: Pt // direction pointing out of the path at the start (for caps)
  tanB: Pt
  box: Box
}

function norm(p: Pt): Pt {
  const l = Math.hypot(p.x, p.y) || 1
  return { x: p.x / l, y: p.y / l }
}

function inferDir(from: Pt, to: Pt): Pt {
  const dx = to.x - from.x, dy = to.y - from.y
  return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) || 1 }
}

function axisDir(d: Pt): Pt {
  return Math.abs(d.x) >= Math.abs(d.y) ? { x: Math.sign(d.x) || 1, y: 0 } : { x: 0, y: Math.sign(d.y) || 1 }
}

function elbow(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt[] {
  const m = 18
  const s = { x: p1.x + d1.x * m, y: p1.y + d1.y * m }
  const e = { x: p2.x + d2.x * m, y: p2.y + d2.y * m }
  const h1 = d1.x !== 0, h2 = d2.x !== 0
  let midPts: Pt[]
  if (h1 && h2) {
    const facing = d1.x !== d2.x && (e.x - s.x) * d1.x >= 0
    if (facing) { const mx = (s.x + e.x) / 2; midPts = [{ x: mx, y: s.y }, { x: mx, y: e.y }] }
    else if (d1.x === d2.x) { const ex = d1.x > 0 ? Math.max(s.x, e.x) : Math.min(s.x, e.x); midPts = [{ x: ex, y: s.y }, { x: ex, y: e.y }] }
    else { const my = (s.y + e.y) / 2; midPts = [{ x: s.x, y: my }, { x: e.x, y: my }] }
  } else if (!h1 && !h2) {
    const facing = d1.y !== d2.y && (e.y - s.y) * d1.y >= 0
    if (facing) { const my = (s.y + e.y) / 2; midPts = [{ x: s.x, y: my }, { x: e.x, y: my }] }
    else if (d1.y === d2.y) { const ey = d1.y > 0 ? Math.max(s.y, e.y) : Math.min(s.y, e.y); midPts = [{ x: s.x, y: ey }, { x: e.x, y: ey }] }
    else { const mx = (s.x + e.x) / 2; midPts = [{ x: mx, y: s.y }, { x: mx, y: e.y }] }
  } else if (h1) {
    // horizontal out, vertical in
    const ok = (e.x - s.x) * d1.x >= 0 && (s.y - e.y) * d2.y >= 0
    midPts = ok ? [{ x: e.x, y: s.y }] : [{ x: s.x, y: e.y }]
  } else {
    const ok = (e.y - s.y) * d1.y >= 0 && (s.x - e.x) * d2.x >= 0
    midPts = ok ? [{ x: s.x, y: e.y }] : [{ x: e.x, y: s.y }]
  }
  const raw = [p1, s, ...midPts, e, p2]
  // drop duplicates and collinear points
  const out: Pt[] = []
  for (const p of raw) {
    const a = out[out.length - 1]
    if (a && Math.abs(a.x - p.x) < 0.5 && Math.abs(a.y - p.y) < 0.5) continue
    const b = out[out.length - 2]
    if (a && b && ((Math.abs(a.x - b.x) < 0.5 && Math.abs(p.x - a.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(p.y - a.y) < 0.5))) out[out.length - 1] = p
    else out.push(p)
  }
  return out
}

function roundedPath(pts: Pt[], r: number): string {
  if (pts.length < 3) return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1]
    const l1 = Math.hypot(p1.x - p0.x, p1.y - p0.y), l2 = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const rr = Math.min(r, l1 / 2, l2 / 2)
    const a = { x: p1.x - ((p1.x - p0.x) / (l1 || 1)) * rr, y: p1.y - ((p1.y - p0.y) / (l1 || 1)) * rr }
    const b = { x: p1.x + ((p2.x - p1.x) / (l2 || 1)) * rr, y: p1.y + ((p2.y - p1.y) / (l2 || 1)) * rr }
    d += ` L${a.x},${a.y} Q${p1.x},${p1.y} ${b.x},${b.y}`
  }
  const last = pts[pts.length - 1]
  return d + ` L${last.x},${last.y}`
}

function polyMid(pts: Pt[]): Pt {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  let half = total / 2
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    if (half <= l) {
      const t = l ? half / l : 0
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }
    }
    half -= l
  }
  return pts[0]
}

export function connectorGeom(c: ConnectorItem, items: Record<string, Item>): ConnGeom {
  const refA = refPoint(c.a, items), refB = refPoint(c.b, items)
  const A = resolveEnd(c.a, refB, items)
  const B = resolveEnd(c.b, refA, items)
  const p1 = A.p, p2 = B.p
  let pts: Pt[]
  let d: string
  let mid: Pt
  let tanA: Pt, tanB: Pt
  if (c.route === 'elbow') {
    const d1 = axisDir(A.dir || inferDir(p1, p2))
    const d2 = axisDir(B.dir || inferDir(p2, p1))
    pts = elbow(p1, d1, p2, d2)
    d = roundedPath(pts, 10)
    mid = polyMid(pts)
    tanA = norm({ x: pts[0].x - pts[1].x, y: pts[0].y - pts[1].y })
    const n = pts.length
    tanB = norm({ x: pts[n - 1].x - pts[n - 2].x, y: pts[n - 1].y - pts[n - 2].y })
  } else if (c.route === 'curve') {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
    const k = Math.max(30, Math.min(dist * 0.45, 240))
    const d1 = A.dir || inferDir(p1, p2)
    const d2 = B.dir || inferDir(p2, p1)
    const c1 = { x: p1.x + d1.x * k, y: p1.y + d1.y * k }
    const c2 = { x: p2.x + d2.x * k, y: p2.y + d2.y * k }
    pts = [p1, c1, c2, p2]
    d = `M${p1.x},${p1.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${p2.x},${p2.y}`
    mid = { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 }
    tanA = norm({ x: p1.x - c1.x, y: p1.y - c1.y })
    tanB = norm({ x: p2.x - c2.x, y: p2.y - c2.y })
  } else {
    pts = [p1, p2]
    d = `M${p1.x},${p1.y} L${p2.x},${p2.y}`
    mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
    tanA = norm({ x: p1.x - p2.x, y: p1.y - p2.y })
    tanB = norm({ x: p2.x - p1.x, y: p2.y - p1.y })
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const x = Math.min(...xs), y = Math.min(...ys)
  return { pts, d, mid, tanA, tanB, box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y } }
}

/** Bounds used for culling, selection and export; connectors derive theirs from their ends. */
export function itemBox(it: Item, items: Record<string, Item>): Box {
  if (it.type === 'connector') return connectorGeom(it, items).box
  return aabb(it)
}

export function capPath(kind: string, tip: Pt, tan: Pt, size: number): { d: string; fill: boolean } | null {
  if (kind === 'none') return null
  const nx = -tan.y, ny = tan.x
  const back = { x: tip.x - tan.x * size, y: tip.y - tan.y * size }
  const w = size * 0.5
  switch (kind) {
    case 'arrow':
      return { d: `M${back.x + nx * w},${back.y + ny * w} L${tip.x},${tip.y} L${back.x - nx * w},${back.y - ny * w}`, fill: false }
    case 'triangle':
      return { d: `M${back.x + nx * w},${back.y + ny * w} L${tip.x},${tip.y} L${back.x - nx * w},${back.y - ny * w} Z`, fill: true }
    case 'diamond': {
      const m = { x: tip.x - tan.x * size * 0.6, y: tip.y - tan.y * size * 0.6 }
      const far = { x: tip.x - tan.x * size * 1.2, y: tip.y - tan.y * size * 1.2 }
      return { d: `M${tip.x},${tip.y} L${m.x + nx * w * 0.8},${m.y + ny * w * 0.8} L${far.x},${far.y} L${m.x - nx * w * 0.8},${m.y - ny * w * 0.8} Z`, fill: true }
    }
    case 'dot': {
      const r = size * 0.35
      const c = { x: tip.x - tan.x * r, y: tip.y - tan.y * r }
      return { d: `M${c.x - r},${c.y} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0 Z`, fill: true }
    }
    case 'bar':
      return { d: `M${tip.x + nx * w},${tip.y + ny * w} L${tip.x - nx * w},${tip.y - ny * w}`, fill: false }
  }
  return null
}

// ---------- shapes ----------

export function shapePath(kind: ShapeKind, w: number, h: number): string {
  const p = (pts: number[][]) => 'M' + pts.map((q) => `${q[0]},${q[1]}`).join(' L') + ' Z'
  switch (kind) {
    case 'rect': return `M0,0 H${w} V${h} H0 Z`
    case 'round': {
      const r = Math.min(16, w / 2, h / 2)
      return `M${r},0 H${w - r} Q${w},0 ${w},${r} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} V${r} Q0,0 ${r},0 Z`
    }
    case 'pill': {
      const r = Math.min(w, h) / 2
      return `M${r},0 H${w - r} A${r},${r} 0 0 1 ${w - r},${h} H${r} A${r},${r} 0 0 1 ${r},0 Z`
    }
    case 'ellipse': return `M0,${h / 2} A${w / 2},${h / 2} 0 1 1 ${w},${h / 2} A${w / 2},${h / 2} 0 1 1 0,${h / 2} Z`
    case 'diamond': return p([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]])
    case 'triangle': return p([[w / 2, 0], [w, h], [0, h]])
    case 'parallelogram': { const o = Math.min(w * 0.2, h * 0.5); return p([[o, 0], [w, 0], [w - o, h], [0, h]]) }
    case 'trapezoid': { const o = Math.min(w * 0.18, h * 0.5); return p([[o, 0], [w - o, 0], [w, h], [0, h]]) }
    case 'hexagon': { const o = Math.min(w * 0.22, h * 0.5); return p([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]) }
    case 'pentagon': return p([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]])
    case 'octagon': { const ox = w * 0.29, oy = h * 0.29; return p([[ox, 0], [w - ox, 0], [w, oy], [w, h - oy], [w - ox, h], [ox, h], [0, h - oy], [0, oy]]) }
    case 'star': {
      const pts: number[][] = []
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.4 : 1
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        pts.push([w / 2 + (Math.cos(a) * r * w) / 2, h / 2 + (Math.sin(a) * r * h) / 2])
      }
      return p(pts)
    }
    case 'cross': { const a = w / 3, b = h / 3; return p([[a, 0], [2 * a, 0], [2 * a, b], [w, b], [w, 2 * b], [2 * a, 2 * b], [2 * a, h], [a, h], [a, 2 * b], [0, 2 * b], [0, b], [a, b]]) }
    case 'arrowRight': { const t = h * 0.25, hd = Math.min(w * 0.4, h * 0.6); return p([[0, t], [w - hd, t], [w - hd, 0], [w, h / 2], [w - hd, h], [w - hd, h - t], [0, h - t]]) }
    case 'arrowLeft': { const t = h * 0.25, hd = Math.min(w * 0.4, h * 0.6); return p([[w, t], [hd, t], [hd, 0], [0, h / 2], [hd, h], [hd, h - t], [w, h - t]]) }
    case 'cylinder': {
      const ry = Math.min(h * 0.14, 22)
      return `M0,${ry} A${w / 2},${ry} 0 0 1 ${w},${ry} V${h - ry} A${w / 2},${ry} 0 0 1 0,${h - ry} Z M0,${ry} A${w / 2},${ry} 0 0 0 ${w},${ry}`
    }
    case 'document': {
      const c = h * 0.12
      return `M0,0 H${w} V${h - c} C${w * 0.75},${h - c * 2.2} ${w * 0.55},${h - c * 1.6} ${w * 0.5},${h - c} C${w * 0.4},${h + c * 0.2} ${w * 0.2},${h + c * 0.4} 0,${h - c} Z`
    }
    case 'predefined': { const o = Math.min(w * 0.1, 16); return `M0,0 H${w} V${h} H0 Z M${o},0 V${h} M${w - o},0 V${h}` }
    case 'callout': {
      const r = Math.min(14, w / 4, h / 4), bh = h * 0.8
      return `M${r},0 H${w - r} Q${w},0 ${w},${r} V${bh - r} Q${w},${bh} ${w - r},${bh} H${w * 0.38} L${w * 0.2},${h} L${w * 0.24},${bh} H${r} Q0,${bh} 0,${bh - r} V${r} Q0,0 ${r},0 Z`
    }
    case 'cloud': {
      const x = (v: number) => v * w, y = (v: number) => v * h
      return `M${x(0.25)},${y(0.85)} C${x(0.02)},${y(0.88)} ${x(-0.02)},${y(0.5)} ${x(0.18)},${y(0.45)} C${x(0.12)},${y(0.15)} ${x(0.42)},${y(0.05)} ${x(0.52)},${y(0.25)} C${x(0.62)},${y(0.02)} ${x(0.95)},${y(0.12)} ${x(0.84)},${y(0.45)} C${x(1.04)},${y(0.5)} ${x(1.0)},${y(0.88)} ${x(0.78)},${y(0.85)} Z`
    }
  }
  return `M0,0 H${w} V${h} H0 Z`
}

/** Padding (fractions of w/h) that keeps text inside the visible part of a shape. */
export function shapeInset(kind: ShapeKind): [number, number] {
  switch (kind) {
    case 'ellipse': return [0.14, 0.14]
    case 'diamond': return [0.24, 0.24]
    case 'triangle': return [0.26, 0.3]
    case 'hexagon': case 'parallelogram': case 'trapezoid': return [0.18, 0.08]
    case 'star': return [0.3, 0.32]
    case 'cloud': return [0.18, 0.22]
    case 'arrowRight': case 'arrowLeft': return [0.12, 0.26]
    case 'octagon': case 'pentagon': return [0.16, 0.16]
    case 'cross': return [0.34, 0.1]
    default: return [0.04, 0.04]
  }
}

// ---------- ink ----------

/** SVG path for a freehand outline polygon produced by perfect-freehand. */
export function strokeToPath(stroke: number[][]): string {
  if (!stroke.length) return ''
  const d: (string | number)[] = ['M', stroke[0][0].toFixed(1), stroke[0][1].toFixed(1), 'Q']
  for (let i = 0; i < stroke.length; i++) {
    const [x0, y0] = stroke[i]
    const [x1, y1] = stroke[(i + 1) % stroke.length]
    d.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1))
  }
  d.push('Z')
  return d.join(' ')
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

// ---------- snapping ----------

export interface Guide { x1: number; y1: number; x2: number; y2: number }

/** Snap a moving box against other boxes' edges and centres. Returns the delta to apply plus guides. */
export function snapBox(moving: Box, others: Box[], tol: number): { dx: number; dy: number; guides: Guide[] } {
  const mx = [moving.x, moving.x + moving.w / 2, moving.x + moving.w]
  const my = [moving.y, moving.y + moving.h / 2, moving.y + moving.h]
  let bestX: { d: number; at: number; o: Box } | null = null
  let bestY: { d: number; at: number; o: Box } | null = null
  for (const o of others) {
    const ox = [o.x, o.x + o.w / 2, o.x + o.w]
    const oy = [o.y, o.y + o.h / 2, o.y + o.h]
    for (const a of mx) for (const b of ox) {
      const d = b - a
      if (Math.abs(d) <= tol && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: b, o }
    }
    for (const a of my) for (const b of oy) {
      const d = b - a
      if (Math.abs(d) <= tol && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: b, o }
    }
  }
  const guides: Guide[] = []
  const dx = bestX ? bestX.d : 0, dy = bestY ? bestY.d : 0
  const m = { x: moving.x + dx, y: moving.y + dy, w: moving.w, h: moving.h }
  if (bestX) guides.push({ x1: bestX.at, x2: bestX.at, y1: Math.min(m.y, bestX.o.y), y2: Math.max(m.y + m.h, bestX.o.y + bestX.o.h) })
  if (bestY) guides.push({ y1: bestY.at, y2: bestY.at, x1: Math.min(m.x, bestY.o.x), x2: Math.max(m.x + m.w, bestY.o.x + bestY.o.w) })
  return { dx, dy, guides }
}
