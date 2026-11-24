import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const version = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || `dev-${Date.now().toString(36)}`

/** Lists the app-shell files for the service worker, so a board opens offline right after the first visit. */
function precacheManifest(): Plugin {
  return {
    name: 'wc-precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const heavy = /(pdf|web-ifc|IfcViewer|ifc\.worker)/i // optional features are cached on first use instead
      const files = Object.values(bundle)
        .filter((f) => /\.(js|css)$/.test(f.fileName) && !heavy.test(f.fileName))
        .map((f) => `/${f.fileName}`)
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ version, files }) })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), precacheManifest()],
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
