// In-board IFC (BIM) viewer: web-ifc parses the model, three.js renders it.
// Loaded lazily so the 3D stack never weighs on boards that do not use it.
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Maximize, Scissors, ScanEye, X } from 'lucide-react'
import { fetchAssetBytes } from '../assets'
import { S, commit, update, useBoard } from '../store'
import type { IfcItem } from '../types'

interface Chunk { id: number; mesh: THREE.Mesh; start: number; count: number }
interface Model { group: THREE.Group; chunks: Chunk[]; box: THREE.Box3; props: (id: number) => Promise<PropInfo> }
interface PropInfo { type: string; name: string; globalId: string; sets: { name: string; props: [string, string][] }[] }

const cache = new Map<string, Promise<Model>>()

async function loadModel(src: string, onStatus: (s: string) => void): Promise<Model> {
  onStatus('Downloading model…')
  const data = new Uint8Array(await fetchAssetBytes(src))
  onStatus('Starting IFC engine…')
  const WebIFC = await import('web-ifc')
  const api = new WebIFC.IfcAPI()
  api.SetWasmPath('/wasm/', true)
  await api.Init()
  onStatus('Reading geometry…')
  const modelID = api.OpenModel(data, { COORDINATE_TO_ORIGIN: true })

  // Merge geometry by colour so even large models stay at a handful of draw calls.
  const buckets = new Map<string, { color: THREE.Color; alpha: number; pos: number[]; nor: number[]; idx: number[]; parts: { id: number; start: number; count: number }[] }>()
  const m = new THREE.Matrix4(), n = new THREE.Matrix3(), v = new THREE.Vector3()
  api.StreamAllMeshes(modelID, (mesh) => {
    const list = mesh.geometries
    for (let i = 0; i < list.size(); i++) {
      const pg = list.get(i)
      const geom = api.GetGeometry(modelID, pg.geometryExpressID)
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize())
      const index = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize())
      const c = pg.color
      const key = `${c.x.toFixed(3)},${c.y.toFixed(3)},${c.z.toFixed(3)},${c.w.toFixed(2)}`
      let b = buckets.get(key)
      if (!b) { b = { color: new THREE.Color(c.x, c.y, c.z), alpha: c.w, pos: [], nor: [], idx: [], parts: [] }; buckets.set(key, b) }
      m.fromArray(pg.flatTransformation)
      n.getNormalMatrix(m)
      const base = b.pos.length / 3
      for (let k = 0; k < verts.length; k += 6) {
        v.set(verts[k], verts[k + 1], verts[k + 2]).applyMatrix4(m)
        b.pos.push(v.x, v.y, v.z)
        v.set(verts[k + 3], verts[k + 4], verts[k + 5]).applyMatrix3(n).normalize()
        b.nor.push(v.x, v.y, v.z)
      }
      b.parts.push({ id: mesh.expressID, start: b.idx.length, count: index.length })
      for (let k = 0; k < index.length; k++) b.idx.push(index[k] + base)
      geom.delete()
    }
  })

  const group = new THREE.Group()
  const chunks: Chunk[] = []
  for (const b of buckets.values()) {
    if (!b.idx.length) continue
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3))
    g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1))
    const mat = new THREE.MeshLambertMaterial({ color: b.color, transparent: b.alpha < 1, opacity: b.alpha, side: THREE.DoubleSide, depthWrite: b.alpha >= 1 })
    const mesh = new THREE.Mesh(g, mat)
    mesh.userData.baseOpacity = b.alpha
    group.add(mesh)
    for (const p of b.parts) chunks.push({ id: p.id, mesh, start: p.start, count: p.count })
  }
  const box = new THREE.Box3().setFromObject(group)
  if (box.isEmpty()) throw new Error('This IFC file contains no 3D geometry')

  const val = (x: unknown): string => {
    if (x == null) return ''
    if (typeof x === 'object' && 'value' in (x as object)) return String((x as { value: unknown }).value ?? '')
    return typeof x === 'object' ? '' : String(x)
  }
  const props = async (id: number): Promise<PropInfo> => {
    const info: PropInfo = { type: '', name: '', globalId: '', sets: [] }
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
  return { group, chunks, box, props }
}

