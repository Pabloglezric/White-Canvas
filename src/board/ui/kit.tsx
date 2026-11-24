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

const COLOR_NAMES: Record<string, string> = {
  '#fff2a8': 'Yellow', '#ffd98a': 'Amber', '#ffb7a0': 'Coral', '#ffb3d1': 'Pink', '#e3c4ff': 'Lilac', '#b9c8ff': 'Periwinkle', '#a8dcff': 'Sky blue',
  '#a6ecd9': 'Mint', '#c4eea6': 'Green', '#e6e4dc': 'Stone', '#ffffff': 'White', '#2b2d33': 'Charcoal', '#f1f0ec': 'Paper', '#e5484d': 'Red', '#f76b15': 'Orange',
  '#30a46c': 'Emerald', '#0090ff': 'Blue', '#6e56cf': 'Violet', '#1c1e23': 'Ink', '#6b6f7a': 'Grey', '#d9a400': 'Gold', '#d6409f': 'Magenta',
  '#ffe14d': 'Yellow highlight', '#7df0a8': 'Green highlight', '#7cd6ff': 'Blue highlight', '#ff9ecb': 'Pink highlight', '#ffb066': 'Orange highlight',
}

export function Swatches({ colors, value, onPick, allowNone }: { colors: string[]; value?: string; onPick: (c: string) => void; allowNone?: boolean }) {
  return (
    <div className="wc-swatches">
      {colors.filter((c) => allowNone || c !== 'transparent').map((c) => (
        <button
          key={c}
          className={`wc-swatch ${value === c ? 'is-on' : ''} ${c === 'transparent' ? 'is-none' : ''}`}
          style={c === 'transparent' ? undefined : { background: c }}
          title={c === 'transparent' ? 'No fill' : COLOR_NAMES[c] || c}
          aria-pressed={value === c}
          onClick={() => onPick(c)}
        />
      ))}
      <label className="wc-swatch" title="Custom colour" style={{ background: 'conic-gradient(#e5484d, #d9a400, #30a46c, #0090ff, #6e56cf, #e5484d)', overflow: 'hidden', cursor: 'pointer' }}>
        <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#2f6fed'} onChange={(e) => onPick(e.target.value)} style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
      </label>
    </div>
  )
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Closes on Escape (even while typing in a field), keeps Tab inside, and hands focus back when it goes away. */
function useDialogKeys(ref: React.RefObject<HTMLElement | null>, onClose: () => void, trap: boolean) {
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const el = ref.current
    if (trap) (el?.querySelector<HTMLElement>('[autofocus], input, textarea, select') || el?.querySelector<HTMLElement>(FOCUSABLE))?.focus()
    const key = (e: KeyboardEvent) => {
      const inside = !!el && el.contains(document.activeElement)
      if (e.key === 'Escape' && (trap || inside)) {
        if (document.querySelector('.wc-pop')) return // an open popover closes first
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab' && trap && el) {
        const list = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null)
        if (!list.length) return
        const first = list[0], last = list[list.length - 1]
        if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('keydown', key, true); if (trap && before?.isConnected) before.focus?.() }
  }, [onClose, trap]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogKeys(ref, onClose, true)
  return createPortal(
    <div className="wc-modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="wc-modal wc-surface" style={wide ? { width: 'min(860px, 100%)' } : undefined}>
        <div className="wc-panel-head"><h2 className="flex-1 truncate">{title}</h2><button className="wc-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="wc-panel-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

export function Panel({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogKeys(ref, onClose, false)
  return (
    <div ref={ref} role="dialog" aria-label={title} className="wc-ui wc-panel wc-surface">
      <div className="wc-panel-head"><h2 className="flex-1 truncate">{title}</h2>{actions}<button className="wc-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      <div className="wc-panel-body">{children}</div>
    </div>
  )
}

/**
 * Gives every control an accessible name. Icon buttons carry their label in `title`, and fields in
 * `placeholder`; this mirrors those into `aria-label` wherever one was not set explicitly.
 */
export function useAccessibleNames() {
  useEffect(() => {
    const name = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>('button[title]:not([aria-label]), a[title]:not([aria-label]), [role="button"][title]:not([aria-label])').forEach((el) => el.setAttribute('aria-label', el.title))
      root.querySelectorAll<HTMLInputElement>('input[placeholder]:not([aria-label]):not([id]), textarea[placeholder]:not([aria-label]):not([id])').forEach((el) => el.setAttribute('aria-label', el.placeholder))
    }
    name(document)
    const mo = new MutationObserver((list) => {
      for (const m of list) {
        if (m.type === 'attributes') { const el = m.target as HTMLElement; if (el.title && (el.tagName === 'BUTTON' || el.tagName === 'A')) el.setAttribute('aria-label', el.title) }
        else m.addedNodes.forEach((node) => { if (node.nodeType === 1) name(node as Element) })
      }
    })
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] })
    return () => mo.disconnect()
  }, [])
}
