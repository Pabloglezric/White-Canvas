// Layer, status, subject and custom fields: the popover on the selection bar, and the Layers panel.
import { Eye, EyeOff, MousePointerClick, Plus, Tag, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { addField, addLayer, removeField, removeLayer, setDetail, setField, setLayerHidden, setStatuses, updateLayer } from '../details'
import { DEFAULT_STATUSES, LAYER_COLORS, MAX_FIELDS, MAX_LAYERS, MAX_STATUSES, common, fieldsOf, layersOf, statusesOf } from '../layers'
import { S, toast, useBoard } from '../store'
import type { Item } from '../types'
import { confirmDialog } from './dialogs'
import { Panel, Pop, Swatches } from './kit'

const Dot = ({ color }: { color: string }) => <span className="wc-ldot" style={{ background: color }} />

/**
 * A text field that saves when you leave it or press Enter, not on every key: each save is one undo step and one
 * write to the board. `value` null means the selected items differ.
 */
function Field({ label, value, onCommit, maxLength, placeholder }: { label: string; value: string | null; onCommit: (v: string) => void; maxLength: number; placeholder?: string }) {
  const [draft, setDraft] = useState(value ?? '')
  // what was typed, and the save that was current when it was typed: the selection may have moved on since
  const dirty = useRef<{ text: string; commit: (v: string) => void } | null>(null)
  useEffect(() => { if (!dirty.current) setDraft(value ?? '') }, [value])
  const save = () => { const d = dirty.current; dirty.current = null; if (d) d.commit(d.text) }
  // a popover that closes takes the field with it without a blur, so the last edit is saved here
  useEffect(() => () => save(), []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      className="wc-input" aria-label={label} maxLength={maxLength} value={draft}
      placeholder={value === null ? 'Mixed' : placeholder}
      onChange={(e) => { setDraft(e.target.value); dirty.current = { text: e.target.value, commit: onCommit } }}
      onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') { save(); (e.target as HTMLInputElement).blur() } }}
    />
  )
}

/** A one-line "type a name, press Add" row. */
function AddRow({ placeholder, onAdd, disabled }: { placeholder: string; onAdd: (name: string) => void; disabled?: boolean }) {
  const [name, setName] = useState('')
  const add = () => { if (name.trim()) { onAdd(name); setName('') } }
  return (
    <div className="wc-row">
      <input className="wc-input" placeholder={placeholder} maxLength={60} value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
      <button className="wc-btn is-line" title={`Add: ${placeholder}`} disabled={disabled || !name.trim()} onClick={add}><Plus size={15} /></button>
    </div>
  )
}

/** The Details button on the selection bar. Everything in it applies to all selected items at once. */
export function DetailsButton({ sel }: { sel: Item[] }) {
  const settings = useBoard((s) => s.meta?.settings)
  const layers = layersOf(settings), statuses = statusesOf(settings), fields = fieldsOf(settings)
  const layer = common(sel, (i) => i.layer), status = common(sel, (i) => i.status), subject = common(sel, (i) => i.subject)
  const ids = sel.map((i) => i.id)
  const any = sel.some((i) => i.layer || i.status || i.subject || i.fields)
  return (
    <Pop button={(o, t) => <button className={`wc-btn ${o ? 'is-on' : ''}`} title="Details: layer, status and fields" onClick={t}><Tag size={15} />{any && <span className="wc-ldot is-mark" />}</button>}>
      <div className="wc-details">
        <div className="wc-label">Layer</div>
        <div className="wc-chips">
          <button className={`wc-pick ${layer === '' ? 'is-on' : ''}`} aria-pressed={layer === ''} onClick={() => setDetail('layer', '')}>None</button>
          {layers.map((l) => (
            <button key={l.id} className={`wc-pick ${layer === l.id ? 'is-on' : ''}`} aria-pressed={layer === l.id} onClick={() => setDetail('layer', l.id)}><Dot color={l.color} /> {l.name}</button>
          ))}
        </div>
        {layers.length < MAX_LAYERS && <AddRow placeholder="New layer" onAdd={(n) => { const l = addLayer(n); if (l) setDetail('layer', l.id) }} />}

        <div className="wc-label">Status</div>
        <div className="wc-chips">
          <button className={`wc-pick ${status === '' ? 'is-on' : ''}`} aria-pressed={status === ''} onClick={() => setDetail('status', '')}>None</button>
          {statuses.map((s) => (
            <button key={s.name} className={`wc-pick ${status === s.name ? 'is-on' : ''}`} aria-pressed={status === s.name} onClick={() => setDetail('status', s.name)}><Dot color={s.color} /> {s.name}</button>
          ))}
        </div>
        <Field label="Status" value={status} maxLength={80} placeholder="Or type your own" onCommit={(v) => setDetail('status', v, ids)} />

        <div className="wc-label">Subject</div>
        <Field label="Subject" value={subject} maxLength={200} placeholder="What it is about" onCommit={(v) => setDetail('subject', v, ids)} />

        {fields.length > 0 && <div className="wc-label">Your fields</div>}
        {fields.map((f) => (
          <label key={f} className="wc-field-row">
            <span className="truncate" title={f}>{f}</span>
            <Field label={f} value={common(sel, (i) => i.fields?.[f])} maxLength={500} onCommit={(v) => setField(f, v, ids)} />
          </label>
        ))}
        {fields.length < MAX_FIELDS && <AddRow placeholder="New field, e.g. Trade" onAdd={(n) => { if (!addField(n)) toast('That field could not be added') }} />}
        <button className="wc-btn is-line" onClick={() => useBoard.setState({ panel: 'layers', activeComment: null })}>Manage layers and lists</button>
      </div>
    </Pop>
  )
}

const closePanel = () => useBoard.setState({ panel: null })

export function LayersPanel() {
  const settings = useBoard((s) => s.meta?.settings)
  const items = useBoard((s) => s.items)
  const hidden = useBoard((s) => s.hiddenLayers)
  const role = useBoard((s) => s.role)
  const editor = role === 'owner' || role === 'editor'
  const layers = layersOf(settings), statuses = statusesOf(settings), fields = fieldsOf(settings)
  const count: Record<string, number> = {}
  let loose = 0
  for (const it of Object.values(items)) {
    if (it.type === 'comment') continue
    if (it.layer && layers.some((l) => l.id === it.layer)) count[it.layer] = (count[it.layer] || 0) + 1
    else loose++
  }
  const pick = (ids: string[]) => { useBoard.setState({ selection: ids, tool: 'select' }); if (!ids.length) toast('Nothing on that layer yet') }
  return (
    <Panel title="Layers" onClose={closePanel}>
      <p className="wc-note">Put items on a layer from the Details button (the tag) on a selection. The eye hides a layer for you only; everyone else still sees it.</p>
      {layers.map((l) => {
        const off = hidden.includes(l.id)
        return (
          <div key={l.id} className="wc-row wc-layer" data-layer={l.name} style={{ opacity: off ? 0.55 : 1 }}>
            {editor ? (
              <Pop placement="bottom" button={(_o, t) => <button className="wc-icon-btn" title={`Colour of ${l.name}`} onClick={t}><Dot color={l.color} /></button>}>
                <Swatches colors={LAYER_COLORS} value={l.color} onPick={(c) => updateLayer(l.id, { color: c })} />
              </Pop>
            ) : <span className="wc-icon-btn"><Dot color={l.color} /></span>}
            {editor
              ? <LayerName name={l.name} onRename={(n) => updateLayer(l.id, { name: n })} />
              : <span className="flex-1 truncate">{l.name}</span>}
            <span className="text-xs" style={{ color: 'var(--ink-3)' }} title="Items on this layer">{count[l.id] || 0}</span>
            <button className="wc-icon-btn" title={`Select everything on ${l.name}`} disabled={off} onClick={() => pick(Object.values(S().items).filter((i) => i.layer === l.id && !i.locked).map((i) => i.id))}><MousePointerClick size={15} /></button>
            <button className="wc-icon-btn" title={off ? `Show ${l.name}` : `Hide ${l.name} for me`} aria-pressed={off} onClick={() => setLayerHidden(l.id, !off)}>{off ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            {editor && (
              <button
                className="wc-icon-btn" title={`Delete layer ${l.name}`}
                onClick={async () => { if (!count[l.id] || await confirmDialog({ title: `Delete the layer "${l.name}"?`, message: `Its ${count[l.id]} item${count[l.id] === 1 ? '' : 's'} stay on the board, on no layer.`, confirmLabel: 'Delete layer', danger: true })) removeLayer(l.id) }}
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        )
      })}
      <div className="wc-row wc-layer" style={{ color: 'var(--ink-3)' }}>
        <span className="wc-icon-btn"><Dot color="transparent" /></span>
        <span className="flex-1">No layer</span>
        <span className="text-xs">{loose}</span>
      </div>
      {editor && layers.length < MAX_LAYERS && <AddRow placeholder="New layer" onAdd={(n) => { if (!addLayer(n)) toast('That layer could not be added') }} />}
      {hidden.length > 0 && <button className="wc-btn is-line" style={{ marginTop: 8 }} onClick={() => hidden.forEach((id) => setLayerHidden(id, false))}>Show all layers</button>}

      <div className="wc-label" style={{ marginTop: 18 }}>Statuses</div>
      <p className="wc-note">The usual values offered on every item. Anyone can still type their own.</p>
      {statuses.map((s) => (
        <div key={s.name} className="wc-row wc-layer">
          {editor ? (
            <Pop placement="bottom" button={(_o, t) => <button className="wc-icon-btn" title={`Colour of ${s.name}`} onClick={t}><Dot color={s.color} /></button>}>
              <Swatches colors={LAYER_COLORS} value={s.color} onPick={(c) => setStatuses(statuses.map((x) => (x.name === s.name ? { ...x, color: c } : x)))} />
            </Pop>
          ) : <span className="wc-icon-btn"><Dot color={s.color} /></span>}
          <span className="flex-1 truncate">{s.name}</span>
          {editor && <button className="wc-icon-btn" title={`Remove status ${s.name} from the list`} onClick={() => setStatuses(statuses.filter((x) => x.name !== s.name))}><X size={15} /></button>}
        </div>
      ))}
      {editor && statuses.length < MAX_STATUSES && <AddRow placeholder="New status" onAdd={(n) => setStatuses([...statuses, { name: n.trim().slice(0, 80), color: LAYER_COLORS[statuses.length % LAYER_COLORS.length] }])} />}
      {editor && settings?.statuses && <button className="wc-btn is-line" style={{ marginTop: 8 }} onClick={() => setStatuses(DEFAULT_STATUSES)}>Back to the standard list</button>}

      <div className="wc-label" style={{ marginTop: 18 }}>Your fields</div>
      <p className="wc-note">Extra boxes offered on every item, for example Trade, Drawing number or Cost code.</p>
      {fields.map((f) => (
        <div key={f} className="wc-row wc-layer">
          <span className="wc-icon-btn"><Tag size={14} /></span>
          <span className="flex-1 truncate">{f}</span>
          {editor && <button className="wc-icon-btn" title={`Remove field ${f} from the list`} onClick={() => removeField(f)}><X size={15} /></button>}
        </div>
      ))}
      {editor && fields.length < MAX_FIELDS && <AddRow placeholder="New field" onAdd={(n) => { if (!addField(n)) toast('That field could not be added') }} />}
    </Panel>
  )
}

function LayerName({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [draft, setDraft] = useState(name)
  useEffect(() => { setDraft(name) }, [name])
  const save = () => { const n = draft.trim(); if (n && n !== name) onRename(n); else setDraft(name) }
  return <input className="wc-layer-name" aria-label={`Name of layer ${name}`} maxLength={60} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
}
