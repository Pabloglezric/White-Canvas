import { expect, test } from '@playwright/test'
import { newBoard, snap } from './helpers'

test('tap to create, drag, pan and pinch with fingers', async ({ page, context }) => {
  await newBoard(page)
  const vp = page.viewportSize()!
  const cx = vp.width / 2, cy = vp.height / 2
  const cdp = await context.newCDPSession(page)
  const touch = (type: string, pts: number[][]) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })) })
  const swipe = async (a: number[], z: number[]) => {
    await touch('touchStart', [a])
    for (let i = 1; i <= 8; i++) { await touch('touchMove', [[a[0] + ((z[0] - a[0]) * i) / 8, a[1] + ((z[1] - a[1]) * i) / 8]]); await page.waitForTimeout(10) }
    await touch('touchEnd', [])
  }

  await page.getByRole('button', { name: /Sticky note/ }).tap()
  await page.touchscreen.tap(cx, cy - 100)
  await page.waitForTimeout(250)
  await page.keyboard.type('Mobile note')
  await page.touchscreen.tap(cx, cy + 220)
  let s = await snap(page)
  expect(s.types).toEqual(['sticky'])
  expect(s.editing).toBeNull()

  const before = Object.values(s.items)[0] as any
  await swipe([cx, cy - 100], [cx - 60, cy + 40])
  s = await snap(page)
  const after = s.items[before.id]
  expect(after.x).toBeLessThan(before.x - 30)
  expect(after.y).toBeGreaterThan(before.y + 80)

  await page.touchscreen.tap(vp.width - 30, cy + 240)
  const cam0 = (await snap(page)).camera
  await swipe([vp.width - 40, cy + 200], [vp.width - 140, cy + 100])
  const cam1 = (await snap(page)).camera
  expect(cam1.x).toBeLessThan(cam0.x - 60)

  await touch('touchStart', [[cx - 50, cy + 150], [cx + 50, cy + 150]])
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[cx - 50 - i * 10, cy + 150], [cx + 50 + i * 10, cy + 150]]); await page.waitForTimeout(10) }
  await touch('touchEnd', [])
  expect((await snap(page)).camera.z).toBeGreaterThan(cam1.z * 1.8)

  // every primary tool is reachable without scrolling the toolbar
  for (const name of [/Select/, /Sticky note/, /Text/, /Shape/, /Connector/, 'Pen', /Frame/, /Comment/, 'Insert']) {
    await expect(page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name })).toBeInViewport()
  }
})
