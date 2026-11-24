// In-app confirm and prompt dialogs (replacing the browser's blocking prompt()/confirm()).
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Modal } from './kit'

interface Ask {
  kind: 'confirm' | 'prompt'
  title: string
  message?: string
  label?: string
  value?: string
  confirmLabel?: string
  danger?: boolean
  resolve: (v: string | boolean | null) => void
}
const useDialog = create<{ ask: Ask | null }>(() => ({ ask: null }))

export function confirmDialog(o: { title: string; message?: string; confirmLabel?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => useDialog.setState({ ask: { kind: 'confirm', ...o, resolve: (v) => resolve(v === true) } }))
}
export function promptDialog(o: { title: string; label?: string; value?: string; confirmLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => useDialog.setState({ ask: { kind: 'prompt', ...o, resolve: (v) => resolve(typeof v === 'string' ? v : null) } }))
}

export function DialogHost() {
  const ask = useDialog((s) => s.ask)
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { setValue(ask?.value || ''); if (ask?.kind === 'prompt') setTimeout(() => input.current?.select(), 30) }, [ask])
  if (!ask) return null
  const done = (v: string | boolean | null) => { useDialog.setState({ ask: null }); ask.resolve(v) }
  const ok = () => done(ask.kind === 'prompt' ? value.trim() || null : true)
  return (
    <Modal title={ask.title} onClose={() => done(null)}>
      <form onSubmit={(e) => { e.preventDefault(); ok() }}>
        {ask.message && <p className="mb-3" style={{ color: 'var(--ink-2)' }}>{ask.message}</p>}
        {ask.kind === 'prompt' && (
          <label className="block mb-3">
            {ask.label && <span className="wc-label block mb-1">{ask.label}</span>}
            <input ref={input} className="wc-input" value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
        )}
        <div className="wc-row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="wc-btn is-line" onClick={() => done(null)}>Cancel</button>
          <button type="submit" className="wc-btn is-accent" autoFocus={ask.kind === 'confirm'} style={ask.danger ? { background: 'var(--danger)' } : undefined}>{ask.confirmLabel || 'OK'}</button>
        </div>
      </form>
    </Modal>
  )
}
