// Two devices signed in to one account, on the same board, talking through a stand-in backend (see backend.ts).
// These cover what only shows with a second device: other people's cursors, and the board pictures on the dashboard.
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test'
import { BOARD, createBackend, stickyRow } from './backend'

type Backend = ReturnType<typeof createBackend>
interface Pair { backend: Backend; a: Page; b: Page; ctxA: BrowserContext; ctxB: BrowserContext }

const ready = (page: Page) => page.waitForFunction(() => (window as any).__wc?.useBoard.getState().status === 'ready')
const peers = (page: Page) => page.evaluate(() => Object.values((window as any).__wc.useBoard.getState().peers).map((p: any) => ({ user: p.user, cursor: p.cursor || null })))
/** The board position under a point on screen. */
const world = (page: Page, sx: number, sy: number) => page.evaluate(([x, y]) => { const c = (window as any).__wc.useBoard.getState().camera; return { x: (x - c.x) / c.z, y: (y - c.y) / c.z } }, [sx, sy])
const near = (got: { x: number; y: number } | null, want: { x: number; y: number }) => !!got && Math.abs(got.x - want.x) < 1 && Math.abs(got.y - want.y) < 1
/** What device B currently shows for device A's pointer. */
const seenOn = async (page: Page) => (await peers(page))[0]?.cursor ?? null

const test = base.extend<{ pair: Pair }>({
  pair: async ({ browser }, use) => {
    const backend = createBackend()
    backend.cloud.items = [1, 2, 3].map((n) => stickyRow(n, n * 260, 100, `Note ${n}`))
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
    const ctxB = await browser.newContext({ viewport: { width: 1000, height: 700 }, hasTouch: true, serviceWorkers: 'block' })
    await backend.attach(ctxA)
    await backend.attach(ctxB)
    const a = await ctxA.newPage(), b = await ctxB.newPage()
    for (const page of [a, b]) { await page.goto(`/board/${BOARD}`); await ready(page) }
    for (const page of [a, b]) await page.waitForFunction(() => Object.keys((window as any).__wc.useBoard.getState().peers).length === 1)
    await use({ backend, a, b, ctxA, ctxB })
    await ctxA.close().catch(() => {})
    await ctxB.close()
  },
})

test('a pointer is shown where it really is, and goes when it leaves the board', async ({ pair: { a, b } }) => {
  await a.mouse.move(600, 400, { steps: 5 })
  await expect.poll(async () => near(await seenOn(b), await world(a, 600, 400))).toBe(true)
  // one account on two devices: one person in the top bar, and the other device's pointer is labelled as yours
  await expect(b.locator('.wc-topbar button.wc-avatar')).toHaveCount(0)
  await expect(b.locator('.wc-cursor')).toHaveText('You (other device)')

  // the view moves under a pointer that stays still: the point it is over has changed
  await a.evaluate(() => { const s = (window as any).__wc.useBoard.getState(); s.setCamera({ x: s.camera.x - 300, y: s.camera.y - 120, z: s.camera.z * 1.5 }) })
  await expect.poll(async () => near(await seenOn(b), await world(a, 600, 400))).toBe(true)

  // onto the top bar: no longer over the board
  await a.mouse.move(100, 34, { steps: 6 })
  await expect.poll(() => seenOn(b)).toBeNull()
  await expect(b.locator('.wc-cursor')).toHaveCount(0)

  // back on the board, then the app goes to the background (another app, a locked phone)
  await a.mouse.move(500, 420, { steps: 3 })
  await expect.poll(async () => !!(await seenOn(b))).toBe(true)
  await a.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(() => seenOn(b)).toBeNull()
})

test('a finger on a touch screen is shown on the other device while it is down', async ({ pair: { a, b, ctxB } }) => {
  const touch = await ctxB.newCDPSession(b)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 500, y: 420, id: 1 }] })
  for (let i = 1; i <= 5; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 500 + i * 10, y: 420, id: 1 }] })
  await expect.poll(async () => near(await seenOn(a), await world(b, 550, 420))).toBe(true)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  // it lingers briefly after the finger lifts, then goes
  await expect.poll(() => seenOn(a), { timeout: 6000 }).toBeNull()
})

test('a cursor stays on its spot of the board while the viewer moves their own view', async ({ pair: { a, b } }) => {
  await a.mouse.move(600, 400, { steps: 3 })
  await expect(b.locator('.wc-cursor')).toHaveCount(1)
  await b.waitForTimeout(250) // let the glide to its first position finish
  const moved = await b.evaluate(async () => {
    const el = document.querySelector('.wc-cursor')!
    const before = el.getBoundingClientRect().x
    const s = (window as any).__wc.useBoard.getState()
    s.setCamera({ x: s.camera.x + 200, y: s.camera.y, z: s.camera.z })
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    return el.getBoundingClientRect().x - before
  })
  expect(Math.round(moved)).toBe(200) // with it, at once: no drifting after the board
})

test('a device that drops off takes its cursor with it', async ({ pair: { a, b, ctxA } }) => {
  await a.mouse.move(620, 410, { steps: 3 })
  await expect(b.locator('.wc-cursor')).toHaveCount(1)
  await ctxA.close() // no goodbye: the connection just ends
  await expect(b.locator('.wc-cursor')).toHaveCount(0, { timeout: 5000 })
  expect(await peers(b)).toEqual([])
})

test('the dashboard shows a real picture of each board, replacing old schematic previews', async ({ browser }) => {
  const backend = createBackend()
  backend.cloud.items = [1, 2, 3].map((n) => stickyRow(n, n * 260, 100, `Note ${n}`))
  backend.cloud.boards[0].thumbnail = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="4" height="4"/></svg>'
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
  await backend.attach(context)
  const page = await context.newPage()
  const picture = () => backend.cloud.boardPatches.map((p) => p.body.thumbnail).filter((t): t is string => typeof t === 'string').pop() || ''

  // from the dashboard alone: the board is not opened
  await page.goto('/')
  await expect.poll(picture).toMatch(/^data:image\/(webp|jpeg);base64,/)
  expect(picture().length).toBeLessThan(250_000)
  await expect(page.locator('.wc-board-thumb img')).toHaveAttribute('src', /^data:image\/(webp|jpeg);base64,/)

  // after an edit, leaving the board saves a fresh picture straight away
  const first = picture()
  await page.locator('.wc-board-card').click()
  await ready(page)
  await page.keyboard.press('n')
  await page.mouse.click(300, 600)
  await page.keyboard.type('A new note')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'All boards' }).click()
  await expect.poll(picture).not.toBe(first)
  expect(picture()).toMatch(/^data:image\/(webp|jpeg);base64,/)
  await context.close()
})
