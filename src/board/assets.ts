// Asset storage. Cloud boards keep files in the private `board-assets` bucket (referenced as
// `asset:<path>`); device-only boards keep blobs in IndexedDB (`local:<id>`).
import { get, set } from 'idb-keyval'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uid } from '../lib/util'
import type { Item } from './types'

interface Signed { url: string; exp: number }
const SIGN_SECONDS = 60 * 60 * 24 * 7
const STORE_KEY = 'wc.assets.v1'
const cache = new Map<string, Signed>()
const inflight = new Map<string, Promise<string>>()
const objectUrls = new Set<string>()

// Signed links are remembered across sessions: the same link means the browser's HTTP cache can reuse
// the download instead of fetching every image again on each visit.
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') as Record<string, Signed>
  const now = Date.now()
  for (const k in saved) if (saved[k] && saved[k].exp > now) cache.set(k, saved[k])
} catch { /* storage unavailable */ }

let persistTimer: ReturnType<typeof setTimeout> | undefined
function persist() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const out: Record<string, Signed> = {}
    let n = 0
    for (const [k, v] of [...cache].reverse()) { if (k.startsWith('asset:') && n++ < 500) out[k] = v }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(out)) } catch { /* quota */ }
  }, 800)
}

export const isLocalBoard = (id: string | null | undefined) => !!id && id.startsWith('local-')

export async function resolveAsset(src: string): Promise<string> {
  if (!src) return ''
  if (!src.startsWith('asset:') && !src.startsWith('local:')) return src
  const hit = cache.get(src)
  if (hit && hit.exp > Date.now()) return hit.url
  const running = inflight.get(src)
  if (running) return running
  const p = (async () => {
    try {
      if (src.startsWith('local:')) {
        const blob = (await get(`wc.asset.${src.slice(6)}`)) as Blob | undefined
        const url = blob ? URL.createObjectURL(blob) : ''
        if (url) objectUrls.add(url)
        cache.set(src, { url, exp: Infinity })
        return url
      }
      const { data, error } = await supabase.storage.from('board-assets').createSignedUrl(src.slice(6), SIGN_SECONDS)
      if (error || !data) return ''
      if (cache.size > 2000) for (const k of cache.keys()) { cache.delete(k); if (cache.size <= 1500) break }
      cache.set(src, { url: data.signedUrl, exp: Date.now() + (SIGN_SECONDS - 3600) * 1000 })
      persist()
      return data.signedUrl
    } finally {
      inflight.delete(src)
    }
  })()
  inflight.set(src, p)
  return p
}

/** Frees device-local object URLs; called when a board closes. */
export function releaseAssets() {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls.clear()
  for (const [k] of cache) if (k.startsWith('local:')) cache.delete(k)
}

/** Forgets every remembered link (used on sign-out so the next person on this device starts clean). */
export function forgetAssets() {
  releaseAssets()
  cache.clear()
  try { localStorage.removeItem(STORE_KEY) } catch { /* ignore */ }
}

export function useAsset(src: string | undefined): string {
  const direct = src && !src.startsWith('asset:') && !src.startsWith('local:') ? src : ''
  const [url, setUrl] = useState(() => direct || (src ? cache.get(src)?.url || '' : ''))
  useEffect(() => {
    let live = true
    if (!src) { setUrl(''); return }
    resolveAsset(src).then((u) => { if (live) setUrl(u) })
    return () => { live = false }
  }, [src])
  return url
}

/** A short-lived link that downloads the file instead of opening it in the browser. */
export async function downloadUrl(src: string, name: string): Promise<string> {
  if (!src.startsWith('asset:')) return resolveAsset(src)
  const { data } = await supabase.storage.from('board-assets').createSignedUrl(src.slice(6), 300, { download: name || true })
  return data?.signedUrl || ''
}

