// Changes to layers, statuses and custom fields: the board-wide lists, each person's hidden layers, and the
// values on items. Which layers are hidden is each person's own choice (kept on the device), so one reviewer
// hiding a layer never hides it for the others.
import { uid } from '../lib/util'
import { LAYER_COLORS, MAX_FIELDS, MAX_LAYERS, fieldsOf, layersOf, statusesOf } from './layers'
import { S, apply, canEdit, hiddenLayersKey, isHidden, useBoard, type Patch } from './store'
import { updateMeta } from './sync'
import type { Item, LayerDef, StatusDef } from './types'
import { safeColor } from './validate'

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// ---------- hidden layers (per person, per board) ----------

export function setLayerHidden(layerId: string, hide: boolean) {
  const s = S()
  const known = new Set(layersOf(s.meta?.settings).map((l) => l.id))
  const next = s.hiddenLayers.filter((id) => id !== layerId && known.has(id))
  if (hide && known.has(layerId)) next.push(layerId)
  // nothing that just disappeared stays selected or in edit
  const gone = (id: string) => { const it = s.items[id]; return !!it && isHidden(it, next) }
  useBoard.setState({ hiddenLayers: next, selection: s.selection.filter((id) => !gone(id)), editingId: s.editingId && gone(s.editingId) ? null : s.editingId })
  if (s.boardId) try { localStorage.setItem(hiddenLayersKey(s.boardId), JSON.stringify(next)) } catch { /* private mode */ }
}

// ---------- board-wide lists ----------

export function addLayer(name: string): LayerDef | null {
  const s = S()
  const list = layersOf(s.meta?.settings)
  const clean = text(name, 60)
  if (!canEdit() || !clean || list.length >= MAX_LAYERS) return null
  const same = list.find((l) => l.name.toLowerCase() === clean.toLowerCase())
  if (same) return same
  const layer: LayerDef = { id: uid(), name: clean, color: LAYER_COLORS[list.length % LAYER_COLORS.length] }
  void updateMeta({ settings: { layers: [...list, layer] } })
  return layer
}

export function updateLayer(id: string, patch: Partial<Pick<LayerDef, 'name' | 'color'>>) {
  if (!canEdit()) return
  const list = layersOf(S().meta?.settings)
  const name = patch.name === undefined ? undefined : text(patch.name, 60)
  if (name === '') return
  void updateMeta({ settings: { layers: list.map((l) => (l.id === id ? { ...l, ...(name ? { name } : {}), ...(patch.color ? { color: safeColor(patch.color, l.color) } : {}) } : l)) } })
}

/** Removes a layer. Its items stay on the board, on no layer. */
export function removeLayer(id: string) {
  const s = S()
  if (!canEdit()) return
  const patch: Patch = {}
  for (const it of Object.values(s.items)) if (it.layer === id) { const { layer: _layer, ...rest } = it; patch[it.id] = rest as Item }
  if (Object.keys(patch).length) apply(patch)
  setLayerHidden(id, false)
  void updateMeta({ settings: { layers: layersOf(s.meta?.settings).filter((l) => l.id !== id) } })
}

export function setStatuses(list: StatusDef[]) {
  if (canEdit()) void updateMeta({ settings: { statuses: statusesOf({ statuses: list }) } })
}

export function addField(name: string): string | null {
  const list = fieldsOf(S().meta?.settings)
  const clean = text(name, 60)
  if (!canEdit() || !clean || clean === '__proto__' || clean === 'constructor' || clean === 'prototype') return null
  const same = list.find((f) => f.toLowerCase() === clean.toLowerCase())
  if (same) return same
  if (list.length >= MAX_FIELDS) return null
  void updateMeta({ settings: { fields: [...list, clean] } })
  return clean
}

/** Removes a custom field from the board's list. Values already typed on items are kept. */
export function removeField(name: string) {
  if (canEdit()) void updateMeta({ settings: { fields: fieldsOf(S().meta?.settings).filter((f) => f !== name) } })
}

/**
 * Takes in the lists that came with items from elsewhere (a board file): layers this board lacks are added under
 * their own ids, so the items keep their layer; new field names join the list. Statuses stay as this board has them.
 */
export function adoptLists(lists: unknown) {
  const s = S()
  if (!canEdit() || !lists || typeof lists !== 'object') return
  const mine = layersOf(s.meta?.settings), myFields = fieldsOf(s.meta?.settings)
  const layers = [...mine, ...layersOf(lists as { layers?: LayerDef[] }).filter((l) => !mine.some((m) => m.id === l.id))].slice(0, MAX_LAYERS)
  const fields = fieldsOf({ fields: [...myFields, ...fieldsOf(lists as { fields?: string[] })] })
  if (layers.length !== mine.length || fields.length !== myFields.length) void updateMeta({ settings: { layers, fields } })
}

// ---------- values on items ----------

/** Sets layer, status or subject on the selected items; an empty value clears it. */
export function setDetail(key: 'layer' | 'status' | 'subject', value: string, ids = S().selection) {
  const { items } = S()
  if (!canEdit()) return
  const max = key === 'subject' ? 200 : key === 'status' ? 80 : 64
  const v = value.trim().slice(0, max)
  const patch: Patch = {}
  for (const id of ids) {
    const it = items[id]
    if (!it || it.locked || it.type === 'comment' || (it[key] || '') === v) continue
    const next = { ...it } as Item
    if (v) next[key] = v
    else delete next[key]
    patch[id] = next
  }
  if (Object.keys(patch).length) apply(patch)
}

/** Sets one custom field on the selected items; an empty value removes it from them. */
export function setField(name: string, value: string, ids = S().selection) {
  const { items } = S()
  if (!canEdit() || !name) return
  const v = value.slice(0, 500)
  const patch: Patch = {}
  for (const id of ids) {
    const it = items[id]
    if (!it || it.locked || it.type === 'comment' || (it.fields?.[name] || '') === v) continue
    const fields = { ...(it.fields || {}) }
    if (v.trim()) fields[name] = v
    else delete fields[name]
    const next = { ...it } as Item
    if (Object.keys(fields).length) next.fields = fields
    else delete next.fields
    patch[id] = next
  }
  if (Object.keys(patch).length) apply(patch)
}
