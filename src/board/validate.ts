// Single entry point for item data that did not originate in this tab: database rows, realtime
// messages, the offline cache, imported files, the clipboard and restored versions.
// Everything is coerced to a known-good shape (or dropped), so one malformed or hostile row can never
// crash rendering, inject markup, or load an unsafe URL.
import DOMPurify from 'dompurify'
import type { Item } from './types'

const SHAPES = new Set(['rect', 'round', 'ellipse', 'diamond', 'triangle', 'parallelogram', 'hexagon', 'star', 'pill', 'cylinder', 'cloud', 'callout', 'arrowRight', 'arrowLeft', 'pentagon', 'octagon', 'trapezoid', 'cross', 'document', 'predefined'])
const TYPES = new Set(['sticky', 'text', 'shape', 'connector', 'draw', 'frame', 'image', 'embed', 'ifc', 'card', 'table', 'code', 'comment', 'file', 'chart'])
const COLOR = /^(#[0-9a-f]{3,8}|transparent|rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*)?\))$/i
const MAX = 1e7

type R = Record<string, unknown>
const isObj = (v: unknown): v is R => !!v && typeof v === 'object' && !Array.isArray(v)

export const safeColor = <T extends string | undefined>(v: unknown, fallback: T): string | T => (typeof v === 'string' && COLOR.test(v) ? v : fallback)
const num = (v: unknown, d: number, min = -MAX, max = MAX) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d)
const optNum = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined)
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? (v.length > max ? v.slice(0, max) : v) : typeof v === 'number' ? String(v) : d)
const optStr = (v: unknown, max: number) => (typeof v === 'string' && v ? (v.length > max ? v.slice(0, max) : v) : undefined)
const bool = (v: unknown) => (v === true ? true : undefined)
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d)
const optOneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (list.includes(v as T) ? (v as T) : undefined)
const strList = (v: unknown, maxItems: number, maxLen: number) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, maxItems).map((x) => (x as string).slice(0, maxLen)) : undefined)

/** http(s) only, and never this app's own origin (an embedded copy of the app would run with the user's session). */
export function safeHttpUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 4000) return undefined
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined
    if (typeof location !== 'undefined' && u.origin === location.origin) return undefined
    return u.toString()
  } catch { return undefined }
}

/** Sources allowed for images and files: stored assets, device-local assets, https, and inline raster data. */
export function safeAssetSrc(v: unknown, allowRemote = true): string | undefined {
  if (typeof v !== 'string' || !v) return undefined
  if (/^asset:[0-9a-f-]{36}\/[\w.-]{1,120}$/i.test(v) || /^local:[\w-]{1,80}$/.test(v)) return v
  if (/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(v) && v.length < 600_000) return v
  if (allowRemote && /^https:\/\//i.test(v)) return safeHttpUrl(v)
  return undefined
}

const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'br', 'div', 'p', 'span', 'ul', 'ol', 'li', 'a', 'code', 'mark']
let hooked = false
function purifier() {
  if (!hooked) {
    hooked = true
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A') {
        const href = node.getAttribute('href') || ''
        if (!/^https?:\/\//i.test(href)) node.removeAttribute('href')
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener noreferrer nofollow')
      }
    })
  }
  return DOMPurify
}

const htmlCache = new Map<string, string>()
/** Rich text allowed on the board: basic inline formatting, lists and safe links. No styles, no scripts. */
export function cleanHtml(html: unknown): string {
  if (typeof html !== 'string' || !html) return ''
  const src = html.length > 60_000 ? html.slice(0, 60_000) : html
  if (!src.includes('<')) return src
  const hit = htmlCache.get(src)
  if (hit !== undefined) return hit
  const out = purifier().sanitize(src, { ALLOWED_TAGS, ALLOWED_ATTR: ['href', 'target', 'rel'] })
  if (htmlCache.size > 3000) htmlCache.clear()
  htmlCache.set(src, out)
  return out
}

function textStyle(r: R) {
  return {
    fontSize: optNum(r.fontSize, 2, 2000),
    color: safeColor(r.color, undefined),
    align: optOneOf(r.align, ['left', 'center', 'right'] as const),
    valign: optOneOf(r.valign, ['top', 'middle', 'bottom'] as const),
    bold: bool(r.bold), italic: bool(r.italic), underline: bool(r.underline), strike: bool(r.strike),
    font: optOneOf(r.font, ['sans', 'serif', 'mono', 'hand'] as const),
  }
}

function end(v: unknown) {
  const r = isObj(v) ? v : {}
  const out: { item?: string; ax?: number; ay?: number; x: number; y: number } = { x: num(r.x, 0), y: num(r.y, 0) }
  if (typeof r.item === 'string' && r.item.length <= 64) out.item = r.item
  const ax = optNum(r.ax, 0, 1), ay = optNum(r.ay, 0, 1)
  if (ax !== undefined && ay !== undefined) { out.ax = ax; out.ay = ay }
  return out
}

