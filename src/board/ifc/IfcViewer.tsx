// In-board IFC (BIM) viewer. A worker parses the file with web-ifc; this component renders the result
// with three.js. Everything here is lazy-loaded, so boards without models never pay for the 3D stack.
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Maximize, Scissors, ScanEye, X } from 'lucide-react'
import { fetchAssetBytes } from '../assets'
import { S, commit, update, useBoard } from '../store'
import type { IfcItem } from '../types'
import type { FromWorker, PropInfo, ToWorker } from './ifc.worker'

interface Part { mesh: THREE.Mesh; start: number; count: number }
interface Model {
  group: THREE.Group
  byElement: Map<number, Part[]>
  box: THREE.Box3
  props: (id: number) => Promise<PropInfo>
  dispose: () => void
}

// Parsed models are kept while the board is open so reopening a viewer is instant; least recently used go first.
const cache = new Map<string, Promise<Model>>()
const MAX_CACHED = 2

function evict(src: string) {
  const job = cache.get(src)
  cache.delete(src)
  job?.then((m) => m.dispose()).catch(() => {})
}

function loadModel(src: string, onStatus: (s: string) => void): Promise<Model> {
  return new Promise<Model>((resolve, reject) => {
    const worker = new Worker(new URL('./ifc.worker.ts', import.meta.url), { type: 'module' })
    const send = (m: ToWorker, transfer: Transferable[] = []) => worker.postMessage(m, transfer)
    const waiting = new Map<number, (info: PropInfo) => void>()
    let req = 0
    let settled = false
    const fail = (message: string) => { if (!settled) { settled = true; worker.terminate(); reject(new Error(message)) } }
    worker.onerror = (e) => fail(e.message || 'The 3D engine could not start')
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data
      if (msg.type === 'status') onStatus(msg.text)
      else if (msg.type === 'error') fail(msg.message)
      else if (msg.type === 'props') { waiting.get(msg.req)?.(msg.info); waiting.delete(msg.req) }
      else if (msg.type === 'model') {
        const group = new THREE.Group()
        const byElement = new Map<number, Part[]>()
        for (const b of msg.buckets) {
          const g = new THREE.BufferGeometry()
          g.setAttribute('position', new THREE.BufferAttribute(b.position, 3))
          g.setAttribute('normal', new THREE.BufferAttribute(b.normal, 3))
          g.setIndex(new THREE.BufferAttribute(b.index, 1))
          const alpha = b.color[3]
          const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(b.color[0], b.color[1], b.color[2]), transparent: alpha < 1, opacity: alpha, side: THREE.DoubleSide, depthWrite: alpha >= 1 })
          const mesh = new THREE.Mesh(g, mat)
          mesh.userData.baseOpacity = alpha
          mesh.userData.parts = b.parts // triples: element id, first index, index count (ascending by first index)
          group.add(mesh)
          for (let i = 0; i < b.parts.length; i += 3) {
            const id = b.parts[i]
            let list = byElement.get(id)
            if (!list) byElement.set(id, (list = []))
            list.push({ mesh, start: b.parts[i + 1], count: b.parts[i + 2] })
          }
        }
        const box = new THREE.Box3().setFromObject(group)
        settled = true
        resolve({
          group, byElement, box,
          props: (id) => new Promise<PropInfo>((res) => { const r = ++req; waiting.set(r, res); send({ type: 'props', req: r, id }) }),
          dispose: () => {
            group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose() } })
            send({ type: 'dispose' })
            setTimeout(() => worker.terminate(), 500)
          },
        })
      }
    }
    onStatus('Downloading model…')
    fetchAssetBytes(src).then((bytes) => send({ type: 'load', bytes }, [bytes])).catch((e: Error) => fail(e.message || 'Download failed'))
  })
}

