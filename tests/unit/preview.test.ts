// The dashboard picture of a board. Drawing the real thing needs a browser canvas (covered end to end in
// tests/e2e/live.spec.ts); here the stand-in used where there is no canvas must still account for every item.
import { describe, expect, it } from 'vitest'
import { make } from '../../src/board/defaults'
import { boardPreview, isOldPreview } from '../../src/board/export'
import type { Item } from '../../src/board/types'

describe('board preview', () => {
  it('includes every item, not only the most recent ones', async () => {
    const items: Record<string, Item> = {}
    for (let i = 0; i < 400; i++) { const s = make.sticky({ x: (i % 20) * 220, y: Math.floor(i / 20) * 220 }); items[s.id] = s }
    const svg = await boardPreview(items)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.match(/<rect /g)).toHaveLength(400)
    expect(svg.length).toBeLessThan(262144) // the stored size limit
  })
  it('is empty for an empty board', async () => {
    expect(await boardPreview({})).toBe('')
  })
  it('tells previews from before real pictures apart', () => {
    expect(isOldPreview(null)).toBe(true)
    expect(isOldPreview('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(true)
    expect(isOldPreview('data:image/webp;base64,AAAA')).toBe(false)
  })
})
