import { expect, test as base, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// An installed app only learns about a deploy through its service worker file, so that file has to change
// with every build, and an app that is already open has to move to the new build without being reinstalled.
// Each test gets its own copy of the site, so a pretend deploy cannot disturb the other tests.

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url))
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' }

interface Site { url: string; /** From now on the server hands out a worker stamped with another build. */ deploy: (page: Page, version: string) => Promise<void> }

const test = base.extend<{ site: Site }>({
  site: async ({}, use) => {
    let worker = await readFile(join(DIST, 'sw.js'), 'utf8')
    const server = createServer(async (req, res) => {
      const path = new URL(req.url || '/', 'http://x').pathname
      const file = extname(path) ? path : '/index.html'
      try {
        const body = file === '/sw.js' ? worker : await readFile(join(DIST, file))
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }).end(body)
      } catch { res.writeHead(404).end() }
    })
    await new Promise<void>((done) => server.listen(0, 'localhost', done))
    await use({
      url: `http://localhost:${(server.address() as AddressInfo).port}/`,
      deploy: async (page, version) => {
        const next = worker.replace(/"version":"[^"]+"/, `"version":"${version}"`)
        expect(next).not.toBe(worker)
        worker = next
        await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
      },
    })
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  },
})

const prompt = (page: Page) => page.getByText('A new version of White Canvas is ready.')

/** Opens the app and waits until its service worker is in charge of the page. */
async function open(page: Page, site: Site) {
  await page.goto(site.url)
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
}

async function sendToBackground(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

test('every build ships a service worker stamped with that build', async ({ page, site }) => {
  await page.goto(site.url)
  const build = await page.locator('meta[name="wc-build"]').getAttribute('content')
  expect(build).toBeTruthy()
  const worker = await (await page.request.get(site.url + 'sw.js')).text()
  expect(worker).toContain(`"version":"${build}"`)
  expect(worker).toMatch(/"files":\["\/assets\/[^"]+\.js"/)
  expect(worker).not.toContain('@wc-build')
})

test('an app that is up to date is not asked to reload', async ({ page, site }) => {
  await open(page, site)
  await page.waitForTimeout(1500)
  await expect(prompt(page)).toHaveCount(0)
})

test('a deploy reaches an app that is already open', async ({ page, site }) => {
  await open(page, site)
  await site.deploy(page, 'next-build')
  await expect(prompt(page)).toBeVisible()
  // the new worker has replaced the old one's files
  await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['wc-shell-next-build'])
})

test('a waiting update is applied by itself once the app is in the background', async ({ page, site }) => {
  await open(page, site)
  await page.evaluate(() => { (window as any).__before = true })
  await site.deploy(page, 'next-build')
  await expect(prompt(page)).toBeVisible()
  await sendToBackground(page)
  await page.waitForFunction(() => !(window as any).__before, null, { timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'New board' }).first()).toBeVisible()
})

test('an app in the background is left alone when there is no update', async ({ page, site }) => {
  await open(page, site)
  await page.evaluate(() => { (window as any).__before = true })
  await sendToBackground(page)
  await page.waitForTimeout(2500)
  expect(await page.evaluate(() => (window as any).__before)).toBe(true)
})