/** Returns a safe, complete item, or null when the data cannot be used. */
export function normalizeItem(raw: unknown): Item | null {
  if (!isObj(raw)) return null
  const type = raw.type
  if (typeof type !== 'string' || !TYPES.has(type)) return null
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 64) return null
  const flat = type === 'connector'
  const base = {
    id: raw.id,
    x: flat ? 0 : num(raw.x, 0), y: flat ? 0 : num(raw.y, 0),
    w: flat ? 0 : num(raw.w, 100, 1, 1e6), h: flat ? 0 : num(raw.h, 100, 1, 1e6),
    rot: flat ? 0 : ((num(raw.rot, 0, -36000, 36000) % 360) + 360) % 360,
    z: num(raw.z, 0, -1e9, 1e9),
    rev: Math.max(0, Math.floor(num(raw.rev, 0, 0, Number.MAX_SAFE_INTEGER))),
    parent: typeof raw.parent === 'string' && raw.parent.length <= 64 ? raw.parent : raw.parent === null ? null : undefined,
    group: typeof raw.group === 'string' && raw.group.length <= 64 ? raw.group : raw.group === null ? null : undefined,
    locked: bool(raw.locked),
    by: optStr(raw.by, 64),
    votes: strList(raw.votes, 500, 64),
  }
  let it: Record<string, unknown>
  switch (type) {
    case 'sticky':
      it = { ...base, ...textStyle(raw), type, html: cleanHtml(raw.html), fill: safeColor(raw.fill, '#fff2a8'), autoFit: raw.autoFit === false ? false : undefined, tags: strList(raw.tags, 20, 60), author: optStr(raw.author, 80) }
      break
    case 'text':
      it = { ...base, ...textStyle(raw), type, html: cleanHtml(raw.html), fill: safeColor(raw.fill, undefined), autoW: bool(raw.autoW) }
      if (it.fill === 'transparent') delete it.fill
      break
    case 'shape':
      it = { ...base, ...textStyle(raw), type, kind: SHAPES.has(raw.kind as string) ? raw.kind : 'rect', html: cleanHtml(raw.html), fill: safeColor(raw.fill, '#ffffff'), stroke: safeColor(raw.stroke, '#1c1e23'), strokeW: num(raw.strokeW, 2, 0, 200), dash: optOneOf(raw.dash, ['solid', 'dashed', 'dotted'] as const), opacity: optNum(raw.opacity, 0, 1) }
      break
    case 'connector':
      it = {
        ...base, type, a: end(raw.a), b: end(raw.b), route: oneOf(raw.route, ['straight', 'elbow', 'curve'] as const, 'elbow'),
        capA: oneOf(raw.capA, ['none', 'arrow', 'triangle', 'dot', 'diamond', 'bar'] as const, 'none'), capB: oneOf(raw.capB, ['none', 'arrow', 'triangle', 'dot', 'diamond', 'bar'] as const, 'arrow'),
        stroke: safeColor(raw.stroke, '#1c1e23'), strokeW: num(raw.strokeW, 2, 0.25, 200), dash: optOneOf(raw.dash, ['solid', 'dashed', 'dotted'] as const),
        label: optStr(raw.label, 300), color: safeColor(raw.color, undefined), fontSize: optNum(raw.fontSize, 2, 2000),
      }
      break
    case 'draw': {
      const src = Array.isArray(raw.pts) ? raw.pts : []
      const n = Math.min(Math.floor(src.length / 3) * 3, 90_000)
      if (n < 3) return null
      const pts: number[] = new Array(n)
      for (let i = 0; i < n; i++) { const v = src[i]; pts[i] = typeof v === 'number' && Number.isFinite(v) ? v : i % 3 === 2 ? 0.5 : 0 }
      it = { ...base, type, pts, w0: num(raw.w0, base.w, 1e-3, 1e6), h0: num(raw.h0, base.h, 1e-3, 1e6), stroke: safeColor(raw.stroke, '#1c1e23'), size: num(raw.size, 4, 0.05, 2000), tool: oneOf(raw.tool, ['pen', 'highlighter'] as const, 'pen') }
      break
    }
    case 'frame':
      it = { ...base, type, title: str(raw.title, 200, 'Frame'), fill: safeColor(raw.fill, '#ffffff'), hidden: bool(raw.hidden) }
      break
    case 'image': {
      const src = safeAssetSrc(raw.src)
      if (!src) return null
      it = { ...base, type, src, thumb: safeAssetSrc(raw.thumb, false), alt: optStr(raw.alt, 300), nw: optNum(raw.nw, 1, 1e5), nh: optNum(raw.nh, 1, 1e5) }
      break
    }
    case 'embed': {
      const kind = oneOf(raw.kind, ['iframe', 'link', 'html'] as const, 'iframe')
      const url = kind === 'html' ? 'about:blank' : safeHttpUrl(raw.url)
      if (!url) return null
      it = { ...base, type, kind, url, src: safeHttpUrl(raw.src), html: kind === 'html' ? str(raw.html, 200_000) : undefined, title: optStr(raw.title, 300), desc: optStr(raw.desc, 600), thumb: typeof raw.thumb === 'string' && /^https:\/\//i.test(raw.thumb) ? safeHttpUrl(raw.thumb) : undefined, site: optStr(raw.site, 120) }
      break
    }
    case 'ifc': {
      const src = safeAssetSrc(raw.src, false)
      if (!src || src.startsWith('data:')) return null
      const cam = Array.isArray(raw.cam) && raw.cam.length === 6 && raw.cam.every((v) => typeof v === 'number' && Number.isFinite(v)) ? (raw.cam as number[]) : undefined
      const preview = typeof raw.preview === 'string' && /^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(raw.preview) && raw.preview.length < 400_000 ? raw.preview : undefined
      it = { ...base, type, src, name: str(raw.name, 200, 'Model'), size: optNum(raw.size, 0, 1e12), cam, preview, section: raw.section === null ? null : optNum(raw.section, 0, 1) }
      break
    }
    case 'card':
      it = { ...base, type, title: str(raw.title, 400), desc: optStr(raw.desc, 6000), status: optStr(raw.status, 80), assignee: optStr(raw.assignee, 120), due: optStr(raw.due, 40), tags: strList(raw.tags, 20, 60), fill: safeColor(raw.fill, '#0090ff') }
      break
    case 'table': {
      const rows = (Array.isArray(raw.cells) ? raw.cells : []).slice(0, 300).map((r) => (Array.isArray(r) ? r.slice(0, 40).map((c) => str(c, 6000)) : ['']))
      if (!rows.length) rows.push([''])
      const cols = Math.max(1, ...rows.map((r) => r.length))
      for (const r of rows) while (r.length < cols) r.push('')
      const colW = Array.from({ length: cols }, (_, i) => num(Array.isArray(raw.colW) ? raw.colW[i] : undefined, 140, 10, 5000))
      const rowH = rows.map((_, i) => num(Array.isArray(raw.rowH) ? raw.rowH[i] : undefined, 40, 10, 5000))
      it = { ...base, ...textStyle(raw), type, cells: rows, colW, rowH, header: raw.header === false ? false : true, fill: safeColor(raw.fill, undefined), stroke: safeColor(raw.stroke, undefined) }
      break
    }
    case 'code':
      it = { ...base, type, code: str(raw.code, 200_000), lang: str(raw.lang, 30, 'text'), fontSize: optNum(raw.fontSize, 4, 200), dark: raw.dark === false ? false : true }
      break
    case 'comment': {
      const thread = (Array.isArray(raw.thread) ? raw.thread : []).filter(isObj).slice(0, 500).map((t, i) => ({ id: str(t.id, 64, `c${i}`), by: str(t.by, 64), name: str(t.name, 80, 'Member'), text: str(t.text, 4000), at: num(t.at, 0, 0, 1e14) }))
      it = { ...base, type, w: 32, h: 32, rot: 0, thread, resolved: bool(raw.resolved), fill: safeColor(raw.fill, undefined) }
      break
    }
    case 'file': {
      const src = safeAssetSrc(raw.src, false)
      if (!src || src.startsWith('data:')) return null
      it = { ...base, type, src, name: str(raw.name, 200, 'File'), mime: optStr(raw.mime, 120), size: optNum(raw.size, 0, 1e12) }
      break
    }
    case 'chart': {
      const labels = (Array.isArray(raw.labels) ? raw.labels : []).slice(0, 300).map((l) => str(l, 80))
      const values = (Array.isArray(raw.values) ? raw.values : []).slice(0, 300).map((v) => num(v, 0, -1e15, 1e15))
      const n = Math.min(labels.length, values.length)
      it = { ...base, type, kind: oneOf(raw.kind, ['bar', 'line', 'pie'] as const, 'bar'), title: optStr(raw.title, 200), labels: labels.slice(0, n), values: values.slice(0, n), fill: safeColor(raw.fill, undefined) }
      break
    }
    default:
      return null
  }
  for (const k in it) if (it[k] === undefined) delete it[k]
  return it as unknown as Item
}

export function normalizeItems(list: unknown): Item[] {
  if (!Array.isArray(list)) return []
  const out: Item[] = []
  for (const raw of list) { const it = normalizeItem(raw); if (it) out.push(it) }
  return out
}
