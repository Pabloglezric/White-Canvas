import DOMPurify from 'dompurify'

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const round = (v: number, p = 1) => Math.round(v * 10 ** p) / 10 ** p

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function textToHtml(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br>')
}

export function htmlToText(html: string): string {
  if (!html) return ''
  const d = document.createElement('div')
  d.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p|li)>/gi, '\n')
  return (d.textContent || '').replace(/\n+$/, '')
}

const ALLOWED = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'br', 'div', 'p', 'span', 'ul', 'ol', 'li', 'a', 'code', 'mark', 'font']
export function sanitize(html: string): string {
  return DOMPurify.sanitize(html || '', {
    ALLOWED_TAGS: ALLOWED,
    ALLOWED_ATTR: ['href', 'target', 'rel', 'style', 'color'],
  })
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined
  const d = (...a: Parameters<T>) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => { t = undefined; fn(...a) }, ms)
  }
  d.flush = (...a: Parameters<T>) => { if (t) { clearTimeout(t); t = undefined; fn(...a) } }
  d.cancel = () => { if (t) clearTimeout(t); t = undefined }
  return d
}

export function throttle<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let last = 0
  let t: ReturnType<typeof setTimeout> | undefined
  let args: Parameters<T>
  return (...a: Parameters<T>) => {
    args = a
    const now = Date.now()
    if (now - last >= ms) { last = now; fn(...args) }
    else if (!t) t = setTimeout(() => { t = undefined; last = Date.now(); fn(...args) }, ms - (now - last))
  }
}

export function timeAgo(d: string | number | Date): string {
  const s = (Date.now() - new Date(d).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`
  return new Date(d).toLocaleDateString()
}

export function formatBytes(n?: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function download(name: string, data: Blob | string, mime = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function parseCsv(text: string): string[][] {
  const delim = text.includes('\t') && !/,/.test(text.split('\n')[0] || '') ? '\t' : (text.split('\n')[0] || '').includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === delim) { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = '' }
    else if (c !== '\r') cur += c
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row) }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const isTouchDevice = typeof window !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)

export function initials(name: string): string {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?'
}

export const USER_COLORS = ['#e5484d', '#f76b15', '#d9a400', '#30a46c', '#12a594', '#0090ff', '#6e56cf', '#d6409f', '#8d6e63', '#3e63dd']
export function colorFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return USER_COLORS[h % USER_COLORS.length]
}
