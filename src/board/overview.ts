// Overview renderer.
// When more items are on screen than the DOM can animate smoothly, the board is painted onto a single
// 2D canvas instead (exact z-order, simplified detail). Items are far too small to read at that point,
// so nothing of value is lost, and frame cost stays flat however large the board gets.
import { htmlToText } from '../lib/util'
import { resolveAsset } from './assets'
import { FONT_STACK, inkOn } from './defaults'
import { center, connectorGeom, distToSegment, rotatePt } from './geometry'
import type { Camera, ConnectorItem, DrawItem, Item, Pt } from './types'

/** Above this many visible items the board switches from DOM to the overview canvas. */
export const DOM_ITEM_LIMIT = 600
/** Going back to DOM needs clearly fewer items, so the two renderers do not flip back and forth while zooming. */
export const DOM_ITEM_RESUME = 460

export const DEFAULT_INK = '#1c1e23'
/** Default-coloured ink and text follow the theme so they stay readable on a dark canvas. */
export const themedInk = (color: string | undefined, dark: boolean) => (!color || color === DEFAULT_INK ? (dark ? '#f1f1ee' : DEFAULT_INK) : color)

// ---------- image thumbnails ----------

type Thumb = ImageBitmap | 'loading' | 'failed'
const thumbs = new Map<string, Thumb>()
let onThumb: (() => void) | null = null
export function setThumbListener(fn: (() => void) | null) { onThumb = fn }

function thumbFor(src: string): ImageBitmap | null {
  const hit = thumbs.get(src)
  if (hit) return typeof hit === 'string' ? null : hit
  thumbs.set(src, 'loading')
  if (thumbs.size > 400) {
    // drop the oldest entries; ImageBitmaps hold GPU/CPU memory until closed
    for (const [k, v] of thumbs) { if (thumbs.size <= 300) break; if (typeof v !== 'string') v.close(); thumbs.delete(k) }
  }
  ;(async () => {
    try {
      const url = await resolveAsset(src)
      if (!url) throw new Error('no url')
      const blob = await (await fetch(url)).blob()
      const full = await createImageBitmap(blob)
      const k = Math.min(1, 384 / Math.max(full.width, full.height))
      const small = k < 1 ? await createImageBitmap(full, { resizeWidth: Math.max(1, Math.round(full.width * k)), resizeHeight: Math.max(1, Math.round(full.height * k)), resizeQuality: 'medium' }) : full
      if (small !== full) full.close()
      thumbs.set(src, small)
      onThumb?.()
    } catch { thumbs.set(src, 'failed') }
  })()
  return null
}

// ---------- text ----------

const plainCache = new WeakMap<Item, string>()
function plain(it: Item & { html: string }): string {
  let t = plainCache.get(it)
  if (t === undefined) { t = it.html ? htmlToText(it.html).slice(0, 240) : ''; plainCache.set(it, t) }
  return t
}

const lineCache = new WeakMap<Item, string[]>()
function linesFor(ctx: CanvasRenderingContext2D, it: Item, text: string, maxW: number, maxLines: number): string[] {
  let lines = lineCache.get(it)
  if (lines) return lines
  lines = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word
      if (line && ctx.measureText(next).width > maxW) { lines.push(line); line = word; if (lines.length >= maxLines) break }
      else line = next
    }
    if (lines.length >= maxLines) break
    lines.push(line)
  }
  lineCache.set(it, lines)
  return lines
}

function drawText(ctx: CanvasRenderingContext2D, it: Item & { html: string; fontSize?: number; align?: string; bold?: boolean; font?: string }, color: string, pad: number, z: number, defaultSize: number, centred: boolean) {
  const size = it.fontSize || defaultSize
  const px = size * z
  const text = plain(it)
  if (!text) return
  if (px < 5.5) {
    // too small to read: hint at the text with a faint bar
    if (it.type === 'text') { ctx.globalAlpha = 0.3; ctx.fillStyle = color; ctx.fillRect(it.x, it.y + it.h * 0.3, Math.max(it.w * 0.85, 4), Math.max(it.h * 0.4, 1 / z)); ctx.globalAlpha = 1 }
    return
  }
  ctx.font = `${it.bold ? 700 : 400} ${size}px ${FONT_STACK[it.font || 'sans']}`
  ctx.fillStyle = color
  const maxW = Math.max(10, it.w - pad * 2)
  const lh = size * 1.3
  const lines = linesFor(ctx, it, text, maxW, Math.max(1, Math.floor((it.h - pad * 2) / lh) || 1))
  const align = it.align || (centred ? 'center' : 'left')
  ctx.textAlign = align as CanvasTextAlign
  ctx.textBaseline = 'middle'
  const x = align === 'left' ? it.x + pad : align === 'right' ? it.x + it.w - pad : it.x + it.w / 2
  let y = centred ? it.y + it.h / 2 - ((lines.length - 1) * lh) / 2 : it.y + pad + lh / 2
  for (const l of lines) { ctx.fillText(l, x, y, maxW); y += lh }
}

