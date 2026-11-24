// Link preview + "can this page be framed?" check for White Canvas embeds.
// Called with the signed-in user's JWT (verify_jwt is on). Only public http(s) hosts are fetched.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function isPrivateV4(ip: string): boolean {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return true
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && c === 0) || (a === 192 && b === 0 && c === 2) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224
}
function isPrivateV6(ip: string): boolean {
  const h = ip.toLowerCase()
  if (h === '::' || h === '::1') return true
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateV4(mapped[1])
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(h) || h.startsWith('64:ff9b:') || h.startsWith('2001:db8:')
}

/** True unless the host is a public name whose every address is public (blocks rebinding to internal IPs). */
async function isPrivateHost(host: string): Promise<boolean> {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.arpa')) return true
  if (h.includes(':')) return true // IPv6 literals are not needed for link previews
  if (/^[\d.]+$/.test(h) || /^0x/i.test(h)) return true // IP literals in any encoding
  if (!h.includes('.')) return true
  const [v4, v6] = await Promise.all([
    Deno.resolveDns(h, 'A').catch(() => [] as string[]),
    Deno.resolveDns(h, 'AAAA').catch(() => [] as string[]),
  ])
  if (!v4.length && !v6.length) return true
  return v4.some(isPrivateV4) || v6.some(isPrivateV6)
}

// Best-effort per-user rate limit (per function instance): 30 previews a minute.
const hits = new Map<string, number[]>()
function allow(key: string): boolean {
  const now = Date.now()
  const list = (hits.get(key) || []).filter((t) => now - t < 60_000)
  if (list.length >= 30) { hits.set(key, list); return false }
  list.push(now)
  hits.set(key, list)
  if (hits.size > 5000) hits.clear()
  return true
}

/** The gateway has already verified the JWT signature; require a signed-in user rather than the public key. */
function userId(req: Request): string | null {
  try {
    const part = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').split('.')[1]
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
    return claims.role === 'authenticated' && typeof claims.sub === 'string' ? claims.sub : null
  } catch { return null }
}

function meta(html: string, names: string[]): string | undefined {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*>`, 'i')
    const tag = html.match(re)?.[0]
    const c = tag?.match(/content=["']([^"']*)["']/i)?.[1]
    if (c) return c.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const uid = userId(req)
  if (!uid) return json({ error: 'Sign in required' }, 401)
  if (!allow(uid)) return json({ error: 'Too many requests' }, 429)
  let target: URL
  try { target = new URL(String((await req.json()).url)) } catch { return json({ error: 'Invalid url' }, 400) }
  if (!/^https?:$/.test(target.protocol) || target.username || target.password || (await isPrivateHost(target.hostname))) return json({ error: 'Unsupported address' }, 400)
  try {
    let url = target
    let res: Response | null = null
    // follow redirects by hand so every hop is checked against the private-address rule
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhiteCanvasLinkPreview/1.0)', Accept: 'text/html,application/xhtml+xml' } })
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url)
        if (!/^https?:$/.test(url.protocol) || (await isPrivateHost(url.hostname))) return json({ error: 'Unsupported address' }, 400)
        await res.body?.cancel()
        continue
      }
      break
    }
    if (!res) return json({ frameable: false })
    const xfo = (res.headers.get('x-frame-options') || '').toLowerCase()
    const csp = (res.headers.get('content-security-policy') || '').toLowerCase()
    const fa = csp.match(/frame-ancestors([^;]*)/)?.[1]?.trim()
    let frameable = res.ok && !xfo.includes('deny') && !xfo.includes('sameorigin')
    if (fa !== undefined && !/(^|\s)(\*|https:)(\s|$)/.test(fa)) frameable = false
    const type = res.headers.get('content-type') || ''
    let title: string | undefined, description: string | undefined, image: string | undefined, site: string | undefined
    if (type.includes('html')) {
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let html = ''
      while (html.length < 300_000) { const { done, value } = await reader.read(); if (done) break; html += dec.decode(value, { stream: true }) }
      reader.cancel().catch(() => {})
      title = meta(html, ['og:title', 'twitter:title']) || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim()
      description = meta(html, ['og:description', 'twitter:description', 'description'])
      image = meta(html, ['og:image', 'twitter:image'])
      site = meta(html, ['og:site_name'])
      if (image) { try { image = new URL(image, url).toString() } catch { image = undefined } }
      if (/<meta[^>]+http-equiv=["']x-frame-options["']/i.test(html)) frameable = false
    } else await res.body?.cancel()
    if (image && !/^https:\/\//.test(image)) image = undefined
    return json({ frameable, title: title?.slice(0, 200), description: description?.slice(0, 400), image, site: (site || url.hostname.replace(/^www\./, '')).slice(0, 80) })
  } catch {
    return json({ frameable: false, site: target.hostname.replace(/^www\./, '') })
  }
})
