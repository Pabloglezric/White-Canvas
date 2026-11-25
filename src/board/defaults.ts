import { textToHtml, uid } from '../lib/util'
import type {
  CardItem, ChartItem, CodeItem, CommentItem, ConnEnd, ConnectorItem, EmbedItem, FileItem, FrameItem,
  IfcItem, ImageItem, Item, ShapeItem, ShapeKind, StickyItem, TableItem, TextItem,
} from './types'

export const STICKY_COLORS = [
  '#fff2a8', '#ffd98a', '#ffb7a0', '#ffb3d1', '#e3c4ff', '#b9c8ff',
  '#a8dcff', '#a6ecd9', '#c4eea6', '#e6e4dc', '#ffffff', '#2b2d33',
]
export const FILL_COLORS = [
  'transparent', '#ffffff', '#f1f0ec', '#fff2a8', '#ffd98a', '#ffb7a0', '#ffb3d1', '#e3c4ff',
  '#b9c8ff', '#a8dcff', '#a6ecd9', '#c4eea6', '#e5484d', '#f76b15', '#30a46c', '#0090ff', '#6e56cf', '#1c1e23',
]
export const INK_COLORS = ['#1c1e23', '#6b6f7a', '#e5484d', '#f76b15', '#d9a400', '#30a46c', '#0090ff', '#6e56cf', '#d6409f', '#ffffff']
export const HL_COLORS = ['#ffe14d', '#7df0a8', '#7cd6ff', '#ff9ecb', '#ffb066']

export const SHAPE_KINDS: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' }, { kind: 'round', label: 'Rounded' }, { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'diamond', label: 'Decision' }, { kind: 'triangle', label: 'Triangle' }, { kind: 'pill', label: 'Terminator' },
  { kind: 'parallelogram', label: 'Data' }, { kind: 'trapezoid', label: 'Manual' }, { kind: 'hexagon', label: 'Preparation' },
  { kind: 'cylinder', label: 'Database' }, { kind: 'document', label: 'Document' }, { kind: 'predefined', label: 'Subprocess' },
  { kind: 'pentagon', label: 'Pentagon' }, { kind: 'octagon', label: 'Octagon' }, { kind: 'star', label: 'Star' },
  { kind: 'cross', label: 'Cross' }, { kind: 'arrowRight', label: 'Arrow right' }, { kind: 'arrowLeft', label: 'Arrow left' },
  { kind: 'callout', label: 'Callout' }, { kind: 'cloud', label: 'Cloud' },
]

export const FRAME_PRESETS: { label: string; w: number; h: number }[] = [
  { label: 'Custom', w: 0, h: 0 },
  { label: '16:9', w: 1600, h: 900 },
  { label: '4:3', w: 1200, h: 900 },
  { label: 'A4 portrait', w: 794, h: 1123 },
  { label: 'A3 landscape', w: 1587, h: 1123 },
  { label: 'A1 landscape', w: 3179, h: 2245 },
  { label: 'Phone', w: 390, h: 844 },
  { label: 'Square', w: 1000, h: 1000 },
]

/** The preset a frame still has the proportions of; undefined once it has been resized out of them. */
export function framePreset(f: { preset?: string; w: number; h: number }): string | undefined {
  const p = f.preset ? FRAME_PRESETS.find((x) => x.w && x.label === f.preset) : undefined
  if (!p || !(f.w > 0) || !(f.h > 0)) return undefined
  return Math.abs((f.w / f.h) / (p.w / p.h) - 1) < 0.005 ? p.label : undefined
}

type Init<T> = Partial<T> & { x: number; y: number }
const base = (type: Item['type'], x: number, y: number, w: number, h: number) =>
  ({ id: uid(), type, x, y, w, h, rot: 0, z: 0, rev: 0 }) as const

