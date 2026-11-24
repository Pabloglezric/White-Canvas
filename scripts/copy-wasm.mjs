// Copies the web-ifc WebAssembly binaries into public/wasm so the IFC viewer can load them at runtime.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'wasm')
mkdirSync(out, { recursive: true })
for (const f of ['web-ifc.wasm', 'web-ifc-mt.wasm']) {
  const src = join(root, 'node_modules', 'web-ifc', f)
  if (existsSync(src)) copyFileSync(src, join(out, f))
}