export async function uploadAsset(boardId: string, file: Blob, name = 'file'): Promise<string> {
  const ext = (name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin'
  if (isLocalBoard(boardId)) {
    const id = uid()
    await set(`wc.asset.${id}`, file)
    return `local:${id}`
  }
  const path = `${boardId}/${uid()}.${ext}`
  const { error } = await supabase.storage.from('board-assets').upload(path, file, {
    contentType: (file as File).type || 'application/octet-stream', cacheControl: '31536000', upsert: false,
  })
  if (error) throw new Error(error.message)
  return `asset:${path}`
}

/**
 * Copies a cloud file into another cloud board's folder, on the server (nothing is downloaded). A file that is gone,
 * or that this account can no longer read, is left pointing where it was.
 */
export async function copyAsset(boardId: string, src: string): Promise<string> {
  const from = src.slice(6)
  const path = `${boardId}/${uid()}.${/\.([a-z0-9]{1,8})$/i.exec(from)?.[1].toLowerCase() || 'bin'}`
  const { error } = await supabase.storage.from('board-assets').copy(from, path)
  if (!error) return `asset:${path}`
  // the storage service answers "not found" both for a missing file and for one this account has no access to
  if (error.status === 404 || error.statusCode === '404' || error.statusCode === 'NoSuchKey') return src
  throw new Error(error.message)
}

/** The files an item points at: an image and its small preview, a model, an attachment. */
export const fileRefs = (it: Item): string[] => (it.type === 'image' ? [it.src, ...(it.thumb ? [it.thumb] : [])] : it.type === 'ifc' || it.type === 'file' ? [it.src] : [])

/**
 * Gives a cloud board its own copy of every file a list of items points at, and repoints the items at the copies:
 * device-only files are uploaded, files in another cloud board's folder are copied on the server. Each file moves once.
 */
export async function adoptAssets(boardId: string, items: Item[], moved: Map<string, string>): Promise<Item[]> {
  const foreign = [...new Set(items.flatMap(fileRefs))].filter((s) => s.startsWith('asset:') && !s.startsWith(`asset:${boardId}/`) && !moved.has(s))
  for (let i = 0; i < foreign.length; i += 6) {
    // a few at a time; a batch is always allowed to finish, so a caller that cleans up after a failure sees every copy made
    const batch = await Promise.allSettled(foreign.slice(i, i + 6).map(async (src) => { moved.set(src, await copyAsset(boardId, src)) }))
    const failed = batch.find((r) => r.status === 'rejected')
    if (failed) throw failed.reason
  }
  const adopt = async (src: string, name: string): Promise<string> => {
    if (!src.startsWith('local:')) return moved.get(src) ?? src
    if (!moved.has(src)) {
      const blob = (await get(`wc.asset.${src.slice(6)}`)) as Blob | undefined
      // a file that has already gone missing on this device is left as it was; everything else moves
      moved.set(src, blob ? await uploadAsset(boardId, blob, (blob as File).name || name) : src)
    }
    return moved.get(src)!
  }
  const out: Item[] = []
  for (const it of items) {
    if (it.type === 'image') out.push({ ...it, src: await adopt(it.src, 'image.png'), ...(it.thumb ? { thumb: await adopt(it.thumb, 'preview.webp') } : null) })
    else if (it.type === 'ifc' || it.type === 'file') out.push({ ...it, src: await adopt(it.src, it.name) })
    else out.push(it)
  }
  return out
}

/** A small preview of an image, used when it is tiny on screen. Returns null for small or undecodable images. */
export async function makeThumb(file: Blob, max = 512): Promise<{ blob: Blob; w: number; h: number } | null> {
  let bmp: ImageBitmap
  try { bmp = await createImageBitmap(file) } catch { return null }
  const w = bmp.width, h = bmp.height
  if (Math.max(w, h) <= max * 2) { bmp.close(); return { blob: file, w, h } }
  const k = max / Math.max(w, h)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/webp', 0.82))
  c.width = c.height = 0
  return blob ? { blob, w, h } : null
}

export async function fetchAssetBytes(src: string): Promise<ArrayBuffer> {
  if (src.startsWith('local:')) {
    const blob = (await get(`wc.asset.${src.slice(6)}`)) as Blob | undefined
    if (!blob) throw new Error('File is not available on this device')
    return blob.arrayBuffer()
  }
  const url = await resolveAsset(src)
  if (!url) throw new Error('You no longer have access to this file')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  return res.arrayBuffer()
}