export const make = {
  sticky: (p: Init<StickyItem>): StickyItem => ({
    ...base('sticky', p.x, p.y, 200, 200), type: 'sticky', html: '', fill: STICKY_COLORS[0], fontSize: 18, align: 'center', valign: 'middle', ...p,
  }),
  text: (p: Init<TextItem>): TextItem => ({
    ...base('text', p.x, p.y, 240, 32), type: 'text', html: '', fontSize: 20, align: 'left', ...p,
  }),
  shape: (p: Init<ShapeItem>): ShapeItem => ({
    ...base('shape', p.x, p.y, 160, 100), type: 'shape', kind: 'rect', html: '', fill: '#ffffff', stroke: '#1c1e23', strokeW: 2,
    fontSize: 16, align: 'center', valign: 'middle', ...p,
  }),
  connector: (a: ConnEnd, b: ConnEnd, p: Partial<ConnectorItem> = {}): ConnectorItem => ({
    ...base('connector', 0, 0, 0, 0), type: 'connector', a, b, route: 'elbow', capA: 'none', capB: 'arrow', stroke: '#1c1e23', strokeW: 2, ...p,
  }),
  frame: (p: Init<FrameItem>): FrameItem => ({
    ...base('frame', p.x, p.y, 800, 600), type: 'frame', title: 'Frame', fill: '#ffffff', ...p,
  }),
  image: (p: Init<ImageItem> & { src: string }): ImageItem => ({ ...base('image', p.x, p.y, 320, 240), type: 'image', ...p }),
  embed: (p: Init<EmbedItem> & { url: string }): EmbedItem => ({ ...base('embed', p.x, p.y, 560, 360), type: 'embed', kind: 'iframe', ...p }),
  ifc: (p: Init<IfcItem> & { src: string; name: string }): IfcItem => ({ ...base('ifc', p.x, p.y, 640, 460), type: 'ifc', ...p }),
  card: (p: Init<CardItem>): CardItem => ({ ...base('card', p.x, p.y, 280, 120), type: 'card', title: '', fill: '#0090ff', ...p }),
  table: (p: Init<TableItem>): TableItem => {
    const cells = p.cells || [['', '', ''], ['', '', ''], ['', '', '']]
    const cols = Math.max(1, ...cells.map((r) => r.length))
    const colW = p.colW || Array(cols).fill(140)
    const rowH = p.rowH || Array(cells.length).fill(40)
    return {
      ...base('table', p.x, p.y, colW.reduce((a: number, b: number) => a + b, 0), rowH.reduce((a: number, b: number) => a + b, 0)),
      type: 'table', header: true, fontSize: 14, ...p,
      cells: cells.map((r) => { const c = r.slice(); while (c.length < cols) c.push(''); return c }), colW, rowH,
    }
  },
  code: (p: Init<CodeItem>): CodeItem => ({ ...base('code', p.x, p.y, 420, 220), type: 'code', code: '', lang: 'text', fontSize: 13, dark: true, ...p }),
  comment: (p: Init<CommentItem>): CommentItem => ({ ...base('comment', p.x, p.y, 32, 32), type: 'comment', thread: [], ...p }),
  file: (p: Init<FileItem> & { src: string; name: string }): FileItem => ({ ...base('file', p.x, p.y, 260, 72), type: 'file', ...p }),
  chart: (p: Init<ChartItem>): ChartItem => ({ ...base('chart', p.x, p.y, 420, 280), type: 'chart', kind: 'bar', labels: [], values: [], ...p }),
}

export function plainSticky(x: number, y: number, text: string, fill = STICKY_COLORS[0]): StickyItem {
  return make.sticky({ x, y, html: textToHtml(text), fill })
}

export const FONT_STACK: Record<string, string> = {
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  hand: '"Comic Sans MS", "Segoe Print", "Bradley Hand", cursive',
}

/** Readable text colour for a given fill. */
export function inkOn(fill: string): string {
  if (!fill || fill === 'transparent') return '#1c1e23'
  const m = /^#?([0-9a-f]{6})$/i.exec(fill)
  if (!m) return '#1c1e23'
  const n = parseInt(m[1], 16)
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return l < 0.5 ? '#ffffff' : '#1c1e23'
}
