import { expect, test } from '@playwright/test'
import { drag, esc2, newBoard, snap, watchErrors } from './helpers'

test('create, connect, move, undo and persist', async ({ page }) => {
  const errors = watchErrors(page)
  await newBoard(page)
  await page.keyboard.press('n'); await page.mouse.click(400, 300); await page.keyboard.type('Idea one'); await esc2(page)
  await page.keyboard.press('s'); await drag(page, [650, 220], [850, 340]); await page.keyboard.type('Decision'); await esc2(page)
  await page.keyboard.press('l'); await page.mouse.move(420, 320); await page.mouse.down(); await page.mouse.move(600, 300, { steps: 5 }); await page.mouse.move(740, 280, { steps: 5 }); await page.mouse.up(); await esc2(page)
  let s = await snap(page)
  expect(s.types).toEqual(['connector', 'shape', 'sticky'])
  const conn = Object.values(s.items).find((i: any) => i.type === 'connector') as any
  expect(conn.a.item && conn.b.item).toBeTruthy()
  const sticky = Object.values(s.items).find((i: any) => i.type === 'sticky') as any
  expect(sticky.html).toBe('Idea one')

  // move the shape; the item moves and one undo restores it
  const before = Object.values(s.items).find((i: any) => i.type === 'shape') as any
  await drag(page, [750, 235], [800, 500])
  s = await snap(page)
  const moved = s.items[before.id]
  expect(moved.y - before.y).toBeGreaterThan(200)
  await page.keyboard.press('Control+z')
  expect((await snap(page)).items[before.id].y).toBeCloseTo(before.y, 0)

  // duplicate, select all, delete, undo
  await page.mouse.click(400, 300)
  await page.keyboard.press('Control+d')
  expect((await snap(page)).n).toBe(4)
  await page.keyboard.press('Control+a'); await page.keyboard.press('Delete')
  expect((await snap(page)).n).toBe(0)
  await page.keyboard.press('Control+z')
  expect((await snap(page)).n).toBe(4)

  // survives a reload
  await page.waitForTimeout(900)
  await page.reload()
  await page.waitForFunction(() => (window as any).__wc?.useBoard.getState().status === 'ready')
  expect((await snap(page)).n).toBe(4)
  expect(errors).toEqual([])
})

test('resize, rotate and text editing by double-click', async ({ page }) => {
  await newBoard(page)
  await page.keyboard.press('n'); await page.mouse.click(500, 350); await page.keyboard.type('Resize me'); await esc2(page)
  await page.mouse.click(500, 350)
  const se = (await page.locator('.wc-handle.h-se').boundingBox())!
  await drag(page, [se.x + 5, se.y + 5], [se.x + 85, se.y + 85])
  let it = Object.values((await snap(page)).items)[0] as any
  expect(it.w).toBeGreaterThan(260)
  const rot = (await page.locator('.wc-handle.is-rot').boundingBox())!
  await drag(page, [rot.x + 8, rot.y + 8], [rot.x - 70, rot.y - 50])
  it = Object.values((await snap(page)).items)[0] as any
  expect(it.rot).not.toBe(0)
  await esc2(page)
  await page.mouse.dblclick(200, 650)
  await page.keyboard.type('Free text')
  await esc2(page)
  const s = await snap(page)
  expect(s.types).toEqual(['sticky', 'text'])
  expect((Object.values(s.items).find((i: any) => i.type === 'text') as any).html).toBe('Free text')
})

test('templates, frames and presentation mode', async ({ page }) => {
  await newBoard(page)
  await page.getByRole('button', { name: 'Insert' }).click()
  await page.getByText('Templates').click()
  await page.getByText('Kanban board').click()
  await expect.poll(async () => (await snap(page)).n).toBeGreaterThan(8)
  const s = await snap(page)
  expect(s.types.filter((t) => t === 'frame').length).toBe(4)
  await page.getByRole('button', { name: 'Present frames' }).click()
  await expect(page.getByText('1 / 4')).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('2 / 4')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
})

test('malformed items from the network do not break the board', async ({ page }) => {
  const errors = watchErrors(page)
  await newBoard(page)
  await page.evaluate(() => {
    const wc = (window as any).__wc
    wc.applyRemote([
      { id: 'bad-1', type: 'connector', rev: 1 },
      { id: 'bad-2', type: 'draw', x: 0, y: 0, w: 10, h: 10, rev: 1 },
      { id: 'bad-3', type: 'table', x: 0, y: 0, w: 100, h: 100, rev: 1 },
      { id: 'bad-4', type: 'sticky', x: NaN, y: Infinity, w: -5, h: 0, rev: 1, html: '<img src=x onerror="window.__xss=1">' },
      { id: 'bad-5', type: 'mystery', x: 0, y: 0, w: 50, h: 50, rev: 1 },
      { id: 'ok-1', type: 'sticky', x: 0, y: 0, w: 200, h: 200, rev: 1, html: 'fine', fill: '#fff2a8' },
    ], [])
  })
  await page.waitForTimeout(400)
  await expect(page.getByRole('toolbar', { name: 'Tools' })).toBeVisible()
  await expect(page.locator('[data-id="ok-1"]')).toBeVisible()
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined()
  expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([])
})

test('large boards stay responsive when zoomed out', async ({ page }) => {
  await newBoard(page)
  const ms = await page.evaluate(async () => {
    const wc = (window as any).__wc
    const patch: Record<string, unknown> = {}
    for (let i = 0; i < 5000; i++) {
      const id = `it-${i}`
      patch[id] = { id, type: 'sticky', x: (i % 71) * 260, y: Math.floor(i / 71) * 260, w: 200, h: 200, rot: 0, z: i + 1, rev: 1, html: `Note ${i}`, fill: '#fff2a8', fontSize: 18 }
    }
    wc.mutate(patch); wc.commit()
    const t0 = performance.now()
    wc.fitAll(false)
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return performance.now() - t0
  })
  // 5,000 items on screen at once must draw in well under a second (it took 16 s before the overview renderer)
  expect(ms).toBeLessThan(1500)
  expect(await page.locator('.wc-item').count()).toBeLessThan(1300)
})
