import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against the production build, using device-only boards (no account needed).
// The "live" tests need a signed-in account and a second device, so they run against a second build that talks
// to a stand-in backend (tests/e2e/backend.ts) instead of a real one.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'off',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } }, testIgnore: /(touch|live)\.spec/ },
    { name: 'fold-cover', use: { browserName: 'chromium', viewport: { width: 411, height: 960 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, testMatch: /touch\.spec/ },
    { name: 'fold-main', use: { browserName: 'chromium', viewport: { width: 859, height: 954 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, testMatch: /touch\.spec/ },
    { name: 'live', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4174' }, testMatch: /live\.spec/ },
  ],
  webServer: [
    { command: 'npm run preview -- --port 4173 --strictPort', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI, timeout: 60_000 },
    {
      command: 'npx vite build --outDir dist-live --emptyOutDir && npx vite preview --outDir dist-live --port 4174 --strictPort',
      env: { VITE_SUPABASE_URL: 'http://localhost:54399', VITE_SUPABASE_KEY: 'test-key' },
      url: 'http://localhost:4174', reuseExistingServer: !process.env.CI, timeout: 120_000,
    },
  ],
})
