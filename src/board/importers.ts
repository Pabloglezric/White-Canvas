// Bringing outside content onto the board: files, pasted text/tables, links and embeds.
import { FUNCTIONS_URL, SUPABASE_KEY, hasSupabase, supabase } from '../lib/supabase'
import { parseCsv, textToHtml } from '../lib/util'
import { providerEmbed } from './embeds'
import { isLocalBoard, makeThumb, uploadAsset } from './assets'
import { make } from './defaults'
import { addItems, freeSpot, parseClipboardItems, pasteItems } from './ops'
import { normalizeItems, safeHttpUrl } from './validate'
import { aabb, intersects, unionBoxes } from './geometry'
import { S, fitBox, toast, useBoard, viewBox } from './store'
import type { EmbedItem, Item, Pt } from './types'

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i

interface Unfurl { frameable: boolean; title?: string; description?: string; image?: string; site?: string }

async function unfurl(url: string): Promise<Unfurl | null> {
  if (!hasSupabase) return null
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return null
    const res = await fetch(`${FUNCTIONS_URL}/unfurl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(9000),
    })
    if (!res.ok) return null
    return (await res.json()) as Unfurl
  } catch { return null }
}

export async function addEmbed(input: string, at: Pt): Promise<Item | null> {
  const text = input.trim()
  if (!text) return null
  // pasted embed code
  if (/<iframe[\s>]/i.test(text)) {
    const src = text.match(/src\s*=\s*["']([^"']+)["']/i)?.[1]
    if (src && /^https?:\/\//.test(src)) {
      const it = make.embed({ x: at.x - 280, y: at.y - 180, url: src, src, kind: 'iframe', title: text.match(/title\s*=\s*["']([^"']+)["']/i)?.[1] })
      addItems([it]); return it
    }
  }
  if (/^\s*<(?!iframe)[a-z!]/i.test(text) && !/^https?:\/\//i.test(text)) {
    const it = make.embed({ x: at.x - 280, y: at.y - 180, url: 'about:blank', kind: 'html', html: text, title: 'HTML snippet' })
    addItems([it]); return it
  }
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`
  const url = /\s/.test(text) ? undefined : safeHttpUrl(candidate)
  if (!url || !/\.[a-z]{2,}$/i.test(new URL(url).hostname)) { toast('That does not look like a web address'); return null }
  at = freeSpot(at, 640, 420)
  if (IMG_EXT.test(url)) {
    const it = make.image({ x: at.x - 200, y: at.y - 150, w: 400, h: 300, src: url })
    addItems([it])
    const img = new Image()
    img.onload = () => {
      const cur = S().items[it.id]
      if (cur && img.naturalWidth) addItems([{ ...cur, h: (cur.w * img.naturalHeight) / img.naturalWidth } as Item], { keepZ: true })
    }
    img.src = url
    return it
  }
  const known = providerEmbed(url)
  if (known) {
    const it: EmbedItem = make.embed({ x: at.x - (known.w || 640) / 2, y: at.y - (known.h || 420) / 2, w: known.w || 640, h: known.h || 420, url, src: known.src, kind: 'iframe', title: known.title })
    addItems([it])
    return it
  }
  // Unknown site: ask the server first whether it allows framing, so a blocked site is never loaded into
  // a blank box. Sites that refuse become a link preview.
  toast('Checking link…')
  const meta = await unfurl(url)
  if (S().boardId == null) return null
  const link = !!meta && !meta.frameable
  const w = link ? 360 : 640, h = link ? (meta?.image ? 300 : 130) : 420
  const it: EmbedItem = make.embed({ x: at.x - w / 2, y: at.y - h / 2, w, h, url, kind: link ? 'link' : 'iframe', title: meta?.title, desc: meta?.description, thumb: meta?.image, site: meta?.site })
  addItems([it])
  if (link) toast('This site blocks embedding — added as a link preview')
  return it
}

function tableFrom(rows: string[][], at: Pt): Item {
  const cols = Math.min(20, Math.max(...rows.map((r) => r.length)))
  const cells = rows.slice(0, 200).map((r) => r.slice(0, cols))
  const colW = Array.from({ length: cols }, (_, c) => Math.min(320, Math.max(90, ...cells.slice(0, 40).map((r) => (r[c] || '').length * 8 + 26))))
  if (rows.length > 200) toast('Table trimmed to the first 200 rows')
  const t = make.table({ x: at.x, y: at.y, cells, colW, rowH: Array(cells.length).fill(36) })
  t.x -= t.w / 2; t.y -= Math.min(t.h, 600) / 2
  return t
}

export async function importText(text: string, html: string, at: Pt) {
  const own = parseClipboardItems(text)
  if (own) { pasteItems(normalizeItems(own), at); return }
  const trimmed = text.trim()
  if (/^<iframe[\s>]/i.test(trimmed)) { await addEmbed(trimmed, at); return }
  if (/^https?:\/\/\S+$/i.test(trimmed)) { await addEmbed(trimmed, at); return }
  if (/<table[\s>]/i.test(html) || (trimmed.includes('\t') && trimmed.includes('\n'))) {
    const rows = parseCsv(trimmed.includes('\t') ? trimmed : text)
    if (rows.length > 1 || (rows[0]?.length || 0) > 1) { addItems([tableFrom(rows, at)]); return }
  }
  if (!trimmed) return
  const lines = trimmed.split('\n')
  const longest = Math.max(...lines.map((l) => l.length))
  const w = Math.min(520, Math.max(120, longest * 10))
  addItems([make.text({ x: at.x - w / 2, y: at.y - 16, w, autoW: longest < 52, html: textToHtml(trimmed) })])
}

export function addStickiesFromLines(text: string, at: Pt, fill: string) {
  const lines = text.split('\n').map((l) => l.replace(/^\s*[-*•\d.)]+\s*/, '').trim()).filter(Boolean).slice(0, 200)
  if (!lines.length) return
  const cols = Math.ceil(Math.sqrt(lines.length))
  at = freeSpot(at, cols * 220, Math.ceil(lines.length / cols) * 220)
  const items = lines.map((l, i) => make.sticky({ x: at.x + (i % cols) * 220 - (cols * 220) / 2, y: at.y + Math.floor(i / cols) * 220 - 100, html: textToHtml(l), fill }))
  addItems(items)
}

