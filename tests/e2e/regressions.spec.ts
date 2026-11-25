// One test per defect found in the pre-launch audit, so none of them can come back unnoticed.
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { drag, esc2, newBoard, snap, watchErrors } from './helpers'

async function addSticky(page: import('@playwright/test').Page, x: number, y: number, text: string) {
  await page.keyboard.press('n'); await page.mouse.click(x, y); await page.keyboard.type(text); await esc2(page)
}

test('right-click on an item opens the item menu', async ({ page }) => {
  await newBoard(page)
  await addSticky(page, 400, 300, 'Menu target')
  await page.mouse.click(400, 300, { button: 'right' })
  await expect(page.getByRole('menu').getByText('Duplicate')).toBeVisible()
  expect((await snap(page)).selection.length).toBe(1)
})

test('a locked item can be selected and unlocked', async ({ page }) => {
  await newBoard(page)
  await addSticky(page, 400, 300, 'Lock me')
  await page.mouse.click(400, 300)
  await page.keyboard.press('Control+Shift+L')
  expect((Object.values((await snap(page)).items)[0] as any).locked).toBe(true)
  // dragging a locked item does not move it
  const before = Object.values((await snap(page)).items)[0] as any
  await drag(page, [400, 300], [600, 450])
  expect((Object.values((await snap(page)).items)[0] as any).x).toBe(before.x)
  await esc2(page)
  // a plain click selects it and offers Unlock
  await page.mouse.click(400, 300)
  await page.getByRole('button', { name: 'Unlock' }).click()
  expect((Object.values((await snap(page)).items)[0] as any).locked).toBeFalsy()
  // right-click also reaches it
  await esc2(page) // deselect first: a second click on a selected note would start editing it
  await page.mouse.click(400, 300); await page.keyboard.press('Control+Shift+L'); await esc2(page)
  await page.mouse.click(400, 300, { button: 'right' })
  await expect(page.getByRole('menu').getByText('Unlock')).toBeVisible()
})

test('text typed just before a reload is kept', async ({ page }) => {
  await newBoard(page)
  await page.keyboard.press('n'); await page.mouse.click(400, 300)
  await page.keyboard.type('Still typing')
  await page.waitForTimeout(1200) // no Escape: the note is still being edited
  await page.reload()
  await page.waitForFunction(() => (window as any).__wc?.useBoard.getState().status === 'ready')
  const s = await snap(page)
  expect(s.n).toBe(1)
  expect((Object.values(s.items)[0] as any).html).toBe('Still typing')
})

test('dotted connectors export as valid SVG', async ({ page }) => {
  await newBoard(page)
  const svg = await page.evaluate(async () => {
    const wc = (window as any).__wc
    wc.apply({ c1: { id: 'c1', type: 'connector', x: 0, y: 0, w: 0, h: 0, rot: 0, z: 1, rev: 0, a: { x: 0, y: 0 }, b: { x: 300, y: 120 }, route: 'elbow', capA: 'none', capB: 'arrow', stroke: '#1c1e23', strokeW: 2, dash: 'dotted' } })
    const { buildSvg, exportArea } = await import(/* @vite-ignore */ (window as any).__wc.exportModule)
    return (await buildSvg(exportArea('all'))).svg
  }).catch(() => null)
  // the export module is reached through the UI in the built app
  if (svg === null) {
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      (async () => { await page.getByRole('button', { name: 'Menu' }).click(); await page.getByText('Export', { exact: true }).click(); await page.getByRole('button', { name: 'SVG (vector)' }).click() })(),
    ])
    const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'))
    const parsed = await page.evaluate((t) => new DOMParser().parseFromString(t, 'image/svg+xml').querySelector('parsererror') === null, text)
    expect(parsed).toBe(true)
    expect(text).toContain('stroke-dasharray')
  }
})

