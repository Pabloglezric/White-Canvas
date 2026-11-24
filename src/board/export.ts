// Export: vector SVG, PNG at a chosen scale, print-to-PDF, JSON backup, CSV.
import { download, escapeAttr, escapeHtml, htmlToText } from '../lib/util'
import { resolveAsset } from './assets'
import { FONT_STACK, inkOn } from './defaults'
import { aabb, capPath, connectorGeom, itemBox, shapeInset, shapePath, unionBoxes } from './geometry'
import { inkPath } from './items/ItemView'
import { S } from './store'
import type { Box, Item, TextStyle } from './types'
import { safeColor } from './validate'

// Every value that reaches markup goes through one of these: numbers are coerced, colours are checked.
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0 }
const col = (v: unknown, fallback = '#1c1e23') => safeColor(v, fallback)
const fillOf = (v: unknown, fallback = '#ffffff') => { const c = safeColor(v, fallback); return c === 'transparent' ? 'none' : c }

const LAYER: Record<string, number> = { frame: 0, comment: 2 }
const sortItems = (list: Item[]) => [...list].sort((a, b) => (LAYER[a.type] ?? 1) - (LAYER[b.type] ?? 1) || a.z - b.z)

/** Small schematic preview stored with the board and shown on the dashboard. */
export function thumbnailSvg(items: Record<string, Item>): string {
  const list = sortItems(Object.values(items).filter((i) => i.type !== 'comment'))
  const box = unionBoxes(list.map((i) => itemBox(i, items)))
  if (!box || !list.length) return ''
  const pad = Math.max(box.w, box.h) * 0.06 + 10
  const vb = `${Math.round(box.x - pad)} ${Math.round(box.y - pad)} ${Math.round(box.w + pad * 2)} ${Math.round(box.h + pad * 2)}`
  const sw = Math.max(box.w, box.h) / 220
  let out = ''
  for (const it of list.slice(-260)) {
    const r = (n: number) => Math.round(n)
    if (it.type === 'connector') {
      const g = connectorGeom(it, items)
      out += `<path d="${g.d.replace(/(\d+\.\d)\d+/g, '$1')}" fill="none" stroke="${col(it.stroke)}" stroke-width="${n(sw)}"/>`
    } else if (it.type === 'draw') {
      out += `<rect x="${r(it.x)}" y="${r(it.y)}" width="${r(it.w)}" height="${r(it.h)}" fill="none" stroke="${col(it.stroke)}" stroke-width="${n(sw)}" opacity=".5" rx="${n(sw * 3)}"/>`
    } else {
      const fill = it.type === 'sticky' || it.type === 'shape' ? it.fill : it.type === 'frame' ? '#ffffff' : it.type === 'text' ? '#b9bbc2' : it.type === 'image' || it.type === 'ifc' ? '#c8d3e6' : '#e8e7e2'
      const stroke = it.type === 'frame' ? '#c9c7c0' : it.type === 'shape' ? col(it.stroke) : 'none'
      const h = it.type === 'text' ? Math.max(sw * 2, it.h * 0.4) : it.h
      out += `<rect x="${r(it.x)}" y="${r(it.y)}" width="${r(it.w)}" height="${r(h)}" fill="${fillOf(fill, '#e8e7e2')}" stroke="${stroke}" stroke-width="${n(sw)}"${it.rot ? ` transform="rotate(${n(it.rot)} ${r(it.x + it.w / 2)} ${r(it.y + it.h / 2)})"` : ''}/>`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" preserveAspectRatio="xMidYMid meet">${out}</svg>`
}

// ---------- text layout for vector export ----------

let ctx: CanvasRenderingContext2D | null = null
function wrap(text: string, font: string, maxW: number): string[] {
  ctx ||= document.createElement('canvas').getContext('2d')
  if (!ctx) return text.split('\n')
  ctx.font = font
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue
      const next = line + word
      if (line && ctx.measureText(next.trimEnd()).width > maxW) { lines.push(line.trimEnd()); line = word.trimStart() }
      else line = next
    }
    lines.push(line)
  }
  return lines
}

