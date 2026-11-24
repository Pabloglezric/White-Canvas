/// <reference lib="webworker" />
// Parses an IFC file off the main thread and returns geometry merged by colour as transferable buffers.
// The model stays open here so element properties can be looked up later.
import * as WebIFC from 'web-ifc'

export interface MeshBucket { color: [number, number, number, number]; position: Float32Array; normal: Float32Array; index: Uint32Array; parts: Int32Array }
export interface PropInfo { type: string; name: string; globalId: string; sets: { name: string; props: [string, string][] }[] }
export type FromWorker =
  | { type: 'status'; text: string }
  | { type: 'model'; buckets: MeshBucket[]; elements: number; triangles: number }
  | { type: 'props'; req: number; info: PropInfo }
  | { type: 'error'; message: string }
export type ToWorker = { type: 'load'; bytes: ArrayBuffer } | { type: 'props'; req: number; id: number } | { type: 'dispose' }

const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer)
let api: WebIFC.IfcAPI | null = null
let modelID = -1

interface Acc { color: [number, number, number, number]; pos: Float32Array[]; nor: Float32Array[]; idx: Uint32Array[]; parts: number[]; verts: number; indices: number }

async function load(bytes: ArrayBuffer) {
  post({ type: 'status', text: 'Starting IFC engine…' })
  api = new WebIFC.IfcAPI()
  api.SetWasmPath('/wasm/', true)
  await api.Init()
  post({ type: 'status', text: 'Reading geometry…' })
  modelID = api.OpenModel(new Uint8Array(bytes), { COORDINATE_TO_ORIGIN: true })
  const buckets = new Map<string, Acc>()
  let elements = 0, triangles = 0
  api.StreamAllMeshes(modelID, (mesh) => {
    elements++
    const list = mesh.geometries
    for (let i = 0; i < list.size(); i++) {
      const pg = list.get(i)
      const geom = api!.GetGeometry(modelID, pg.geometryExpressID)
      const verts = api!.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize())
      const index = api!.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize())
      const c = pg.color
      const key = `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)},${c.w.toFixed(2)}`
      let b = buckets.get(key)
      if (!b) { b = { color: [c.x, c.y, c.z, c.w], pos: [], nor: [], idx: [], parts: [], verts: 0, indices: 0 }; buckets.set(key, b) }
      const m = pg.flatTransformation
      // normal matrix = cofactors of the upper 3×3 (inverse transpose up to scale; normals are renormalised)
      const n00 = m[5] * m[10] - m[6] * m[9], n01 = m[6] * m[8] - m[4] * m[10], n02 = m[4] * m[9] - m[5] * m[8]
      const n10 = m[2] * m[9] - m[1] * m[10], n11 = m[0] * m[10] - m[2] * m[8], n12 = m[1] * m[8] - m[0] * m[9]
      const n20 = m[1] * m[6] - m[2] * m[5], n21 = m[2] * m[4] - m[0] * m[6], n22 = m[0] * m[5] - m[1] * m[4]
      const count = verts.length / 6
      const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3)
      for (let k = 0, o = 0; k < verts.length; k += 6, o += 3) {
        const x = verts[k], y = verts[k + 1], z = verts[k + 2]
        pos[o] = m[0] * x + m[4] * y + m[8] * z + m[12]
        pos[o + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
        pos[o + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
        const a = verts[k + 3], bb = verts[k + 4], cc = verts[k + 5]
        let nx = n00 * a + n10 * bb + n20 * cc, ny = n01 * a + n11 * bb + n21 * cc, nz = n02 * a + n12 * bb + n22 * cc
        const len = Math.hypot(nx, ny, nz) || 1
        nx /= len; ny /= len; nz /= len
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz
      }
      const idx = new Uint32Array(index.length)
      for (let k = 0; k < index.length; k++) idx[k] = index[k] + b.verts
      b.parts.push(mesh.expressID, b.indices, index.length)
      b.pos.push(pos); b.nor.push(nor); b.idx.push(idx)
      b.verts += count; b.indices += index.length
      triangles += index.length / 3
      geom.delete()
    }
  })
  const out: MeshBucket[] = []
  const transfer: Transferable[] = []
  for (const b of buckets.values()) {
    if (!b.indices) continue
    const position = new Float32Array(b.verts * 3), normal = new Float32Array(b.verts * 3), index = new Uint32Array(b.indices)
    let vo = 0, io = 0
    for (let i = 0; i < b.pos.length; i++) { position.set(b.pos[i], vo); normal.set(b.nor[i], vo); vo += b.pos[i].length; index.set(b.idx[i], io); io += b.idx[i].length }
    b.pos.length = 0; b.nor.length = 0; b.idx.length = 0
    const parts = Int32Array.from(b.parts)
    out.push({ color: b.color, position, normal, index, parts })
    transfer.push(position.buffer, normal.buffer, index.buffer, parts.buffer)
  }
  if (!out.length) throw new Error('This IFC file contains no 3D geometry')
  post({ type: 'model', buckets: out, elements, triangles }, transfer)
}

const val = (x: unknown): string => {
  if (x == null) return ''
  if (typeof x === 'object' && 'value' in (x as object)) return String((x as { value: unknown }).value ?? '')
  return typeof x === 'object' ? '' : String(x)
}

async function props(id: number): Promise<PropInfo> {
  const info: PropInfo = { type: '', name: '', globalId: '', sets: [] }
  if (!api) return info
  try {
    const line = api.GetLine(modelID, id)
    info.type = api.GetNameFromTypeCode(line.type) || ''
    info.name = val(line.Name) || val(line.ObjectType)
    info.globalId = val(line.GlobalId)
    const sets = await api.properties.getPropertySets(modelID, id, true)
    for (const s of (sets || []).slice(0, 12)) {
      const list: [string, string][] = []
      for (const p of (s.HasProperties || s.Quantities || []).slice(0, 40)) {
        const value = val(p.NominalValue) || val(p.LengthValue) || val(p.AreaValue) || val(p.VolumeValue) || val(p.CountValue) || val(p.WeightValue)
        if (val(p.Name)) list.push([val(p.Name), value])
      }
      if (list.length) info.sets.push({ name: val(s.Name), props: list })
    }
  } catch { /* properties are optional */ }
  return info
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data
  try {
    if (msg.type === 'load') await load(msg.bytes)
    else if (msg.type === 'props') post({ type: 'props', req: msg.req, info: await props(msg.id) })
    else if (msg.type === 'dispose') { try { if (api && modelID >= 0) api.CloseModel(modelID) } catch { /* ignore */ } api = null; self.close() }
  } catch (err) {
    post({ type: 'error', message: (err as Error)?.message || 'Could not read this IFC file' })
  }
}