async function imageSize(file: Blob): Promise<{ w: number; h: number }> {
  try { const b = await createImageBitmap(file); const r = { w: b.width, h: b.height }; b.close(); return r } catch { return { w: 400, h: 300 } }
}

async function importPdf(file: File, boardId: string, at: Pt): Promise<Item[]> {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const doc = await task.promise
  const count = Math.min(doc.numPages, 40)
  if (doc.numPages > count) toast(`Importing the first ${count} of ${doc.numPages} pages`)
  const out: Item[] = []
  let x = at.x
  const gap = 40
  let maxH = 0
  // one canvas is reused for every page: phones cap total canvas memory
  const canvas = document.createElement('canvas')
  try {
    for (let n = 1; n <= count; n++) {
      toast(`Rendering page ${n} of ${count}…`)
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(3, 2400 / Math.max(base.width, base.height))
      const vp = page.getViewport({ scale })
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height)
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('render failed'))), 'image/jpeg', 0.9))
      page.cleanup()
      const src = await uploadAsset(boardId, blob, `page-${n}.jpg`)
      const small = await makeThumb(blob)
      const thumb = small && small.blob !== blob ? await uploadAsset(boardId, small.blob, 'preview.webp').catch(() => undefined) : undefined
      const w = Math.round(base.width * 1.2), h = Math.round(base.height * 1.2)
      out.push(make.image({ x, y: at.y, w, h, src, thumb, alt: `${file.name} — page ${n}`, nw: canvas.width, nh: canvas.height }))
      x += w + gap
      maxH = Math.max(maxH, h)
      await new Promise((r) => setTimeout(r, 0)) // let the UI breathe between pages
    }
  } finally {
    canvas.width = canvas.height = 0
    task.destroy().catch(() => {})
  }
  const frame = make.frame({ x: at.x - gap, y: at.y - gap, w: x - at.x + gap, h: maxH + gap * 2, title: file.name.replace(/\.pdf$/i, ''), fill: 'transparent' })
  for (const it of out) it.parent = frame.id
  return [frame, ...out]
}