function textBlock(html: string, st: TextStyle, box: Box, defaults: { color: string; align?: string; valign?: string; size?: number }): string {
  const text = htmlToText(html)
  if (!text) return ''
  let size = st.fontSize || defaults.size || 16
  const family = FONT_STACK[st.font || 'sans']
  const weight = st.bold ? 700 : 400
  const font = () => `${st.italic ? 'italic ' : ''}${weight} ${size}px ${family}`
  let lines = wrap(text, font(), box.w)
  // shrink to fit, as the on-canvas sticky note does
  while (lines.length * size * 1.3 > box.h && size > 6) { size -= 1; lines = wrap(text, font(), box.w) }
  const align = st.align || defaults.align || 'center'
  const valign = st.valign || defaults.valign || 'middle'
  const x = align === 'left' ? box.x : align === 'right' ? box.x + box.w : box.x + box.w / 2
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle'
  const total = lines.length * size * 1.3
  const y0 = (valign === 'top' ? box.y : valign === 'bottom' ? box.y + box.h - total : box.y + (box.h - total) / 2) + size
  const deco = [st.underline ? 'underline' : '', st.strike ? 'line-through' : ''].join(' ').trim()
  return `<text font-family='${family}' font-size="${n(size)}" font-weight="${weight}"${st.italic ? ' font-style="italic"' : ''}${deco ? ` text-decoration="${deco}"` : ''} fill="${col(st.color, defaults.color)}" text-anchor="${anchor}">${lines
    .map((l, i) => `<tspan x="${x}" y="${y0 + i * size * 1.3}">${escapeHtml(l) || ' '}</tspan>`).join('')}</text>`
}

const dash = (d: string | undefined, w: number) => (d === 'dashed' ? ` stroke-dasharray="${n(w * 4)} ${n(w * 3)}"` : d === 'dotted' ? ` stroke-dasharray="${n(w * 0.1)} ${n(w * 2.2)}"` : '')

async function toDataUrl(src: string, maxSide = 2200): Promise<string> {
  try {
    const url = await resolveAsset(src)
    if (!url) return ''
    if (url.startsWith('data:')) return url
    const blob = await (await fetch(url)).blob()
    const bmp = await createImageBitmap(blob)
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    return c.toDataURL(blob.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9)
  } catch { return '' }
}

