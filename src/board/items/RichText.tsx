import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react'
import { sanitize } from '../../lib/util'
import { FONT_STACK } from '../defaults'
import { S, commit, update, useBoard } from '../store'
import type { TextStyle } from '../types'

export function textCss(t: TextStyle, fallbackColor = '#1c1e23'): CSSProperties {
  return {
    fontSize: t.fontSize || 16,
    color: t.color || fallbackColor,
    textAlign: t.align || 'center',
    fontWeight: t.bold ? 700 : 400,
    fontStyle: t.italic ? 'italic' : 'normal',
    textDecoration: [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].join(' ').trim() || 'none',
    fontFamily: FONT_STACK[t.font || 'sans'],
  }
}

export function finishEditing() {
  const s = S()
  if (!s.editingId) return
  const el = document.querySelector<HTMLElement>('[data-editing="true"][data-rich]')
  if (el) {
    const id = s.editingId
    const html = sanitize(el.innerHTML).replace(/^(<br>)+$/, '')
    const it = s.items[id] as { html?: string } | undefined
    if (it && it.html !== html) update(id, { html } as never)
  }
  useBoard.setState({ editingId: null })
  commit()
}

interface Props {
  id: string
  html: string
  editing: boolean
  style?: CSSProperties
  className?: string
  placeholder?: string
  onInput?: (el: HTMLElement) => void
}

/** Text that turns into a contentEditable region while its item is being edited. */
export function RichText({ id, html, editing, style, className, placeholder, onInput }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (!editing || document.activeElement !== el) {
      const clean = sanitize(html)
      if (el.innerHTML !== clean) el.innerHTML = clean
    }
  }, [html, editing])

  useEffect(() => {
    const el = ref.current
    if (!editing || !el) return
    el.focus({ preventScroll: true })
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }, [editing])

  return (
    <div
      ref={ref}
      data-rich
      data-editing={editing ? 'true' : undefined}
      data-placeholder={placeholder}
      contentEditable={editing}
      suppressContentEditableWarning
      spellCheck={editing}
      className={`wc-rich ${className || ''}`}
      style={style}
      onInput={(e) => {
        const el = e.currentTarget
        update(id, { html: sanitize(el.innerHTML) } as never)
        onInput?.(el)
      }}
      onKeyDown={(e) => {
        if (!editing) return
        e.stopPropagation()
        if (e.key === 'Escape') { e.preventDefault(); finishEditing() }
      }}
      onPaste={(e) => {
        // Paste as plain text so foreign styles never leak onto the board.
        e.preventDefault()
        e.stopPropagation()
        const text = e.clipboardData.getData('text/plain')
        document.execCommand('insertText', false, text)
      }}
    />
  )
}