export async function importFiles(files: File[], at: Pt) {
  const boardId = S().boardId
  if (!boardId) return
  if (!isLocalBoard(boardId) && !navigator.onLine) { toast('You are offline — files upload when you reconnect. Try again then.'); return }
  at = freeSpot(at, 640, 400)
  let x = at.x
  const created: Item[] = []
  for (const file of files.slice(0, 30)) {
    const name = file.name || 'pasted'
    const ext = name.split('.').pop()?.toLowerCase() || ''
    try {
      if (file.size > 50 * 1024 * 1024) { toast(`${name} is over the 50 MB limit`); continue }
      if (file.type.startsWith('image/') || IMG_EXT.test(name)) {
        const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(name)
        const preview = svg ? null : await makeThumb(file)
        if (!svg && !preview) { toast(`${name} is not a readable image`); continue }
        toast(`Uploading ${name}…`)
        const size = preview ? { w: preview.w, h: preview.h } : await imageSize(file)
        const src = await uploadAsset(boardId, file, name.includes('.') ? name : 'image.png')
        // large images also get a small preview, shown while the image is tiny on screen
        const thumb = preview && preview.blob !== file ? await uploadAsset(boardId, preview.blob, 'preview.webp').catch(() => undefined) : undefined
        const k = Math.min(1, 640 / Math.max(size.w, size.h))
        const w = Math.max(40, size.w * k), h = Math.max(40, size.h * k)
        created.push(make.image({ x, y: at.y - h / 2, w, h, src, thumb, alt: name, nw: size.w, nh: size.h }))
        x += w + 30
      } else if (ext === 'pdf' || file.type === 'application/pdf') {
        const items = await importPdf(file, boardId, { x, y: at.y })
        created.push(...items)
        x += (items[0]?.w || 600) + 60
      } else if (ext === 'ifc') {
        toast(`Uploading ${name}…`)
        const src = await uploadAsset(boardId, file, name)
        created.push(make.ifc({ x, y: at.y - 230, src, name, size: file.size }))
        x += 670
      } else if (ext === 'csv' || ext === 'tsv') {
        const t = tableFrom(parseCsv(await file.text()), { x: 0, y: 0 })
        t.x = x; t.y = at.y - Math.min(t.h, 600) / 2
        created.push(t)
        x += t.w + 30
      } else if (ext === 'json') {
        const data = JSON.parse(await file.text())
        if (data?.app === 'white-canvas' && Array.isArray(data.items)) { pasteItems(normalizeItems(data.items), at); continue }
        created.push(make.code({ x, y: at.y - 110, code: JSON.stringify(data, null, 2).slice(0, 20000), lang: 'json' }))
        x += 450
      } else if (ext === 'md' || ext === 'txt') {
        created.push(make.text({ x, y: at.y, w: 420, html: textToHtml((await file.text()).slice(0, 20000)) }))
        x += 450
      } else {
        toast(`Uploading ${name}…`)
        const src = await uploadAsset(boardId, file, name)
        created.push(make.file({ x, y: at.y - 36, src, name, mime: file.type, size: file.size }))
        x += 290
      }
    } catch (e) {
      toast(`Could not import ${name}: ${(e as Error).message}`)
    }
  }
  if (created.length) {
    // frames go underneath their pages
    addItems(created.sort((a, b) => (a.type === 'frame' ? -1 : 0) - (b.type === 'frame' ? -1 : 0)))
    const box = unionBoxes(created.map((c) => aabb(c)))
    if (box && !intersects(viewBox(), box)) fitBox(box, 80)
    toast(`Added ${created.filter((c) => c.type !== 'frame').length} item${created.length > 1 ? 's' : ''}`)
    // a model added on its own opens straight away: it can be orbited and zoomed at once, and the board gets a real preview
    if (created.length === 1 && created[0].type === 'ifc') {
      // on a narrow screen it can land partly off the edge, where its controls cannot be reached
      const v = viewBox()
      if (box && (box.x < v.x || box.y < v.y || box.x + box.w > v.x + v.w || box.y + box.h > v.y + v.h)) fitBox(box, 80)
      useBoard.setState({ editingId: created[0].id, selection: [created[0].id] })
    }
  }
}

export function pickFiles(accept: string, cb: (files: File[]) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.accept = accept
  input.onchange = () => { if (input.files?.length) cb([...input.files]) }
  input.click()
}
