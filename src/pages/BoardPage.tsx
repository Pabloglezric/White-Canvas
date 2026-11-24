import { useEffect } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/Auth'
import { isLocalBoard } from '../board/assets'
import { Canvas } from '../board/Canvas'
import { importFiles, importText } from '../board/importers'
import { bus } from '../board/interaction'
import { useBoard } from '../board/store'
import { closeBoard, openBoard } from '../board/sync'
import { CommentThread, ContextMenu, Presenter, Toast, TopBar, ZoomBar } from '../board/ui/Chrome'
import { ContextBar } from '../board/ui/ContextBar'
import { Panels } from '../board/ui/Panels'
import { Toolbar } from '../board/ui/Toolbar'

export default function BoardPage() {
  const { id = '' } = useParams()
  const { me, loading } = useAuth()
  const status = useBoard((s) => s.status)
  const theme = useBoard((s) => s.theme)
  const presenting = useBoard((s) => s.presenting != null)
  const local = isLocalBoard(id)
  const ready = !loading && (local || me.signedIn)

  useEffect(() => {
    if (!ready) return
    openBoard(id, { id: me.id, name: me.name, color: me.color })
    return () => closeBoard()
  }, [id, ready, me.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bus.importFiles = (files, at) => { importFiles(files, at) }
    bus.importText = (text, html, at) => { importText(text, html, at) }
    return () => { bus.importFiles = undefined; bus.importText = undefined }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1a1c21' : '#f6f5f1')
    return () => { delete document.documentElement.dataset.theme }
  }, [theme])

  if (loading) return <div className="wc-page" style={{ display: 'grid', placeItems: 'center' }}><div className="wc-spin" /></div>
  if (!local && !me.signedIn) return <Navigate to={`/login?next=${encodeURIComponent(`/board/${id}`)}`} replace />

  if (status === 'denied' || status === 'error') {
    return (
      <div className="wc-page" style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <div>
          <h1 className="text-xl font-semibold mb-2">{status === 'denied' ? 'This board is not available' : 'Could not load this board'}</h1>
          <p className="mb-4" style={{ color: 'var(--ink-2)' }}>{status === 'denied' ? 'It may have been deleted, or its owner has not shared it with you.' : 'Check your connection and try again.'}</p>
          <Link to="/" className="wc-btn is-accent">Back to boards</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="wc-app" data-theme={theme}>
      <Canvas />
      <div className="wc-deck" />
      {status !== 'ready' && <div className="wc-ui" style={{ inset: 0, display: 'grid', placeItems: 'center', background: 'var(--canvas)', zIndex: 80 }}><div className="wc-spin" /></div>}
      {!presenting && (
        <>
          <TopBar />
          <Toolbar />
          <ContextBar />
          <ZoomBar />
          <Panels />
        </>
      )}
      <CommentThread />
      <ContextMenu />
      <Presenter />
      <Toast />
    </div>
  )
}