async function itemSvg(it: Item, items: Record<string, Item>): Promise<string> {
  if (it.type === 'comment') return ''
  if (it.type === 'connector') {
    const g = connectorGeom(it, items)
    const size = 6 + it.strokeW * 3
    const caps = [capPath(it.capA, g.pts[0], g.tanA, size), capPath(it.capB, g.pts[g.pts.length - 1], g.tanB, size)]
    const stroke = col(it.stroke), sw = n(it.strokeW)
    let out = `<path d="${g.d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dash(it.dash, it.strokeW)}/>`
    for (const c of caps) if (c) out += `<path d="${c.d}" fill="${c.fill ? stroke : 'none'}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`
    if (it.label) {
      const fs = it.fontSize || 14
      const w = it.label.length * fs * 0.58 + 12
      out += `<rect x="${g.mid.x - w / 2}" y="${g.mid.y - fs * 0.8}" width="${w}" height="${fs * 1.6}" rx="6" fill="#f6f5f1"/><text x="${g.mid.x}" y="${g.mid.y + fs * 0.35}" text-anchor="middle" font-family='${FONT_STACK.sans}' font-size="${n(fs)}" font-weight="500" fill="${col(it.color)}">${escapeHtml(it.label)}</text>`
    }
    return out
  }
  const open = `<g transform="translate(${n(it.x)} ${n(it.y)})${it.rot ? ` rotate(${n(it.rot)} ${n(it.w / 2)} ${n(it.h / 2)})` : ''}">`
  const local: Box = { x: 0, y: 0, w: it.w, h: it.h }
  let body = ''
  switch (it.type) {
    case 'frame':
      body = `<rect width="${n(it.w)}" height="${n(it.h)}" fill="${fillOf(it.fill)}" stroke="#c9c7c0"/><text x="0" y="-8" font-family='${FONT_STACK.sans}' font-size="14" font-weight="600" fill="#5b5f6a">${escapeHtml(it.title)}</text>`
      break
    case 'sticky': {
      const m = it.w * 0.07
      body = `<rect width="${n(it.w)}" height="${n(it.h)}" rx="3" fill="${fillOf(it.fill, '#fff2a8')}"/>` + textBlock(it.html, it, { x: m, y: m, w: it.w - m * 2, h: it.h - m * 2 }, { color: inkOn(it.fill), size: 18 })
      break
    }
    case 'text':
      body = (it.fill ? `<rect width="${n(it.w)}" height="${n(it.h)}" rx="4" fill="${fillOf(it.fill)}"/>` : '') + textBlock(it.html, it, { x: 4, y: 2, w: Math.max(10, it.w - 8), h: it.h + 400 }, { color: '#1c1e23', align: 'left', valign: 'top', size: 20 })
      break
    case 'shape': {
      const [ix, iy] = shapeInset(it.kind)
      body = `<path d="${shapePath(it.kind, it.w, it.h)}" fill="${fillOf(it.fill)}" stroke="${it.strokeW ? col(it.stroke) : 'none'}" stroke-width="${n(it.strokeW)}" stroke-linejoin="round" stroke-linecap="round"${dash(it.dash, it.strokeW)}${it.opacity != null ? ` opacity="${n(it.opacity)}"` : ''}/>` +
        textBlock(it.html, it, { x: it.w * ix, y: it.h * iy, w: it.w * (1 - ix * 2), h: it.h * (1 - iy * 2) }, { color: it.fill === 'transparent' ? '#1c1e23' : inkOn(it.fill) })
      break
    }
    case 'draw':
      body = `<path d="${inkPath(it)}" fill="${col(it.stroke)}"${it.tool === 'highlighter' ? ' opacity="0.45"' : ''}/>`
      break
    case 'image': case 'ifc': {
      const href = it.type === 'image' ? await toDataUrl(it.src) : it.preview || ''
      body = href
        ? `<image href="${escapeAttr(href)}" width="${n(it.w)}" height="${n(it.h)}" preserveAspectRatio="none"/>`
        : `<rect width="${n(it.w)}" height="${n(it.h)}" rx="8" fill="#eef0f3" stroke="#d9d7d0"/><text x="${n(it.w / 2)}" y="${n(it.h / 2)}" text-anchor="middle" font-family='${FONT_STACK.sans}' font-size="13" fill="#7a7d86">${escapeHtml(it.type === 'ifc' ? it.name : 'Image')}</text>`
      break
    }
    case 'embed':
      body = `<rect width="${it.w}" height="${it.h}" rx="10" fill="#ffffff" stroke="#d9d7d0"/><text x="14" y="26" font-family='${FONT_STACK.sans}' font-size="14" font-weight="600" fill="#1c1e23">${escapeHtml((it.title || 'Embedded page').slice(0, 60))}</text><text x="14" y="46" font-family='${FONT_STACK.sans}' font-size="11" fill="#1d5fd1">${escapeHtml(it.url.slice(0, 80))}</text>`
      break
    case 'card':
      body = `<rect width="${n(it.w)}" height="${n(it.h)}" rx="10" fill="#ffffff" stroke="#d9d7d0"/><rect width="5" height="${n(it.h)}" fill="${fillOf(it.fill, '#0090ff')}"/>` +
        textBlock(escapeHtml(it.title), { fontSize: 15, bold: true, align: 'left', valign: 'top' }, { x: 16, y: 10, w: it.w - 28, h: 40 }, { color: '#1c1e23' }) +
        textBlock(escapeHtml([it.desc, [it.status, it.assignee, it.due, ...(it.tags || []).map((t) => '#' + t)].filter(Boolean).join(' · ')].filter(Boolean).join('\n')), { fontSize: 12, align: 'left', valign: 'top' }, { x: 16, y: 34, w: it.w - 28, h: it.h - 40 }, { color: '#5b5f6a' })
      break
    case 'table': {
      const sx = it.w / (it.colW.reduce((a, b) => a + b, 0) || 1), sy = it.h / (it.rowH.reduce((a, b) => a + b, 0) || 1)
      body = `<rect width="${n(it.w)}" height="${n(it.h)}" fill="${fillOf(it.fill)}"/>`
      let y = 0
      it.cells.forEach((row, r) => {
        let x = 0
        const h = it.rowH[r] * sy
        row.forEach((cell, c) => {
          const w = it.colW[c] * sx
          body += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${it.header && r === 0 ? 'rgba(21,23,28,.06)' : 'none'}" stroke="${col(it.stroke, '#c9cbd1')}"/>` +
            textBlock(escapeHtml(cell), { fontSize: it.fontSize || 14, bold: it.header && r === 0, align: 'left', valign: 'top', color: it.color }, { x: x + 9, y: y + 6, w: w - 18, h: h - 8 }, { color: '#1c1e23' })
          x += w
        })
        y += h
      })
      break
    }
    case 'code': {
      const dark = it.dark !== false
      const fs = it.fontSize || 13
      body = `<rect width="${it.w}" height="${it.h}" rx="10" fill="${dark ? '#1b1d23' : '#fbfaf7'}" stroke="${dark ? '#1b1d23' : '#d9d7d0'}"/><text font-family='${FONT_STACK.mono}' font-size="${fs}" fill="${dark ? '#e7e7e2' : '#1c1e23'}" xml:space="preserve">${it.code.split('\n').slice(0, Math.floor((it.h - 30) / (fs * 1.5))).map((l, i) => `<tspan x="12" y="${36 + i * fs * 1.5}">${escapeHtml(l) || ' '}</tspan>`).join('')}</text>`
      break
    }
    case 'file':
      body = `<rect width="${it.w}" height="${it.h}" rx="10" fill="#ffffff" stroke="#d9d7d0"/><text x="16" y="${it.h / 2 + 5}" font-family='${FONT_STACK.sans}' font-size="14" font-weight="500" fill="#1c1e23">${escapeHtml(it.name)}</text>`
      break
    case 'chart': {
      const fill = col(it.fill, '#0090ff')
      const max = Math.max(1, ...it.values)
      const top = it.title ? 34 : 14, left = 44, pw = Math.max(10, it.w - 58), ph = Math.max(10, it.h - top - 30)
      const step = pw / (it.values.length || 1)
      body = `<rect width="${n(it.w)}" height="${n(it.h)}" rx="10" fill="#ffffff" stroke="#d9d7d0"/>` +
        (it.title ? `<text x="14" y="22" font-family='${FONT_STACK.sans}' font-size="14" font-weight="600" fill="#1c1e23">${escapeHtml(it.title)}</text>` : '') +
        it.values.map((v, i) => {
          const h = (Math.max(0, v) / max) * ph
          return `<rect x="${n(left + step * i + step * 0.16)}" y="${n(top + ph - h)}" width="${n(step * 0.68)}" height="${n(h)}" rx="3" fill="${fill}"/><text x="${n(left + step * (i + 0.5))}" y="${n(it.h - 10)}" text-anchor="middle" font-family='${FONT_STACK.sans}' font-size="10" fill="#7a7d86">${escapeHtml((it.labels[i] || '').slice(0, 10))}</text>`
        }).join('')
      break
    }
  }
  return open + body + '</g>'
}

