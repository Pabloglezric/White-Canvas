import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Unique per build, even for a redeploy of the same commit: every deploy has to reach installed apps.
const version = `${(process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev'}-${Date.now().toString(36)}`

/**
 * Stamps the build into the page (a meta tag) and into the service worker, together with the app-shell files,
 * so a board opens offline right after the first visit and an installed app can tell when it is behind.
 */
function buildStamp(): Plugin {
  let files: string[] = []
  return {
    name: 'wc-build-stamp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'wc-build', content: version }, injectTo: 'head' }],
    generateBundle(_options, bundle) {
      const heavy = /(pdf|web-ifc|IfcViewer|ifc\.worker)/i // optional features are cached on first use instead
      files = Object.values(bundle)
        .filter((f) => /\.(js|css)$/.test(f.fileName) && !heavy.test(f.fileName))
        .map((f) => `/${f.fileName}`)
    },
    writeBundle(options) {
      const file = resolve(options.dir || 'dist', 'sw.js')
      const source = readFileSync(file, 'utf8')
      const marker = /^const BUILD = .* \/\/ @wc-build$/m
      // an unstamped worker is identical on every deploy, and installed apps would never update again
      if (!marker.test(source)) this.error('public/sw.js: the "@wc-build" line is missing, the build cannot be stamped')
      writeFileSync(file, source.replace(marker, () => `const BUILD = ${JSON.stringify({ version, files })}`))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), buildStamp()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['web-ifc'] },
  server: { host: true, port: 5173 },
  test: { environment: 'jsdom', include: ['tests/unit/**/*.test.ts'] },
} as Parameters<typeof defineConfig>[0])