// ---------- painting ----------

function shapeOutline(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, w: number, h: number) {
  ctx.beginPath()
  switch (kind) {
    case 'ellipse': ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); break
    case 'diamond': ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h / 2); ctx.closePath(); break
    case 'triangle': ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); break
    case 'pill': case 'round': { const r = kind === 'pill' ? Math.min(w, h) / 2 : Math.min(16, w / 2, h / 2); ctx.roundRect(x, y, w, h, r); break }
    default: ctx.rect(x, y, w, h)
  }
}

function paintItem(ctx: CanvasRenderingContext2D, it: Item, items: Record<string, Item>, z: number, dark: boolean) {
  const hair = 1 / z
  if (it.type === 'connector') {
    const g = connectorGeom(it, items)
    ctx.beginPath()
    if (it.route === 'curve' && g.pts.length === 4) { ctx.moveTo(g.pts[0].x, g.pts[0].y); ctx.bezierCurveTo(g.pts[1].x, g.pts[1].y, g.pts[2].x, g.pts[2].y, g.pts[3].x, g.pts[3].y) }
    else { ctx.moveTo(g.pts[0].x, g.pts[0].y); for (let i = 1; i < g.pts.length; i++) ctx.lineTo(g.pts[i].x, g.pts[i].y) }
    ctx.strokeStyle = themedInk(it.stroke, dark)
    ctx.lineWidth = Math.max(it.strokeW, hair)
    ctx.stroke()
    return
  }
  const rotated = !!it.rot
  if (rotated) { const c = center(it); ctx.save(); ctx.translate(c.x, c.y); ctx.rotate((it.rot * Math.PI) / 180); ctx.translate(-c.x, -c.y) }
  switch (it.type) {
    case 'frame':
      if (it.fill !== 'transparent') { ctx.fillStyle = it.fill === '#ffffff' && dark ? '#24272e' : it.fill; ctx.fillRect(it.x, it.y, it.w, it.h) }
      ctx.strokeStyle = dark ? '#4a4e58' : '#c9c7c0'; ctx.lineWidth = hair; ctx.strokeRect(it.x, it.y, it.w, it.h)
      if (it.w * z > 70) {
        ctx.font = `600 ${13 / z}px ${FONT_STACK.sans}`; ctx.fillStyle = dark ? '#b3b6bf' : '#5b5f6a'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
        ctx.fillText(it.title, it.x, it.y - 5 / z, it.w)
      }
      break
    case 'sticky':
      ctx.fillStyle = it.fill; ctx.fillRect(it.x, it.y, it.w, it.h)
      drawText(ctx, it, it.color || inkOn(it.fill), it.w * 0.07, z, 18, true)
      break
    case 'text':
      if (it.fill) { ctx.fillStyle = it.fill; ctx.fillRect(it.x, it.y, it.w, it.h) }
      drawText(ctx, it, it.fill ? it.color || inkOn(it.fill) : themedInk(it.color, dark), 4, z, 20, false)
      break
    case 'shape': {
      shapeOutline(ctx, it.kind, it.x, it.y, it.w, it.h)
      if (it.opacity != null) ctx.globalAlpha = it.opacity
      if (it.fill !== 'transparent') { ctx.fillStyle = it.fill; ctx.fill() }
      if (it.strokeW) { ctx.strokeStyle = it.fill === 'transparent' ? themedInk(it.stroke, dark) : it.stroke; ctx.lineWidth = Math.max(it.strokeW, hair); ctx.stroke() }
      ctx.globalAlpha = 1
      drawText(ctx, it, it.color || (it.fill === 'transparent' ? themedInk(undefined, dark) : inkOn(it.fill)), Math.min(it.w, it.h) * 0.1, z, 16, true)
      break
    }
    case 'draw': {
      const d = it as DrawItem
      const n = d.pts.length / 3
      const step = Math.max(1, Math.floor(n / 40)) * 3
      const sx = d.w / (d.w0 || 1), sy = d.h / (d.h0 || 1)
      ctx.beginPath()
      ctx.moveTo(d.x + d.pts[0] * sx, d.y + d.pts[1] * sy)
      for (let i = step; i < d.pts.length; i += step) ctx.lineTo(d.x + d.pts[i] * sx, d.y + d.pts[i + 1] * sy)
      const last = d.pts.length - 3
      ctx.lineTo(d.x + d.pts[last] * sx, d.y + d.pts[last + 1] * sy)
      ctx.strokeStyle = themedInk(d.stroke, dark); ctx.lineWidth = Math.max(d.size * 0.8, hair); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
      if (d.tool === 'highlighter') ctx.globalAlpha = 0.45
      ctx.stroke(); ctx.globalAlpha = 1
      break
    }
    case 'image': {
      const bmp = thumbFor(it.src)
      if (bmp) ctx.drawImage(bmp, it.x, it.y, it.w, it.h)
      else { ctx.fillStyle = dark ? '#3a3f4a' : '#dfe4ec'; ctx.fillRect(it.x, it.y, it.w, it.h) }
      break
    }
    case 'comment': break
    default: {
      // cards, tables, code, embeds, models, files, charts: a quiet card silhouette
      const darkCard = it.type === 'code' && it.dark !== false
      ctx.fillStyle = darkCard ? '#1b1d23' : it.type === 'ifc' ? '#eef0f3' : '#ffffff'
      ctx.fillRect(it.x, it.y, it.w, it.h)
      ctx.strokeStyle = '#d9d7d0'; ctx.lineWidth = hair; ctx.strokeRect(it.x, it.y, it.w, it.h)
      if (it.type === 'card') { ctx.fillStyle = it.fill; ctx.fillRect(it.x, it.y, Math.max(5, 2 / z), it.h) }
    }
  }
  if (rotated) ctx.restore()
}