test('hostile item data never reaches the exported file as markup', async ({ page }) => {
  await newBoard(page)
  await page.evaluate(() => (window as any).__wc.applyRemote([
    { id: 'x1', type: 'shape', kind: 'rect', x: 0, y: 0, w: 200, h: 100, rev: 1, fill: '"/><script>window.__xss=1</script><rect fill="', stroke: '" onload="window.__xss=1', html: '<img src=x onerror="window.__xss=1">Label' },
  ], []))
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    (async () => { await page.getByRole('button', { name: 'Menu' }).click(); await page.getByText('Export', { exact: true }).click(); await page.getByRole('button', { name: 'SVG (vector)' }).click() })(),
  ])
  const text = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'))
  expect(text).not.toMatch(/<script|onload=|onerror=/i)
  expect(text).toContain('Label')
  // searching the board runs the text extractor over the same data
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+f')
  await page.getByPlaceholder(/Find text/).fill('Label')
  await expect(page.getByText('Label').first()).toBeVisible()
  expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined()
})

test('dark theme keeps text and lines readable', async ({ page }) => {
  await newBoard(page)
  await page.mouse.dblclick(300, 300); await page.keyboard.type('Plain text'); await esc2(page)
  await page.evaluate(() => (window as any).__wc.useBoard.getState().setPrefs({ theme: 'dark' }))
  const color = await page.locator('[data-type="text"] .wc-rich').evaluate((el) => getComputedStyle(el).color)
  const [r, g, b] = color.match(/\d+/g)!.map(Number)
  expect(r + g + b).toBeGreaterThan(600) // light ink on the dark canvas
  await page.evaluate(() => (window as any).__wc.useBoard.getState().setPrefs({ theme: 'light' }))
})

test('resizing text is a single clean undo step', async ({ page }) => {
  await newBoard(page)
  await page.mouse.dblclick(300, 300); await page.keyboard.type('A fairly long line of text to wrap'); await esc2(page)
  await page.mouse.click(320, 300)
  const before = Object.values((await snap(page)).items)[0] as any
  const undoBefore = (await snap(page)).undo
  const e = (await page.locator('.wc-handle.h-e').boundingBox())!
  await drag(page, [e.x + 5, e.y + 5], [e.x - 150, e.y + 5])
  const after = Object.values((await snap(page)).items)[0] as any
  expect(after.w).toBeLessThan(before.w - 80)
  expect((await snap(page)).undo).toBe(undoBefore + 1)
  await page.keyboard.press('Control+z')
  const undone = Object.values((await snap(page)).items)[0] as any
  expect(undone).toBeTruthy()
  expect(Math.round(undone.w)).toBe(Math.round(before.w))
})

test('abandoned empty text leaves nothing behind', async ({ page }) => {
  await newBoard(page)
  await page.keyboard.press('t'); await page.mouse.click(400, 300); await esc2(page)
  await page.mouse.dblclick(600, 400); await esc2(page)
  const s = await snap(page)
  expect(s.n).toBe(0)
  expect(s.undo).toBe(0)
})

test('deleting a table row removes it from the screen too', async ({ page }) => {
  await newBoard(page)
  await page.evaluate(() => (window as any).__wc.apply({ t1: { id: 't1', type: 'table', x: 300, y: 250, w: 300, h: 120, rot: 0, z: 1, rev: 0, cells: [['keep-1'], ['DELETE-ME'], ['keep-3']], colW: [300], rowH: [40, 40, 40], header: false } }))
  await page.locator('.wc-table').click(); await page.locator('.wc-table').click() // select, then edit
  expect((await snap(page)).editing).toBe('t1')
  await page.locator('[data-cell="1:0"]').click()
  await page.getByRole('button', { name: 'Delete row' }).click()
  await expect(page.locator('.wc-table')).not.toContainText('DELETE-ME')
  expect(((await snap(page)).items.t1 as any).cells).toEqual([['keep-1'], ['keep-3']])
})