export default function IfcViewer({ item }: { item: IfcItem }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState('Loading…')
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<PropInfo | null>(null)
  const [xray, setXray] = useState(false)
  const [cut, setCut] = useState<number | null>(item.section ?? null)
  const api = useRef<{ fit: () => void; setXray: (on: boolean) => void; setCut: (t: number | null) => void } | null>(null)

  useEffect(() => {
    const el = host.current!
    let dead = false
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setClearColor(0xeef0f3)
    renderer.localClippingEnabled = true
    el.prepend(renderer.domElement)
    Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' })
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 1.6)
    sun.position.set(1, 2, 1.5)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
    const highlight = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff5a36, transparent: true, opacity: 0.65, depthTest: false, side: THREE.DoubleSide }))
    highlight.renderOrder = 10
    highlight.visible = false
    scene.add(highlight)
    let model: Model | null = null
    let dirty = true
    let raf = 0

    const size = () => {
      const z = S().camera.z
      const w = el.clientWidth || item.w, h = el.clientHeight || item.h
      renderer.setPixelRatio(Math.min(2.5, Math.max(1, window.devicePixelRatio * Math.min(2, z))))
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      dirty = true
    }
    const ro = new ResizeObserver(size)
    ro.observe(el)
    size()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (controls.update() || dirty) { dirty = false; renderer.render(scene, camera) }
    }
    loop()
    controls.addEventListener('change', () => { dirty = true })

    const fit = () => {
      if (!model) return
      const c = model.box.getCenter(new THREE.Vector3()), s = model.box.getSize(new THREE.Vector3())
      const r = Math.max(s.x, s.y, s.z) || 10
      camera.near = r / 500; camera.far = r * 60
      camera.position.set(c.x + r * 0.9, c.y + r * 0.7, c.z + r * 0.9)
      controls.target.copy(c)
      camera.updateProjectionMatrix()
      dirty = true
    }

    api.current = {
      fit,
      setXray: (on) => {
        model?.group.children.forEach((o) => {
          const mat = (o as THREE.Mesh).material as THREE.MeshLambertMaterial
          const base = o.userData.baseOpacity as number
          mat.transparent = on || base < 1
          mat.opacity = on ? Math.min(base, 0.22) : base
          mat.depthWrite = !on && base >= 1
          mat.needsUpdate = true
        })
        dirty = true
      },
      setCut: (t) => {
        if (!model) return
        const mats = model.group.children.map((o) => (o as THREE.Mesh).material as THREE.Material)
        if (t == null) mats.forEach((mt) => { mt.clippingPlanes = null })
        else {
          plane.constant = model.box.min.y + (model.box.max.y - model.box.min.y) * t
          mats.forEach((mt) => { mt.clippingPlanes = [plane] })
        }
        dirty = true
      },
    }

    let job = cache.get(item.src)
    if (!job) { job = loadModel(item.src, (s) => { if (!dead) setStatus(s) }); cache.set(item.src, job); if (cache.size > 3) cache.delete(cache.keys().next().value!) }
    job.then((mdl) => {
      if (dead) return
      model = mdl
      scene.add(mdl.group)
      fit()
      if (item.cam?.length === 6) { camera.position.fromArray(item.cam, 0); controls.target.fromArray(item.cam, 3) }
      if (item.section != null) api.current?.setCut(item.section)
      setStatus('')
    }).catch((e: Error) => { cache.delete(item.src); if (!dead) { setError(e.message || 'Could not open this model'); setStatus('') } })

    // tap or click (without dragging) picks an element
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
    const onUp = (e: PointerEvent) => {
      if (!down || !model || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
      const r = renderer.domElement.getBoundingClientRect()
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
      const hit = ray.intersectObjects(model.group.children, false).find((h) => !plane || !(h.object as THREE.Mesh).material || !((h.object as THREE.Mesh).material as THREE.Material).clippingPlanes?.length || plane.distanceToPoint(h.point) >= 0)
      if (!hit || hit.faceIndex == null) { highlight.visible = false; setPicked(null); dirty = true; return }
      const at = hit.faceIndex * 3
      const chunk = model.chunks.find((c) => c.mesh === hit.object && at >= c.start && at < c.start + c.count)
      if (!chunk) return
      const src = chunk.mesh.geometry
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', src.getAttribute('position'))
      const parts = model.chunks.filter((c) => c.id === chunk.id && c.mesh === chunk.mesh)
      const index = src.getIndex()!
      const idx: number[] = []
      for (const p of parts) for (let k = p.start; k < p.start + p.count; k++) idx.push(index.getX(k))
      g.setIndex(idx)
      highlight.geometry.dispose()
      highlight.geometry = g
      highlight.visible = true
      dirty = true
      model.props(chunk.id).then((info) => { if (!dead) setPicked(info) })
    }
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      // Leave a still image and the camera behind so the board shows the last view.
      try {
        if (model) {
          highlight.visible = false
          renderer.render(scene, camera)
          const snap = document.createElement('canvas')
          const k = Math.min(1, 720 / renderer.domElement.width)
          snap.width = Math.round(renderer.domElement.width * k); snap.height = Math.round(renderer.domElement.height * k)
          snap.getContext('2d')!.drawImage(renderer.domElement, 0, 0, snap.width, snap.height)
          const cam = [...camera.position.toArray(), ...controls.target.toArray()].map((n) => Math.round(n * 1000) / 1000)
          if (S().items[item.id] && (S().role === 'owner' || S().role === 'editor')) {
            update(item.id, { preview: snap.toDataURL('image/jpeg', 0.72), cam } as Partial<IfcItem>)
            commit({ history: false })
          }
          scene.remove(model.group)
        }
      } catch { /* snapshot is best effort */ }
      controls.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    }
  }, [item.id, item.src]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveCut = (t: number | null) => { setCut(t); api.current?.setCut(t); update(item.id, { section: t } as Partial<IfcItem>) }

  return (
    <div ref={host} data-editing="true" className="relative w-full h-full" style={{ touchAction: 'none' }} onKeyDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {(status || error) && <div className="wc-placeholder absolute inset-0" style={{ background: 'rgba(238,240,243,.9)' }}>{error ? <span style={{ color: '#d93025' }}>{error}</span> : <><div className="wc-spin" /><span>{status}</span></>}</div>}
      <div className="absolute left-2 top-2 flex gap-1 wc-surface" style={{ padding: 3, borderRadius: 10 }}>
        <button className="wc-icon-btn" title="Fit model" onClick={() => api.current?.fit()}><Maximize size={15} /></button>
        <button className="wc-icon-btn" title="X-ray" style={xray ? { background: 'var(--ink)', color: 'var(--surface)' } : undefined} onClick={() => { setXray(!xray); api.current?.setXray(!xray) }}><ScanEye size={15} /></button>
        <button className="wc-icon-btn" title="Section cut" style={cut != null ? { background: 'var(--ink)', color: 'var(--surface)' } : undefined} onClick={() => saveCut(cut == null ? 0.5 : null)}><Scissors size={15} /></button>
        {cut != null && <input type="range" min={0} max={1} step={0.005} value={cut} onChange={(e) => saveCut(+e.target.value)} style={{ width: 110 }} aria-label="Section height" />}
        <button className="wc-icon-btn" title="Close viewer (Esc)" onClick={() => { useBoard.setState({ editingId: null }); commit() }}><X size={15} /></button>
      </div>
      {picked && (
        <div className="absolute right-2 top-2 bottom-2 wc-surface overflow-y-auto text-xs" style={{ width: 'min(240px, 60%)', padding: 10, borderRadius: 10, userSelect: 'text' }}>
          <div className="wc-row"><b className="flex-1 truncate text-sm">{picked.name || picked.type || 'Element'}</b><button className="wc-icon-btn" onClick={() => setPicked(null)}><X size={13} /></button></div>
          <div style={{ color: 'var(--ink-3)' }}>{picked.type}</div>
          {picked.globalId && <div className="truncate" style={{ color: 'var(--ink-3)' }}>{picked.globalId}</div>}
          {picked.sets.map((s) => (
            <div key={s.name} className="mt-2">
              <div className="wc-label">{s.name}</div>
              {s.props.map(([k, v2]) => <div key={k} className="flex gap-2 py-0.5" style={{ borderBottom: '1px solid var(--line)' }}><span className="flex-1 break-words">{k}</span><span className="text-right break-words" style={{ maxWidth: '55%' }}>{v2}</span></div>)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
