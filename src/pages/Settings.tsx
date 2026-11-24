import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy, KeyRound, LogOut, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/Auth'
import { purgeAccountData } from '../board/sync'
import { confirmDialog } from '../board/ui/dialogs'
import { FUNCTIONS_URL, supabase } from '../lib/supabase'
import { USER_COLORS, sha256Hex, timeAgo } from '../lib/util'

interface Token { id: string; name: string; prefix: string; can_write: boolean; created_at: string; last_used_at: string | null; expires_at: string | null }

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(30))
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return 'wc_' + [...bytes].map((b) => alphabet[b % alphabet.length]).join('')
}

export default function Settings() {
  const { me, loading, refreshProfile } = useAuth()
  const nav = useNavigate()
  const [name, setName] = useState(me.name)
  const [color, setColor] = useState(me.color)
  const [tokens, setTokens] = useState<Token[]>([])
  const [tokenName, setTokenName] = useState('Claude Code')
  const [readOnly, setReadOnly] = useState(false)
  const [days, setDays] = useState(90)
  const [fresh, setFresh] = useState('')
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => { setName(me.name); setColor(me.color) }, [me.name, me.color])
  const load = async () => {
    const { data } = await supabase.from('api_tokens').select('id,name,prefix,can_write,created_at,last_used_at,expires_at').order('created_at', { ascending: false })
    setTokens((data || []) as Token[])
  }
  useEffect(() => { if (me.signedIn) load() }, [me.signedIn])
  if (loading) return <div className="wc-page"><div className="wc-spin" /></div>
  if (!me.signedIn) return <Navigate to="/login?next=/settings" replace />

  const saveProfile = async () => {
    const { error } = await supabase.from('profiles').upsert({ id: me.id, display_name: name.trim() || 'Me', color })
    setMsg(error ? error.message : 'Profile saved')
    refreshProfile()
  }
  const createToken = async () => {
    const token = newToken()
    const { error } = await supabase.from('api_tokens').insert({ name: tokenName.trim() || 'Agent token', token_hash: await sha256Hex(token), prefix: token.slice(0, 9), can_write: !readOnly, expires_at: days ? new Date(Date.now() + days * 86400000).toISOString() : null })
    if (error) { setMsg(error.message); return }
    setFresh(token)
    load()
  }
  const mcpUrl = `${FUNCTIONS_URL}/mcp`
  const cmd = `claude mcp add --transport http white-canvas ${mcpUrl} --header "Authorization: Bearer ${fresh || 'wc_YOUR_TOKEN'}"`
  const copy = (t: string) => { navigator.clipboard?.writeText(t); setMsg('Copied') }

  return (
    <main className="wc-page" style={{ userSelect: 'text' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }} className="flex flex-col gap-5">
        <div className="wc-row"><Link to="/" className="wc-btn is-line"><ArrowLeft size={16} /> Boards</Link><h1 className="text-xl font-semibold ml-2">Settings</h1></div>
        {msg && <p role="status" style={{ color: 'var(--ink-2)' }}>{msg}</p>}

        <section className="wc-surface" style={{ padding: 18, boxShadow: 'none' }}>
          <h2 className="font-semibold mb-3">Profile</h2>
          <div className="wc-label mb-1">Display name</div>
          <input className="wc-input mb-3" aria-label="Display name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="wc-label mb-1.5">Cursor colour</div>
          <div className="wc-row flex-wrap mb-3">{USER_COLORS.map((c) => <button key={c} className={`wc-swatch ${color === c ? 'is-on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}</div>
          <div className="wc-row flex-wrap">
            <button className="wc-btn is-accent" onClick={saveProfile}>Save profile</button>
            <span className="text-sm" style={{ color: 'var(--ink-3)' }}>{me.email}</span>
            <div className="flex-1" />
            <button className="wc-btn is-line" onClick={async () => { const id = me.id; await supabase.auth.signOut(); await purgeAccountData(id); nav('/') }}><LogOut size={15} /> Sign out</button>
          </div>
          <div className="wc-row mt-3">
            <input className="wc-input" type="password" aria-label="New password" placeholder="New password (8+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <button className="wc-btn is-line" disabled={pw.length < 8} onClick={async () => {
              const { error } = await supabase.auth.updateUser({ password: pw })
              setPw('')
              if (error) { setMsg(error.message); return }
              // a changed password usually means "lock everything down": agent tokens are revoked too
              await supabase.from('api_tokens').delete().eq('user_id', me.id)
              load()
              setMsg('Password updated. Agent tokens were revoked — create new ones if you still need them.')
            }}>Update</button>
          </div>
        </section>

        <section className="wc-surface" style={{ padding: 18, boxShadow: 'none' }}>
          <h2 className="font-semibold mb-1 wc-row"><KeyRound size={17} /> Agent access (Claude Code and other MCP clients)</h2>
          <p className="mb-3 text-sm" style={{ color: 'var(--ink-2)' }}>
            A token lets a coding agent read and edit your boards through the White Canvas MCP server: list and create boards, add notes, shapes, connectors, diagrams, tables and comments, and update or remove items. Changes appear live on any open board.
          </p>
          <div className="wc-row flex-wrap mb-2">
            <input className="wc-input" aria-label="Token name" maxLength={80} style={{ flex: '1 1 180px', width: 'auto' }} value={tokenName} onChange={(e) => setTokenName(e.target.value)} placeholder="Token name" />
            <label className="wc-row text-sm"><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only</label>
            <select className="wc-input" aria-label="Token lifetime" style={{ width: 150 }} value={days} onChange={(e) => setDays(+e.target.value)}>
              <option value={30}>Expires in 30 days</option><option value={90}>Expires in 90 days</option><option value={365}>Expires in 1 year</option><option value={0}>Never expires</option>
            </select>
            <button className="wc-btn is-accent" onClick={createToken}>Create token</button>
          </div>
          {fresh && (
            <div className="mb-3" style={{ background: 'var(--surface-2)', borderRadius: 10, padding: 12 }}>
              <div className="text-sm font-medium mb-1">Copy this token now — it is not shown again.</div>
              <div className="wc-row"><code className="flex-1 break-all text-xs">{fresh}</code><button className="wc-btn is-line" onClick={() => copy(fresh)}><Copy size={14} /></button></div>
            </div>
          )}
          <div className="wc-label mb-1">Connect Claude Code</div>
          <div className="wc-row mb-3" style={{ alignItems: 'flex-start' }}>
            <pre className="flex-1 text-xs" style={{ background: '#1b1d23', color: '#e7e7e2', borderRadius: 10, padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>{cmd}</pre>
            <button className="wc-btn is-line" onClick={() => copy(cmd)}><Copy size={14} /></button>
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--ink-3)' }}>Server URL: <code>{mcpUrl}</code> · Streamable HTTP · header <code>Authorization: Bearer &lt;token&gt;</code>. The same URL accepts plain JSON-RPC POSTs from any script.</p>
          {tokens.map((t) => (
            <div key={t.id} className="wc-row py-1.5" style={{ borderTop: '1px solid var(--line)' }}>
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{t.name} {!t.can_write && <span className="wc-chip">read-only</span>}</div>
                <div className="text-xs" style={{ color: 'var(--ink-3)' }}>{t.prefix}… · created {timeAgo(t.created_at)} · {t.last_used_at ? `last used ${timeAgo(t.last_used_at)}` : 'never used'} · {t.expires_at ? (new Date(t.expires_at).getTime() < Date.now() ? 'expired' : `expires ${new Date(t.expires_at).toLocaleDateString()}`) : 'no expiry'}</div>
              </div>
              <button className="wc-btn is-danger" title="Revoke" onClick={async () => { if (await confirmDialog({ title: 'Revoke this token?', message: `Agents using "${t.name}" lose access immediately.`, confirmLabel: 'Revoke', danger: true })) { await supabase.from('api_tokens').delete().eq('id', t.id); load() } }}><Trash2 size={15} /></button>
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
