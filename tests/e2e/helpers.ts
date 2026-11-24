import type { Page } from '@playwright/test'

export interface Snap { n: number; types: string[]; selection: string[]; editing: string | null; tool: string; camera: { x: number; y: number; z: number }; undo: number; items: Record<string, any> }

/** Opens a fresh device-only board with the debug handle enabled. */
export async function newBoard(page: Page) {
  await page.addInitScript(() => localStorage.setItem('wc.debug', '1'))
  await page.goto('/')
  await page.getByRole('button', { name: 'New board' }).first().click()
  await page.waitForURL(/\/board\/local-/)
  await page.waitForSelector('[data-canvas]')
  await page.waitForFunction(() => (window as any).__wc?.useBoard.getState().status === 'ready')
}

export function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const s = (window as any).__wc.useBoard.getState()
    return { n: Object.keys(s.items).length, types: Object.values(s.items).map((i: any) => i.type).sort(), selection: s.selection, editing: s.editingId, tool: s.tool, camera: s.camera, undo: s.undo.length, items: s.items }
  })
}

export const esc2 = async (page: Page) => { await page.keyboard.press('Escape'); await page.keyboard.press('Escape') }

export async function drag(page: Page, from: [number, number], to: [number, number], steps = 6) {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps })
  await page.mouse.up()
}

/** Collects uncaught page errors so tests can assert a clean console. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  return errors
}