/** Finds which element a triangle belongs to (parts are sorted by first index). */
function elementAt(parts: Int32Array, index: number): number | null {
  let lo = 0, hi = parts.length / 3 - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const start = parts[mid * 3 + 1], count = parts[mid * 3 + 2]
    if (index < start) hi = mid - 1
    else if (index >= start + count) lo = mid + 1
    else return parts[mid * 3]
  }
  return null
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
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    } catch {
      setError('3D is not available on this device or browser'); setStatus('')
      return
    }
    renderer.setClearColor(0xe9ecf1)
    renderer.localClippingEnabled = true
    const canvas = renderer.domElement
    el.prepend(canvas)
    Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' })
    const scene = new THREE.Scene()
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7c828e, 1.9))
    const sun = new THREE.DirectionalLight(0xffffff, 2.1)
    sun.position.set(1.2, 2, 0.8)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000)
    const controls = new OrbitControls(camera, canvas)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
    const highlight = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xff5a36, transparent: true, opacity: 0.7, depthTest: false, side: THREE.DoubleSide }))
    highlight.renderOrder = 10
    highlight.visible = false
    scene.add(highlight)
    let model: Model | null = null
    let dirty = true
    let raf = 0
    let cutting = false

    const size = () => {
      const w = el.clientWidth || item.w, h = el.clientHeight || item.h
      // match the on-screen pixel density of the zoomed board, within sane limits
      renderer.setPixelRatio(Math.min(2.5, Math.max(1, window.devicePixelRatio * Math.min(2, S().camera.z))))
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
      dirty = true
    }
    const ro = new ResizeObserver(size)
    ro.observe(el)
    let zoomTimer = 0
    const unsubZoom = useBoard.subscribe((s, p) => { if (s.camera.z !== p.camera.z) { clearTimeout(zoomTimer); zoomTimer = window.setTimeout(size, 220) } })
    size()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      if (controls.update() || dirty) { dirty = false; renderer.render(scene, camera) }
    }
    loop()
    controls.addEventListener('change', () => { dirty = true })

    // The browser may reclaim the GPU context (many tabs, low memory, backgrounding on phones).
    const onLost = (e: Event) => { e.preventDefault(); cancelAnimationFrame(raf); if (!dead) setStatus('3D view paused — restoring…') }
    const onRestored = () => { if (dead) return; setStatus(''); dirty = true; loop() }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

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
    const eachMaterial = (fn: (m: THREE.MeshLambertMaterial, base: number) => void) => model?.group.children.forEach((o) => fn((o as THREE.Mesh).material as THREE.MeshLambertMaterial, o.userData.baseOpacity as number))
    const applyXray = (on: boolean) => {
      eachMaterial((mat, base) => { mat.transparent = on || base < 1; mat.opacity = on ? Math.min(base, 0.22) : base; mat.depthWrite = !on && base >= 1; mat.needsUpdate = true })
      dirty = true
    }
    const applyCut = (t: number | null) => {
      if (!model) return
      cutting = t != null
      if (t != null) plane.constant = model.box.min.y + (model.box.max.y - model.box.min.y) * t
      eachMaterial((mat) => { mat.clippingPlanes = t == null ? null : [plane] })
      dirty = true
    }
    api.current = { fit, setXray: applyXray, setCut: applyCut }

    let job = cache.get(item.src)
    if (job) { cache.delete(item.src); cache.set(item.src, job) } // mark as most recently used
    else {
      job = loadModel(item.src, (s) => { if (!dead) setStatus(s) })
      cache.set(item.src, job)
      while (cache.size > MAX_CACHED) evict(cache.keys().next().value!)
    }
    job.then((mdl) => {
      if (dead) return
      model = mdl
      scene.add(mdl.group)
      applyXray(false) // cached models may carry state from an earlier viewer
      fit()
      if (item.cam?.length === 6) { camera.position.fromArray(item.cam, 0); controls.target.fromArray(item.cam, 3) }
      applyCut(item.section ?? null)
      setStatus('')
    }).catch((e: Error) => { cache.delete(item.src); if (!dead) { setError(e.message || 'Could not open this model'); setStatus('') } })

    // tap or click (without dragging) picks an element
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY } }
    const onUp = (e: PointerEvent) => {
      if (!down || !model || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
      const r = canvas.getBoundingClientRect()
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
      const hit = ray.intersectObjects(model.group.children, false).find((h) => !cutting || plane.distanceToPoint(h.point) >= 0)
      const id = hit && hit.faceIndex != null ? elementAt((hit.object as THREE.Mesh).userData.parts as Int32Array, hit.faceIndex * 3) : null
      highlight.geometry.dispose()
      if (id == null) { highlight.visible = false; setPicked(null); dirty = true; return }
      // Copy just this element's triangles; the highlight owns its buffers and never touches the model's.
      const parts = model.byElement.get(id) || []
      const total = parts.reduce((a, p) => a + p.count, 0)
      const out = new Float32Array(total * 3)
      let o = 0
      for (const p of parts) {
        const pos = p.mesh.geometry.getAttribute('position'), index = p.mesh.geometry.getIndex()!
        for (let k = p.start; k < p.start + p.count; k++) { const v = index.getX(k); out[o++] = pos.getX(v); out[o++] = pos.getY(v); out[o++] = pos.getZ(v) }
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(out, 3))
      highlight.geometry = g
      highlight.visible = true
      dirty = true
      model.props(id).then((info) => { if (!dead) setPicked(info) })
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)

    return () => {
      dead = true
      cancelAnimationFrame(raf)
      clearTimeout(zoomTimer)
      unsubZoom()
      ro.disconnect()
      // Leave a still image and the camera behind so the board shows the last view.
      try {
        if (model && !renderer.getContext().isContextLost()) {
          highlight.visible = false
          renderer.render(scene, camera) // read back in the same task, so no preserved buffer is needed
          const snap = document.createElement('canvas')
          const k = Math.min(1, 720 / canvas.width)
          snap.width = Math.max(1, Math.round(canvas.width * k)); snap.height = Math.max(1, Math.round(canvas.height * k))
          snap.getContext('2d')!.drawImage(canvas, 0, 0, snap.width, snap.height)
          const cam = [...camera.position.toArray(), ...controls.target.toArray()].map((n) => Math.round(n * 1000) / 1000)
          if (S().items[item.id] && (S().role === 'owner' || S().role === 'editor')) {
            update(item.id, { preview: snap.toDataURL('image/jpeg', 0.72), cam } as Partial<IfcItem>)
            commit({ history: false })
          }
        }
      } catch { /* snapshot is best effort */ }
      if (model) scene.remove(model.group)
      highlight.geometry.dispose()
      ;(highlight.material as THREE.Material).dispose()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      controls.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    }
  }, [item.id, item.src]) // eslint-disable-line react-hooks/exhaustive-deps

  const saveCut = (t: number | null) => { setCut(t); api.current?.setCut(t); update(item.id, { section: t } as Partial<IfcItem>) }

  return (
    <div ref={host} data-editing="true" className="relative w-full h-full" style={{ touchAction: 'none' }} onKeyDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {(status || error) && <div className="wc-placeholder absolute inset-0" style={{ background: 'rgba(233,236,241,.92)' }} role="status">{error ? <span style={{ color: '#b3261e' }}>{error}</span> : <><div className="wc-spin" /><span>{status}</span></>}</div>}
      <div className="absolute left-2 top-2 flex gap-1 wc-surface" style={{ padding: 3, borderRadius: 10 }}>
        <button className="wc-icon-btn" title="Fit model" aria-label="Fit model" onClick={() => api.current?.fit()}><Maximize size={15} /></button>
        <button className="wc-icon-btn" title="X-ray" aria-label="X-ray" aria-pressed={xray} style={xray ? { background: 'var(--ink)', color: 'var(--surface)' } : undefined} onClick={() => { setXray(!xray); api.current?.setXray(!xray) }}><ScanEye size={15} /></button>
        <button className="wc-icon-btn" title="Section cut" aria-label="Section cut" aria-pressed={cut != null} style={cut != null ? { background: 'var(--ink)', color: 'var(--surface)' } : undefined} onClick={() => saveCut(cut == null ? 0.5 : null)}><Scissors size={15} /></button>
        {cut != null && <input type="range" min={0} max={1} step={0.005} value={cut} onChange={(e) => saveCut(+e.target.value)} style={{ width: 110 }} aria-label="Section height" />}
        <button className="wc-icon-btn" title="Close viewer (Esc)" aria-label="Close viewer" onClick={() => { useBoard.setState({ editingId: null }); commit() }}><X size={15} /></button>
      </div>
      {picked && (
        <div className="absolute right-2 top-2 bottom-2 wc-surface overflow-y-auto text-xs" style={{ width: 'min(240px, 60%)', padding: 10, borderRadius: 10, userSelect: 'text' }}>
          <div className="wc-row"><b className="flex-1 truncate text-sm">{picked.name || picked.type || 'Element'}</b><button className="wc-icon-btn" aria-label="Close properties" onClick={() => setPicked(null)}><X size={13} /></button></div>
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
