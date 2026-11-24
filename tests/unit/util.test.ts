import { describe, expect, it } from 'vitest'
import { htmlToText, parseCsv, sanitize, textToHtml } from '../../src/lib/util'

describe('text helpers', () => {
  it('escapes text into html and back', () => {
    const html = textToHtml('a < b\n& c')
    expect(html).toBe('a &lt; b<br>&amp; c')
    expect(htmlToText(html)).toBe('a < b\n& c')
  })
  it('strips scripts, handlers and unsafe links', () => {
    const out = sanitize('<b onclick="x()">hi</b><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">l</a>')
    expect(out).not.toMatch(/script|onclick|onerror|javascript:|<img/i)
    expect(out).toContain('<b>hi</b>')
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