export interface ExportArea { box: Box; ids: string[] }

/** What to export: the selection, else everything. */
export function exportArea(scope: 'selection' | 'all' | string = 'all'): ExportArea | null {
  const { items, selection } = S()
  let list: Item[]
  let box: Box | null
  if (scope === 'selection' && selection.length) {
    const ids = new Set(selection)
    for (const id of selection) if (items[id]?.type === 'frame') for (const o of Object.values(items)) if (o.parent === id) ids.add(o.id)
    list = [...ids].map((id) => items[id]).filter(Boolean)
    box = unionBoxes(list.map((i) => itemBox(i, items)))
  } else if (scope !== 'all' && scope !== 'selection' && items[scope]) {
    const f = items[scope]
    box = aabb(f)
    list = Object.values(items).filter((i) => i.id === f.id || i.parent === f.id || (i.type === 'connector' && (() => { const b = itemBox(i, items); return b.x >= box!.x && b.y >= box!.y && b.x + b.w <= box!.x + box!.w && b.y + b.h <= box!.y + box!.h })()))
  } else {
    list = Object.values(items)
    box = unionBoxes(list.filter((i) => i.type !== 'comment').map((i) => itemBox(i, items)))
  }
  list = list.filter((i) => i.type !== 'comment')
  if (!box || !list.length) return null
  return { box, ids: list.map((i) => i.id) }
}

export async function buildSvg(area: ExportArea, opts: { pad?: number; background?: string | null } = {}): Promise<{ svg: string; w: number; h: number }> {
  const { items } = S()
  const pad = opts.pad ?? 32
  const b = { x: area.box.x - pad, y: area.box.y - pad, w: area.box.w + pad * 2, h: area.box.h + pad * 2 }
  const list = sortItems(area.ids.map((id) => items[id]).filter(Boolean))
  // images are fetched and encoded a few at a time so a photo-heavy board does not exhaust memory
  const parts: string[] = new Array(list.length)
  let next = 0
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < list.length) { const i = next++; parts[i] = await itemSvg(list[i], items).catch(() => '') } }))
  const bg = opts.background === null ? '' : `<rect x="${n(b.x)}" y="${n(b.y)}" width="${n(b.w)}" height="${n(b.h)}" fill="${fillOf(opts.background, '#f6f5f1')}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(b.w)}" height="${Math.round(b.h)}" viewBox="${n(b.x)} ${n(b.y)} ${n(b.w)} ${n(b.h)}">${bg}${parts.join('')}</svg>`
  return { svg, w: b.w, h: b.h }
}

