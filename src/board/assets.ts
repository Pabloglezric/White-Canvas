// Asset storage. Cloud boards keep files in the private `board-assets` bucket (referenced as
// `asset:<path>`); local boards keep blobs in IndexedDB (`local:<id>`).
import { get, set } from 'idb-keyval'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { uid } from '../lib/util'

const cache = new Map<string, { url: string; exp: number }>()
const inflight = new Map<string, Promise<string>>()
const SIGN_SECONDS = 60 * 60 * 6

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
        cache.set(src, { url, exp: Infinity })
        return url
      }
      const { data, error } = await supabase.storage.from('board-assets').createSignedUrl(src.slice(6), SIGN_SECONDS)
      if (error || !data) return ''
      cache.set(src, { url: data.signedUrl, exp: Date.now() + (SIGN_SECONDS - 600) * 1000 })
      return data.signedUrl
    } finally {
      inflight.delete(src)
    }
  })()
  inflight.set(src, p)
  return p
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

export async function fetchAssetBytes(src: string): Promise<ArrayBuffer> {
  if (src.startsWith('local:')) {
    const blob = (await get(`wc.asset.${src.slice(6)}`)) as Blob | undefined
    if (!blob) throw new Error('File is not available on this device')
    return blob.arrayBuffer()
  }
  const url = await resolveAsset(src)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  return res.arrayBuffer()
}
