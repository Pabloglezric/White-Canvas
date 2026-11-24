import { describe, expect, it } from 'vitest'
import { escapeAttr, htmlToText, parseCsv, textToHtml } from '../../src/lib/util'
import { cleanHtml, normalizeItem, normalizeItems, safeAssetSrc, safeColor, safeHttpUrl } from '../../src/board/validate'

describe('text helpers', () => {
  it('escapes text into html and back', () => {
    const html = textToHtml('a < b\n& c')
    expect(html).toBe('a &lt; b<br>&amp; c')
    expect(htmlToText(html)).toBe('a < b\n& c')
  })
  it('strips scripts, handlers, styles and unsafe links', () => {
    const out = cleanHtml('<b onclick="x()" style="position:fixed">hi</b><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">l</a><a href="https://example.com">ok</a>')
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|<img|style=/i)
    expect(out).toContain('<b>hi</b>')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
  })
  it('extracts text without executing or loading anything', () => {
    ;(globalThis as Record<string, unknown>).__probe = 0
    expect(htmlToText('<img src=x onerror="globalThis.__probe=1">hello<br>world')).toBe('hello\nworld')
    expect((globalThis as Record<string, unknown>).__probe).toBe(0)
  })
  it('escapes attribute values', () => {
    expect(escapeAttr('"><script>')).toBe('&quot;&gt;&lt;script&gt;')
  })
})

describe('validation of incoming items', () => {
  const base = { id: 'a1', x: 0, y: 0, w: 100, h: 100, rev: 1 }
  it('drops unusable data', () => {
    expect(normalizeItem(null)).toBeNull()
    expect(normalizeItem('nope')).toBeNull()
    expect(normalizeItem({ ...base, type: 'mystery' })).toBeNull()
    expect(normalizeItem({ ...base, id: '', type: 'sticky' })).toBeNull()
    expect(normalizeItem({ ...base, type: 'draw' })).toBeNull()
    expect(normalizeItem({ ...base, type: 'image', src: 'javascript:alert(1)' })).toBeNull()
    expect(normalizeItem({ ...base, type: 'embed', url: 'javascript:alert(1)' })).toBeNull()
  })
  it('repairs missing and hostile fields instead of crashing later', () => {
    const c = normalizeItem({ id: 'c', type: 'connector', rev: 1 })!
    expect(c.type === 'connector' && Number.isFinite(c.a.x) && c.route === 'elbow').toBe(true)
    const t = normalizeItem({ ...base, type: 'table' })!
    expect(t.type === 'table' && t.cells.length === 1 && t.colW.length === 1 && t.rowH.length === 1).toBe(true)
    const k = normalizeItem({ ...base, type: 'comment' })!
    expect(k.type === 'comment' && Array.isArray(k.thread)).toBe(true)
    const s = normalizeItem({ ...base, type: 'sticky', x: NaN, y: Infinity, w: -5, h: 0, fill: '"/><script>', html: '<img src=x onerror=1>hi', tags: 'x' })!
    expect(s.type === 'sticky' && s.x === 0 && s.y === 0 && s.w === 1 && s.h === 1 && s.fill === '#fff2a8' && s.html === 'hi' && s.tags === undefined).toBe(true)
  })
  it('keeps valid items intact', () => {
    const src = { ...base, type: 'shape', kind: 'diamond', html: '<b>Go</b>', fill: '#c4eea6', stroke: '#1c1e23', strokeW: 2, rot: 45, z: 3, parent: 'f1', locked: true }
    const out = normalizeItem(src)!
    expect(out).toMatchObject(src)
  })
  it('filters lists', () => {
    expect(normalizeItems([{ ...base, type: 'sticky' }, 5, { type: 'x' }]).length).toBe(1)
    expect(normalizeItems('nope')).toEqual([])
  })
  it('checks colours and urls strictly', () => {
    expect(safeColor('#ff5a36', 'x')).toBe('#ff5a36')
    expect(safeColor('transparent', 'x')).toBe('transparent')
    expect(safeColor('red;background:url(x)', 'x')).toBe('x')
    expect(safeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1')
    expect(safeHttpUrl('data:text/html,<script>')).toBeUndefined()
    expect(safeHttpUrl('not a url')).toBeUndefined()
    expect(safeAssetSrc('asset:11111111-1111-4111-8111-111111111111/abc.png')).toBeTruthy()
    expect(safeAssetSrc('asset:../../etc/passwd')).toBeUndefined()
    expect(safeAssetSrc('data:image/svg+xml;base64,AAAA')).toBeUndefined()
  })
})

describe('csv parsing', () => {
  it('handles quotes, commas and newlines inside cells', () => {
    expect(parseCsv('a,b\n"x, y","line1\nline2"\n')).toEqual([['a', 'b'], ['x, y', 'line1\nline2']])
  })
  it('detects tab-separated data', () => {
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('drops empty rows', () => {
    expect(parseCsv('a,b\n\n,\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })
})