export async function svgToPng(svg: string, w: number, h: number, scale: number): Promise<Blob> {
  // stay inside what phones and tablets can allocate for one canvas (about 16 megapixels)
  const maxSide = 8192, maxArea = 16_000_000
  const k = Math.min(scale, maxSide / w, maxSide / h, Math.sqrt(maxArea / (w * h)))
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('Could not render the export')); img.src = url })
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Export failed'))), 'image/png'))
  } finally { URL.revokeObjectURL(url) }
}

const safeName = (s: string) => (s || 'board').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'board'

export async function exportImage(kind: 'png' | 'svg', scope: string, scale = 2, transparent = false) {
  const area = exportArea(scope)
  if (!area) throw new Error('Nothing to export')
  const { svg, w, h } = await buildSvg(area, { background: transparent ? null : undefined })
  const name = safeName(S().meta?.title || '')
  if (kind === 'svg') download(`${name}.svg`, svg, 'image/svg+xml')
  else download(`${name}.png`, await svgToPng(svg, w, h, scale))
}

/** Vector PDF through the browser's print dialog: one page per frame (or one page for everything). */
export async function exportPdf(scope: 'frames' | 'all' | 'selection') {
  const { items, meta } = S()
  const frames = Object.values(items).filter((i) => i.type === 'frame').sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) * 0.5 ? a.y - b.y : a.x - b.x))
  const areas = scope === 'frames' && frames.length ? frames.map((f) => exportArea(f.id)).filter(Boolean) as ExportArea[] : [exportArea(scope === 'frames' ? 'all' : scope)].filter(Boolean) as ExportArea[]
  if (!areas.length) throw new Error('Nothing to export')
  const pages = await Promise.all(areas.map((a) => buildSvg(a, { pad: scope === 'frames' && frames.length ? 0 : 24, background: '#ffffff' })))
  const win = window.open('', '_blank')
  if (!win) throw new Error('Allow pop-ups to export a PDF')
  const first = pages[0]
  win.document.write(`<!doctype html><html><head><title>${escapeHtml(safeName(meta?.title || ''))}</title><style>
    @page { size: ${Math.round(first.w)}px ${Math.round(first.h)}px; margin: 0; }
    html, body { margin: 0; background: #fff; }
    .p { page-break-after: always; break-after: page; width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; }
    .p:last-child { page-break-after: auto; break-after: auto; }
    svg { max-width: 100%; max-height: 100%; width: 100%; height: 100%; }
    @media screen { body { background: #ddd; } .p { height: auto; margin: 12px auto; max-width: 900px; background: #fff; } }
  </style></head><body>${pages.map((p) => `<div class="p">${p.svg}</div>`).join('')}</body></html>`)
  win.document.close()
  setTimeout(() => { try { win.focus(); win.print() } catch { /* the user can print from the new tab */ } }, 400)
}

export function exportJson() {
  const { items, meta } = S()
  download(`${safeName(meta?.title || '')}.whitecanvas.json`, JSON.stringify({ app: 'white-canvas', version: 1, title: meta?.title, exported_at: new Date().toISOString(), items: Object.values(items) }, null, 1), 'application/json')
}

export function exportCsv() {
  const { items, meta } = S()
  const frames = items
  // cells that look like formulas are neutralised so a spreadsheet never executes board text
  const esc = (v: unknown) => { const t = String(v ?? ''); return `"${(/^[=+\-@\t\r]/.test(t) ? "'" + t : t).replace(/"/g, '""')}"` }
  const rows = [['type', 'text', 'frame', 'color', 'tags', 'votes', 'x', 'y'].join(',')]
  for (const it of sortItems(Object.values(items))) {
    let text = ''
    if (it.type === 'sticky' || it.type === 'text' || it.type === 'shape') text = htmlToText(it.html)
    else if (it.type === 'card') text = [it.title, it.desc].filter(Boolean).join(' — ')
    else if (it.type === 'comment') text = it.thread.map((t) => `${t.name}: ${t.text}`).join(' | ')
    else continue
    if (!text) continue
    const frame = it.parent && frames[it.parent]?.type === 'frame' ? (frames[it.parent] as { title: string }).title : ''
    rows.push([esc(it.type), esc(text), esc(frame), esc('fill' in it ? it.fill : ''), esc('tags' in it ? (it.tags || []).join(' ') : ''), it.votes?.length || 0, Math.round(it.x), Math.round(it.y)].join(','))
  }
  download(`${safeName(meta?.title || '')}.csv`, rows.join('\n'), 'text/csv')
}
