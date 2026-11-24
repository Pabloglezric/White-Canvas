// Link preview + "can this page be framed?" check for White Canvas embeds.
// Called with the signed-in user's JWT (verify_jwt is on). Only public http(s) hosts are fetched.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h.includes(':')) return true // IPv6 literals are not needed for link previews
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return !h.includes('.')
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224
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
  let target: URL
  try { target = new URL(String((await req.json()).url)) } catch { return json({ error: 'Invalid url' }, 400) }
  if (!/^https?:$/.test(target.protocol) || isPrivateHost(target.hostname)) return json({ error: 'Unsupported address' }, 400)
  try {
    let url = target
    let res: Response | null = null
    // follow redirects by hand so every hop is checked against the private-address rule
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(7000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WhiteCanvasLinkPreview/1.0)', Accept: 'text/html,application/xhtml+xml' } })
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url)
        if (!/^https?:$/.test(url.protocol) || isPrivateHost(url.hostname)) return json({ error: 'Unsupported address' }, 400)
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
    return json({ frameable, title: title?.slice(0, 200), description: description?.slice(0, 400), image, site: site || url.hostname.replace(/^www\./, ''), final_url: url.toString() })
  } catch {
    return json({ frameable: false, site: target.hostname.replace(/^www\./, '') })
  }
})
