import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const f = () => setOn(m.matches)
    f()
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [query])
  return on
}
export const useNarrow = () => useMedia('(max-width: 640px), (max-height: 520px)')
export const useFlexMode = () => useMedia('(vertical-viewport-segments: 2)')

interface PopProps {
  button: (open: boolean, toggle: () => void) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  placement?: 'top' | 'bottom' | 'right'
  className?: string
}

/** Anchored popover rendered in a portal; closes on outside press or Escape. */
export function Pop({ button, children, placement = 'top', className }: PopProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const a = anchor.current?.getBoundingClientRect(), p = pop.current?.getBoundingClientRect()
    if (!a || !p) return
    const vw = window.innerWidth, vh = window.innerHeight
    let left = placement === 'right' ? a.right + 10 : a.left + a.width / 2 - p.width / 2
    let top = placement === 'right' ? a.top : placement === 'top' ? a.top - p.height - 10 : a.bottom + 10
    if (placement === 'top' && top < 8) top = a.bottom + 10
    if (placement === 'bottom' && top + p.height > vh - 8) top = a.top - p.height - 10
    if (placement === 'right' && left + p.width > vw - 8) { left = a.left + a.width / 2 - p.width / 2; top = a.top - p.height - 10 }
    left = Math.max(8, Math.min(vw - p.width - 8, left))
    top = Math.max(8, Math.min(vh - p.height - 8, top))
    setPos({ left, top })
  }, [open, placement])

  useEffect(() => {
    if (!open) return
    const down = (e: PointerEvent) => {
      const t = e.target as Node
      if (pop.current?.contains(t) || anchor.current?.contains(t)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key) }
  }, [open])

  return (
    <>
      <span ref={anchor} style={{ display: 'inline-flex' }}>{button(open, () => setOpen((o) => !o))}</span>
      {open && createPortal(
        <div ref={pop} className={`wc-pop wc-surface ${className || ''}`} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>,
        document.body,
      )}
    </>
  )
}

export function Swatches({ colors, value, onPick, allowNone }: { colors: string[]; value?: string; onPick: (c: string) => void; allowNone?: boolean }) {
  return (
    <div className="wc-swatches">
      {colors.filter((c) => allowNone || c !== 'transparent').map((c) => (
        <button
          key={c}
          className={`wc-swatch ${value === c ? 'is-on' : ''} ${c === 'transparent' ? 'is-none' : ''}`}
          style={c === 'transparent' ? undefined : { background: c }}
          title={c === 'transparent' ? 'No fill' : c}
          onClick={() => onPick(c)}
        />
      ))}
      <label className="wc-swatch" title="Custom colour" style={{ background: 'conic-gradient(#e5484d, #d9a400, #30a46c, #0090ff, #6e56cf, #e5484d)', overflow: 'hidden', cursor: 'pointer' }}>
        <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#2f6fed'} onChange={(e) => onPick(e.target.value)} style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
      </label>
    </div>
  )
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return createPortal(
    <div className="wc-modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="wc-modal wc-surface" style={wide ? { width: 'min(860px, 100%)' } : undefined}>
        <div className="wc-panel-head"><span className="flex-1 truncate">{title}</span><button className="wc-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="wc-panel-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Panel({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="wc-ui wc-panel wc-surface">
      <div className="wc-panel-head"><span className="flex-1 truncate">{title}</span>{actions}<button className="wc-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      <div className="wc-panel-body">{children}</div>
    </div>
  )
}
