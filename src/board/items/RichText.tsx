import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { FONT_STACK } from '../defaults'
import { S, commit, mutate, update, useBoard } from '../store'
import type { TextStyle } from '../types'
import { cleanHtml } from '../validate'

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

const isBlank = (html: string) => !html.replace(/<br\s*\/?>|<\/?(div|p|span)>|&nbsp;|\s/gi, '')

/** Leaves edit mode, saving the text. Free-standing text that ended up empty is removed rather than left as a ghost. */
export function finishEditing() {
  const s = S()
  const id = s.editingId
  if (!id) return
  const el = document.querySelector<HTMLElement>('[data-editing="true"][data-rich]')
  const it = s.items[id] as ({ html?: string; type: string } | undefined)
  if (el && it) {
    const html = isBlank(el.innerHTML) ? '' : cleanHtml(el.innerHTML)
    if (it.html !== html) update(id, { html } as never)
  }
  const now = S().items[id] as ({ html?: string; type: string } | undefined)
  useBoard.setState({ editingId: null })
  if (now && now.type === 'text' && isBlank(now.html || '')) {
    mutate({ [id]: null })
    useBoard.setState({ selection: S().selection.filter((x) => x !== id) })
  }
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
      const clean = cleanHtml(html)
      if (el.innerHTML !== clean) el.innerHTML = clean
    }
  }, [html, editing])

  // Focus in a layout effect: together with the synchronous render on tap this keeps the focus call
  // inside the user gesture, which is what makes on-screen keyboards open reliably.
  useLayoutEffect(() => {
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
      dir="auto"
      data-rich
      data-editing={editing ? 'true' : undefined}
      data-placeholder={placeholder}
      contentEditable={editing}
      suppressContentEditableWarning
      spellCheck={editing}
      role={editing ? 'textbox' : undefined}
      aria-multiline={editing ? true : undefined}
      className={`wc-rich ${className || ''}`}
      style={style}
      onInput={(e) => {
        const el = e.currentTarget
        update(id, { html: cleanHtml(el.innerHTML) } as never)
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
