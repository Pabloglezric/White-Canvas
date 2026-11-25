import { expect, test } from '@playwright/test'
import { esc2, newBoard, snap, watchErrors } from './helpers'

test('layer, status, subject and a custom field: set from the selection bar, kept after a reload', async ({ page }) => {
  const errors = watchErrors(page)
  await newBoard(page)
  await page.keyboard.press('n'); await page.mouse.click(500, 360); await page.keyboard.type('Door D-104'); await esc2(page)
  await page.keyboard.press('n'); await page.mouse.click(800, 360); await page.keyboard.type('Unrelated note'); await esc2(page)
  await page.mouse.click(500, 360)

  await page.getByRole('button', { name: 'Details: layer, status and fields' }).click()
  const pop = page.locator('.wc-details')
  await pop.getByPlaceholder('New layer').fill('Structure')
  await pop.getByPlaceholder('New layer').press('Enter')
  await pop.getByRole('button', { name: 'Open', exact: true }).click()
  await pop.getByRole('textbox', { name: 'Subject' }).fill('Fire doors')
  await pop.getByPlaceholder('New field, e.g. Trade').fill('Trade')
  await pop.getByPlaceholder('New field, e.g. Trade').press('Enter')
  await pop.getByRole('textbox', { name: 'Trade', exact: true }).fill('Joinery')
  // closing the popover with a click elsewhere must not lose the last thing typed
  await page.mouse.click(640, 700)

  let s = await snap(page)
  const door = Object.values(s.items).find((i: any) => i.html === 'Door D-104') as any
  const other = Object.values(s.items).find((i: any) => i.html === 'Unrelated note') as any
  expect([door.status, door.subject, door.fields]).toEqual(['Open', 'Fire doors', { Trade: 'Joinery' }])
  expect(door.layer).toBeTruthy()
  expect([other.layer, other.status, other.subject, other.fields]).toEqual([undefined, undefined, undefined, undefined])
  await expect(page.locator(`[data-id="${door.id}"] .wc-status`)).toHaveText('Open')

  // hide the layer: its item leaves the canvas and cannot be selected; the other note stays
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Layers' })
  await expect(panel.locator('[data-layer="Structure"]')).toContainText('1')
  await panel.getByRole('button', { name: 'Hide Structure for me' }).click()
  await expect(page.locator(`[data-id="${door.id}"]`)).toHaveCount(0)
  await expect(page.locator(`[data-id="${other.id}"]`)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await page.locator('[data-canvas]').click({ position: { x: 640, y: 700 } })
  await page.keyboard.press('Control+a')
  expect((await snap(page)).selection).toEqual([other.id])

  // everything is still there after a reload, and the layer is still hidden on this device
  await page.waitForTimeout(900)
  await page.reload()
  await page.waitForFunction(() => (window as any).__wc?.useBoard.getState().status === 'ready')
  s = await snap(page)
  expect([s.items[door.id].status, s.items[door.id].subject, s.items[door.id].fields, s.items[door.id].layer]).toEqual(['Open', 'Fire doors', { Trade: 'Joinery' }, door.layer])
  await expect(page.locator(`[data-id="${other.id}"]`)).toHaveCount(1)
  await expect(page.locator(`[data-id="${door.id}"]`)).toHaveCount(0)
  await page.getByRole('button', { name: 'Menu' }).click()
  await page.getByRole('button', { name: 'Layers', exact: true }).click()
  await page.getByRole('dialog', { name: 'Layers' }).getByRole('button', { name: 'Show all layers' }).click()
  await expect(page.locator(`[data-id="${door.id}"] .wc-status`)).toHaveText('Open')
  expect(errors).toEqual([])
})