export function paintOverview(canvas: HTMLCanvasElement, items: Record<string, Item>, ids: string[], camera: Camera, dark: boolean, density?: number) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  // a canvas that is not on screen (board previews) has no layout size, so its pixel density is given
  const dpr = density ?? canvas.width / (canvas.clientWidth || 1)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(dpr * camera.z, 0, 0, dpr * camera.z, dpr * camera.x, dpr * camera.y)
  for (const id of ids) {
    const it = items[id]
    if (it) paintItem(ctx, it, items, camera.z, dark)
  }
}

// ---------- hit testing (the overview has no DOM to ask) ----------

export function hitOverview(w: Pt, items: Record<string, Item>, ids: string[], z: number): Item | null {
  const tol = 6 / z
  for (let i = ids.length - 1; i >= 0; i--) {
    const it = items[ids[i]]
    if (!it || it.type === 'comment') continue
    if (it.type === 'connector') {
      const g = connectorGeom(it as ConnectorItem, items)
      if (w.x < g.box.x - tol || w.x > g.box.x + g.box.w + tol || w.y < g.box.y - tol || w.y > g.box.y + g.box.h + tol) continue
      const pts = g.pts
      if (it.route === 'curve' && pts.length === 4) {
        // sample the bezier
        let prev = pts[0]
        for (let t = 1; t <= 16; t++) {
          const u = t / 16, m = 1 - u
          const p = { x: m * m * m * pts[0].x + 3 * m * m * u * pts[1].x + 3 * m * u * u * pts[2].x + u * u * u * pts[3].x, y: m * m * m * pts[0].y + 3 * m * m * u * pts[1].y + 3 * m * u * u * pts[2].y + u * u * u * pts[3].y }
          if (distToSegment(w, prev, p) <= tol + it.strokeW) return it
          prev = p
        }
      } else for (let k = 1; k < pts.length; k++) if (distToSegment(w, pts[k - 1], pts[k]) <= tol + it.strokeW) return it
      continue
    }
    const local = it.rot ? rotatePt(w, center(it), -it.rot) : w
    if (local.x < it.x - tol || local.x > it.x + it.w + tol || local.y < it.y - tol || local.y > it.y + it.h + tol) continue
    if (it.type === 'frame') {
      // frames are picked by their border or title strip, like in the detailed view
      const inner = local.x > it.x + tol && local.x < it.x + it.w - tol && local.y > it.y + tol && local.y < it.y + it.h - tol
      if (inner) continue
      return it
    }
    if (it.type === 'draw') {
      const d = it as DrawItem
      const sx = d.w / (d.w0 || 1), sy = d.h / (d.h0 || 1)
      const q = { x: local.x - d.x, y: local.y - d.y }
      let near = d.pts.length === 3 && Math.hypot(d.pts[0] * sx - q.x, d.pts[1] * sy - q.y) < d.size + tol
      for (let k = 3; k < d.pts.length && !near; k += 3) near = distToSegment(q, { x: d.pts[k - 3] * sx, y: d.pts[k - 2] * sy }, { x: d.pts[k] * sx, y: d.pts[k + 1] * sy }) < d.size / 2 + tol
      if (!near) continue
    }
    if (it.type === 'shape' && it.fill === 'transparent' && !it.html) {
      // hollow shapes are picked by their outline only
      const inner = local.x > it.x + tol * 2 && local.x < it.x + it.w - tol * 2 && local.y > it.y + tol * 2 && local.y < it.y + it.h - tol * 2
      if (inner) continue
    }
    return it
  }
  return null
}
