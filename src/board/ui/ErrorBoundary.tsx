import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode; fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode); name?: string }
interface State { error: Error | null }

/** Contains a rendering failure to one part of the UI instead of blanking the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[White Canvas] ${this.props.name || 'component'} failed to render`, error, info.componentStack)
  }
  reset = () => this.setState({ error: null })
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const { fallback } = this.props
    return typeof fallback === 'function' ? fallback(error, this.reset) : fallback ?? null
  }
}

export function CrashScreen({ error, reset, home }: { error: Error; reset?: () => void; home?: boolean }) {
  return (
    <main className="wc-page" style={{ display: 'grid', placeItems: 'center', textAlign: 'center' }}>
      <div style={{ maxWidth: 440 }}>
        <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
        <p className="mb-4" style={{ color: 'var(--ink-2)' }}>Your work is saved. Reloading usually fixes this; if it keeps happening, the detail below helps to track it down.</p>
        <pre className="text-xs mb-4" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', textAlign: 'left', maxHeight: 160, overflow: 'auto', userSelect: 'text' }}>{String(error?.message || error)}</pre>
        <div className="wc-row" style={{ justifyContent: 'center' }}>
          <button className="wc-btn is-accent" onClick={() => location.reload()}>Reload</button>
          {reset && <button className="wc-btn is-line" onClick={reset}>Try again</button>}
          {home && <a className="wc-btn is-line" href="/">All boards</a>}
        </div>
      </div>
    </main>
  )
}
