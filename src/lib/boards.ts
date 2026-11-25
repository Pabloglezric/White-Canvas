// Board list operations for both cloud (Supabase) and device-only boards.
import { get } from 'idb-keyval'
import { supabase } from './supabase'
import { uid } from './util'
import { uploadAsset } from '../board/assets'
import { deleteLocalBoard, listVersions, loadVersion, localBoards, localItems, saveLocalBoards, saveLocalItems } from '../board/sync'
import { cloneItems } from '../board/ops'
import { thumbnailSvg } from '../board/export'
import type { BoardMeta, Item } from '../board/types'

export interface BoardRow extends BoardMeta { starred?: boolean; last_opened_at?: string | null; local?: boolean; shared?: boolean }

export async function listCloudBoards(userId: string): Promise<BoardRow[]> {
  const [{ data: boards, error }, { data: state }] = await Promise.all([
    supabase.from('boards').select('id,title,owner_id,link_access,settings,thumbnail,trashed_at,created_at,updated_at').order('updated_at', { ascending: false }).limit(500),
    supabase.from('board_user_state').select('board_id,starred,last_opened_at').eq('user_id', userId),
  ])
  if (error) throw new Error(error.message)
  const st = new Map((state || []).map((s) => [s.board_id, s]))
  return ((boards || []) as BoardMeta[]).map((b) => ({ ...b, starred: st.get(b.id)?.starred || false, last_opened_at: st.get(b.id)?.last_opened_at, shared: b.owner_id !== userId }))
}

export async function listLocalBoards(): Promise<BoardRow[]> {
  return (await localBoards()).map((b) => ({ ...b, local: true })).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
}

export async function createBoard(title: string, cloud: boolean, items: Item[] = []): Promise<string> {
  const now = new Date().toISOString()
  if (!cloud) {
    const id = `local-${uid()}`
    const meta: BoardMeta = { id, title, owner_id: 'local-user', link_access: 'none', settings: {}, created_at: now, updated_at: now, thumbnail: items.length ? thumbnailSvg(Object.fromEntries(items.map((i) => [i.id, i]))) : null }
    await saveLocalBoards([meta, ...(await localBoards())])
    await saveLocalItems(id, items)
    return id
  }
  const { data, error } = await supabase.from('boards').insert({ title }).select('id').single()
  if (error) throw new Error(error.message)
  await insertItems(data.id, items)
  return data.id
}

async function insertItems(boardId: string, items: Item[]) {
  if (!items.length) return
  const rows = items.map((it) => ({ id: it.id, board_id: boardId, data: { ...it, rev: 1 }, rev: 1, deleted: false, client_id: 'import' }))
  for (let i = 0; i < rows.length; i += 200) {
    const res = await supabase.from('board_items').insert(rows.slice(i, i + 200))
    if (res.error) throw new Error(res.error.message)
  }
  await supabase.from('boards').update({ thumbnail: thumbnailSvg(Object.fromEntries(items.map((i) => [i.id, i]))) }).eq('id', boardId)
}

/** Uploads the device-only files a list of items points at into a cloud board, and repoints the items at the uploads. */
async function adoptAssets(boardId: string, items: Item[], moved: Map<string, string>): Promise<Item[]> {
  const adopt = async (src: string, name: string): Promise<string> => {
    if (!src.startsWith('local:')) return src
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

/**
 * Moves a device-only board into the signed-in account, with its files and saved versions, so it appears on every
 * device. The device copy is removed only once everything has arrived; if anything fails, nothing half-made is left
 * in the account and the device copy is untouched.
 */
export async function moveToAccount(b: BoardRow): Promise<string> {
  const source = await localItems(b.id)
  const { data, error } = await supabase.from('boards').insert({ title: b.title, settings: b.settings || {} }).select('id').single()
  if (error) throw new Error(error.message)
  const id = data.id as string
  try {
    const moved = new Map<string, string>()
    await insertItems(id, await adoptAssets(id, cloneItems(source, 0, 0).map((it, i) => ({ ...it, z: it.z || i + 1 })), moved))
    for (const v of (await listVersions(b.id)).reverse()) {
      const snapshot = await adoptAssets(id, await loadVersion(b.id, v.id), moved)
      const res = await supabase.from('board_versions').insert({ board_id: id, name: v.name.slice(0, 200), auto: v.auto, item_count: snapshot.length, snapshot, created_at: v.created_at })
      if (res.error) throw new Error(res.error.message)
    }
  } catch (e) {
    await deleteBoard({ id } as BoardRow).catch(() => {})
    throw e
  }
  await deleteLocalBoard(b.id)
  return id
}

async function boardItems(b: BoardRow): Promise<Item[]> {
  if (b.local) return localItems(b.id)
  const out: Item[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('board_items').select('data').eq('board_id', b.id).eq('deleted', false).order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []).map((r) => r.data as Item))
    if (!data || data.length < 1000) break
  }
  return out
}

export async function duplicateBoard(b: BoardRow, cloud: boolean): Promise<string> {
  const items = cloneItems(await boardItems(b), 0, 0).map((it, i) => ({ ...it, z: it.z || i + 1 }))
  return createBoard(`${b.title} (copy)`, cloud, items)
}

export async function renameBoard(b: BoardRow, title: string) {
  if (b.local) { await saveLocalBoards((await localBoards()).map((x) => (x.id === b.id ? { ...x, title } : x))); return }
  const { error } = await supabase.from('boards').update({ title }).eq('id', b.id)
  if (error) throw new Error(error.message)
}

export async function trashBoard(b: BoardRow, trashed: boolean) {
  if (b.local) { await saveLocalBoards((await localBoards()).map((x) => (x.id === b.id ? { ...x, trashed_at: trashed ? new Date().toISOString() : null } : x))); return }
  const { error } = await supabase.from('boards').update({ trashed_at: trashed ? new Date().toISOString() : null }).eq('id', b.id)
  if (error) throw new Error(error.message)
}

export async function deleteBoard(b: BoardRow) {
  if (b.local) { await deleteLocalBoard(b.id); return }
  // remove uploaded files first; storage is not cleaned up by the database cascade
  for (let i = 0; i < 500; i++) {
    const { data } = await supabase.storage.from('board-assets').list(b.id, { limit: 100 })
    if (!data?.length) break
    const { error: rmError } = await supabase.storage.from('board-assets').remove(data.map((f) => `${b.id}/${f.name}`))
    if (rmError) break
  }
  const { error } = await supabase.from('boards').delete().eq('id', b.id)
  if (error) throw new Error(error.message)
}

export async function leaveBoard(b: BoardRow, userId: string) {
  await supabase.from('board_members').delete().eq('board_id', b.id).eq('user_id', userId)
}

export async function starBoard(b: BoardRow, userId: string, starred: boolean) {
  await supabase.from('board_user_state').upsert({ board_id: b.id, user_id: userId, starred }, { onConflict: 'user_id,board_id' })
}
