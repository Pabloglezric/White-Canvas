// Layers, statuses and custom fields: the board-wide lists behind what every item can carry.
// The lists live in the board settings and are shared. This file only reads them; changes are in details.ts.
import { safeColor } from './validate'
import type { BoardSettings, Item, LayerDef, StatusDef } from './types'

export const MAX_LAYERS = 50
export const MAX_STATUSES = 20
export const MAX_FIELDS = 20

export const LAYER_COLORS = ['#0090ff', '#30a46c', '#f76b15', '#e5484d', '#6e56cf', '#d6409f', '#d9a400', '#12a594', '#6b6f7a', '#1c1e23']
export const DEFAULT_STATUSES: StatusDef[] = [
  { name: 'Open', color: '#e5484d' },
  { name: 'In progress', color: '#f76b15' },
  { name: 'For review', color: '#6e56cf' },
  { name: 'Closed', color: '#30a46c' },
]

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** The board's layers, safe to render whatever the stored settings contain. */
export function layersOf(settings: BoardSettings | undefined | null): LayerDef[] {
  const raw = settings?.layers
  if (!Array.isArray(raw)) return []
  const out: LayerDef[] = []
  const seen = new Set<string>()
  for (const l of raw) {
    if (!l || typeof l !== 'object') continue
    const id = text(l.id, 64), name = text(l.name, 60)
    if (!id || !name || seen.has(id)) continue
    seen.add(id)
    out.push({ id, name, color: safeColor(l.color, LAYER_COLORS[out.length % LAYER_COLORS.length]) })
    if (out.length >= MAX_LAYERS) break
  }
  return out
}

export function statusesOf(settings: BoardSettings | undefined | null): StatusDef[] {
  const raw = settings?.statuses
  if (!Array.isArray(raw)) return DEFAULT_STATUSES
  const out: StatusDef[] = []
  const seen = new Set<string>()
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue
    const name = text(s.name, 80)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({ name, color: safeColor(s.color, '#6b6f7a') })
    if (out.length >= MAX_STATUSES) break
  }
  return out
}

export function fieldsOf(settings: BoardSettings | undefined | null): string[] {
  const raw = settings?.fields
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const f of raw) {
    const name = text(f, 60)
    if (name && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name)
    if (out.length >= MAX_FIELDS) break
  }
  return out
}

/** The lists that belong with a board's items when they travel (a copy of the board, a board file). */
export function sharedLists(settings: BoardSettings | undefined | null): Pick<BoardSettings, 'layers' | 'statuses' | 'fields'> {
  const out: Pick<BoardSettings, 'layers' | 'statuses' | 'fields'> = {}
  const layers = layersOf(settings), fields = fieldsOf(settings)
  if (layers.length) out.layers = layers
  if (Array.isArray(settings?.statuses)) out.statuses = statusesOf(settings)
  if (fields.length) out.fields = fields
  return out
}

/** Colour of a status: from the board's list when it is listed, neutral grey for free text. */
export function statusColor(status: string | undefined, list: StatusDef[]): string {
  if (!status) return '#6b6f7a'
  const hit = list.find((s) => s.name.toLowerCase() === status.toLowerCase())
  return hit ? hit.color : '#6b6f7a'
}

/** The value shared by every item, or null when they differ. */
export function common(list: Item[], read: (it: Item) => string | undefined): string | null {
  if (!list.length) return ''
  const first = read(list[0]) || ''
  return list.every((i) => (read(i) || '') === first) ? first : null
}
