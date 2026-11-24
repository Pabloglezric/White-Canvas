// Share-link rewriting for well-known embed providers. These hosts are also the ones allowed to load without a click.
/** Known providers whose share links need rewriting into an embeddable URL. */
export function providerEmbed(raw: string): { src: string; title: string; w?: number; h?: number } | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  const host = u.hostname.replace(/^www\./, '')
  const path = u.pathname
  let m: RegExpMatchArray | null
  if (host === 'youtu.be') return { src: `https://www.youtube-nocookie.com/embed/${path.slice(1)}`, title: 'YouTube', w: 560, h: 341 }
  if (host.endsWith('youtube.com')) {
    const id = u.searchParams.get('v') || (m = path.match(/^\/(?:shorts|embed|live)\/([\w-]+)/))?.[1]
    if (id) return { src: `https://www.youtube-nocookie.com/embed/${id}`, title: 'YouTube', w: 560, h: 341 }
  }
  if (host === 'vimeo.com' && (m = path.match(/^\/(\d+)/))) return { src: `https://player.vimeo.com/video/${m[1]}`, title: 'Vimeo', w: 560, h: 341 }
  if (host.endsWith('loom.com') && (m = path.match(/^\/share\/([\w-]+)/))) return { src: `https://www.loom.com/embed/${m[1]}`, title: 'Loom', w: 560, h: 341 }
  if (host.endsWith('figma.com') && /^\/(file|design|board|proto|slides)\//.test(path)) return { src: `https://www.figma.com/embed?embed_host=white-canvas&url=${encodeURIComponent(raw)}`, title: 'Figma', w: 720, h: 480 }
  if (host === 'docs.google.com' && (m = path.match(/^\/(document|spreadsheets|presentation)\/d\/([\w-]+)/))) {
    return { src: `https://docs.google.com/${m[1]}/d/${m[2]}/${m[1] === 'presentation' ? 'embed' : 'preview'}`, title: m[1] === 'document' ? 'Google Doc' : m[1] === 'spreadsheets' ? 'Google Sheet' : 'Google Slides', w: 720, h: 500 }
  }
  if (host === 'drive.google.com' && (m = path.match(/^\/file\/d\/([\w-]+)/))) return { src: `https://drive.google.com/file/d/${m[1]}/preview`, title: 'Google Drive', w: 640, h: 480 }
  if (host === 'open.spotify.com' && !path.startsWith('/embed')) return { src: `https://open.spotify.com/embed${path}`, title: 'Spotify', w: 420, h: 232 }
  if (host === 'codepen.io' && (m = path.match(/^\/([^/]+)\/pen\/([\w-]+)/))) return { src: `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`, title: 'CodePen', w: 640, h: 440 }
  if (host === 'sketchfab.com' && (m = path.match(/-([0-9a-f]{32})$/))) return { src: `https://sketchfab.com/models/${m[1]}/embed`, title: 'Sketchfab', w: 640, h: 480 }
  if (host === 'airtable.com' && /^\/(shr|app)/.test(path) && !path.startsWith('/embed')) return { src: `https://airtable.com/embed${path}`, title: 'Airtable', w: 720, h: 500 }
  if (host.endsWith('speckle.systems') || host.endsWith('speckle.xyz')) return { src: raw.includes('#embed') ? raw : `${raw}#embed=%7B%22isEnabled%22%3Atrue%7D`, title: 'Speckle', w: 720, h: 500 }
  if (host.endsWith('google.com') && path.startsWith('/maps/embed')) return { src: raw, title: 'Google Maps', w: 640, h: 440 }
  return null
}