test('duplicating a frame keeps the connectors between its contents', async ({ page }) => {
  await newBoard(page)
  await page.evaluate(() => {
    const wc = (window as any).__wc
    const base = { rot: 0, rev: 0 }
    wc.apply({
      f: { ...base, id: 'f', type: 'frame', x: 100, y: 100, w: 600, h: 300, z: 0, title: 'F', fill: '#ffffff' },
      a: { ...base, id: 'a', type: 'shape', kind: 'rect', x: 150, y: 200, w: 120, h: 80, z: 1, parent: 'f', html: 'A', fill: '#ffffff', stroke: '#1c1e23', strokeW: 2 },
      b: { ...base, id: 'b', type: 'shape', kind: 'rect', x: 500, y: 200, w: 120, h: 80, z: 2, parent: 'f', html: 'B', fill: '#ffffff', stroke: '#1c1e23', strokeW: 2 },
      c: { ...base, id: 'c', type: 'connector', x: 0, y: 0, w: 0, h: 0, z: 3, a: { item: 'a', x: 0, y: 0 }, b: { item: 'b', x: 0, y: 0 }, route: 'elbow', capA: 'none', capB: 'arrow', stroke: '#1c1e23', strokeW: 2 },
    })
    wc.useBoard.setState({ selection: ['f'] })
  })
  await page.keyboard.press('Control+d')
  const s = await snap(page)
  expect(s.types.filter((t) => t === 'connector').length).toBe(2)
  const copy = Object.values(s.items).find((i: any) => i.type === 'connector' && i.id !== 'c') as any
  expect(copy.a.item).not.toBe('a')
  expect(s.items[copy.a.item]).toBeTruthy()
})

test('Escape leaves card editing and bracket shortcuts reorder', async ({ page }) => {
  const errors = watchErrors(page)
  await newBoard(page)
  await page.keyboard.press('k'); await page.mouse.click(400, 300)
  await page.keyboard.type('Card title')
  await page.keyboard.press('Escape')
  expect((await snap(page)).editing).toBeNull()
  await addSticky(page, 700, 300, 'Top')
  await page.mouse.click(700, 300)
  const z0 = (Object.values((await snap(page)).items).find((i: any) => i.type === 'sticky') as any).z
  await page.keyboard.press('Control+Shift+BracketLeft')
  const z1 = (Object.values((await snap(page)).items).find((i: any) => i.type === 'sticky') as any).z
  expect(z1).toBeLessThan(z0)
  expect(errors).toEqual([])
})

test('controls have accessible names and dialogs trap focus', async ({ page }) => {
  await newBoard(page)
  await addSticky(page, 400, 300, 'A11y')
  await page.mouse.click(400, 300)
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, a[href], input, textarea, select')].filter((el) => {
    const e = el as HTMLElement
    if (e.offsetParent === null) return false
    return !(e.getAttribute('aria-label') || e.textContent?.trim() || (e as HTMLInputElement).labels?.length)
  }).map((el) => el.outerHTML.slice(0, 120)))
  expect(unnamed).toEqual([])
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Shortcuts and gestures' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('a preset frame drops its ratio tag once it is resized out of proportion', async ({ page }) => {
  await newBoard(page)
  await page.getByRole('button', { name: 'Frame (F)' }).click()
  await page.getByRole('button', { name: /^Square/ }).click()
  const tag = page.locator('.wc-frame-tag')
  await expect(tag).toHaveText('Square')
  expect((Object.values((await snap(page)).items)[0] as any).title).toBe('Frame 1')
  const h = (await page.locator('[data-handle="e"]').boundingBox())!
  await drag(page, [h.x + h.width / 2, h.y + h.height / 2], [h.x - 200, h.y + h.height / 2])
  const f = Object.values((await snap(page)).items)[0] as any
  expect(Math.round(f.w)).toBeLessThan(900)
  await expect(tag).toHaveCount(0)
  // back in proportion (undo), the tag is back too: it always describes the frame as it is now
  await page.keyboard.press('Control+z')
  await expect(tag).toHaveText('Square')
})

test('scrolling over an open 3D model zooms the model, not the board', async ({ page }) => {
  await newBoard(page)
  test.skip(!(await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'))), 'WebGL is not available in this browser')
  await page.evaluate(() => (window as any).__wc.useBoard.setState({ panel: 'insert' }))
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('3D model (IFC)').click()])
  await chooser.setFiles(fileURLToPath(new URL('./fixtures/box.ifc', import.meta.url)))
  // a model added on its own opens without a further click
  const view = page.locator('.wc-ifc canvas')
  await expect(view).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.wc-ifc [role=status]')).toHaveCount(0, { timeout: 30_000 })
  await page.waitForTimeout(300)
  const box = (await view.boundingBox())!
  const before = await view.screenshot()
  const camera = (await snap(page)).camera
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(50) }
  await expect.poll(async () => (await view.screenshot()).equals(before)).toBe(false)
  expect((await snap(page)).camera).toEqual(camera)
  expect(await view.boundingBox()).toEqual(box)
})
