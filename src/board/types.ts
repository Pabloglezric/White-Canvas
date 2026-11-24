// Board data model. Every object on a board is an Item; items are stored one row each.

export type ItemType =
  | 'sticky' | 'text' | 'shape' | 'connector' | 'draw' | 'frame' | 'image' | 'embed'
  | 'ifc' | 'card' | 'table' | 'code' | 'comment' | 'file' | 'chart'

export type ShapeKind =
  | 'rect' | 'round' | 'ellipse' | 'diamond' | 'triangle' | 'parallelogram' | 'hexagon'
  | 'star' | 'pill' | 'cylinder' | 'cloud' | 'callout' | 'arrowRight' | 'arrowLeft'
  | 'pentagon' | 'octagon' | 'trapezoid' | 'cross' | 'document' | 'predefined'

export type Dash = 'solid' | 'dashed' | 'dotted'
export type Cap = 'none' | 'arrow' | 'triangle' | 'dot' | 'diamond' | 'bar'
export type Route = 'straight' | 'elbow' | 'curve'
export type Align = 'left' | 'center' | 'right'
export type VAlign = 'top' | 'middle' | 'bottom'

export interface ItemBase {
  id: string
  type: ItemType
  x: number
  y: number
  w: number
  h: number
  rot: number
  z: number
  rev: number
  parent?: string | null // containing frame
  group?: string | null
  locked?: boolean
  by?: string // creator user id
  votes?: string[] // voter ids while a voting session is open
}

export interface TextStyle {
  fontSize?: number
  color?: string
  align?: Align
  valign?: VAlign
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  font?: 'sans' | 'serif' | 'mono' | 'hand'
}

export interface StickyItem extends ItemBase, TextStyle {
  type: 'sticky'
  html: string
  fill: string
  autoFit?: boolean
  tags?: string[]
  author?: string
}

export interface TextItem extends ItemBase, TextStyle {
  type: 'text'
  html: string
  fill?: string
  autoW?: boolean // grows horizontally while typing until the width is set by hand
}

export interface ShapeItem extends ItemBase, TextStyle {
  type: 'shape'
  kind: ShapeKind
  html: string
  fill: string
  stroke: string
  strokeW: number
  dash?: Dash
  opacity?: number
}

export interface ConnEnd {
  item?: string
  ax?: number // normalised anchor on the attached item; undefined = pick the best side
  ay?: number
  x: number // world position when free
  y: number
}

export interface ConnectorItem extends ItemBase {
  type: 'connector'
  a: ConnEnd
  b: ConnEnd
  route: Route
  capA: Cap
  capB: Cap
  stroke: string
  strokeW: number
  dash?: Dash
  label?: string
  color?: string
  fontSize?: number
}

export interface DrawItem extends ItemBase {
  type: 'draw'
  pts: number[] // x,y,pressure triples relative to the item origin at w0×h0
  w0: number
  h0: number
  stroke: string
  size: number
  tool: 'pen' | 'highlighter'
}

export interface FrameItem extends ItemBase {
  type: 'frame'
  title: string
  fill: string
  hidden?: boolean
}

export interface ImageItem extends ItemBase {
  type: 'image'
  src: string // asset:<path> | data: | https:
  alt?: string
  nw?: number
  nh?: number
}

export interface EmbedItem extends ItemBase {
  type: 'embed'
  url: string
  src?: string // resolved iframe URL
  kind: 'iframe' | 'link' | 'html'
  html?: string
  title?: string
  desc?: string
  thumb?: string
  site?: string
}

export interface IfcItem extends ItemBase {
  type: 'ifc'
  src: string
  name: string
  size?: number
  cam?: number[] // position xyz + target xyz
  preview?: string
  hiddenTypes?: number[]
  section?: number | null
}

export interface CardItem extends ItemBase {
  type: 'card'
  title: string
  desc?: string
  status?: string
  assignee?: string
  due?: string
  tags?: string[]
  fill: string
}

export interface TableItem extends ItemBase, TextStyle {
  type: 'table'
  cells: string[][]
  colW: number[]
  rowH: number[]
  header?: boolean
  fill?: string
  stroke?: string
}

export interface CodeItem extends ItemBase {
  type: 'code'
  code: string
  lang: string
  fontSize?: number
  dark?: boolean
}

export interface CommentEntry { id: string; by: string; name: string; text: string; at: number }
export interface CommentItem extends ItemBase {
  type: 'comment'
  thread: CommentEntry[]
  resolved?: boolean
  fill?: string
}

export interface FileItem extends ItemBase {
  type: 'file'
  src: string
  name: string
  mime?: string
  size?: number
}

export interface ChartItem extends ItemBase {
  type: 'chart'
  kind: 'bar' | 'line' | 'pie'
  title?: string
  labels: string[]
  values: number[]
  fill?: string
}

export type Item =
  | StickyItem | TextItem | ShapeItem | ConnectorItem | DrawItem | FrameItem | ImageItem
  | EmbedItem | IfcItem | CardItem | TableItem | CodeItem | CommentItem | FileItem | ChartItem

export type Tool =
  | 'select' | 'hand' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'highlighter'
  | 'eraser' | 'frame' | 'comment' | 'card' | 'table' | 'code' | 'laser'

export interface Camera { x: number; y: number; z: number }
export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer'

export interface Peer {
  id: string // client id
  user: string
  name: string
  color: string
  cursor?: Pt | null
  sel?: string[]
  cam?: Camera & { vw: number; vh: number }
  seen: number
}

export interface BoardMeta {
  id: string
  title: string
  owner_id: string
  link_access: 'none' | 'view' | 'comment' | 'edit'
  settings: BoardSettings
  updated_at: string
  created_at: string
  thumbnail?: string | null
  trashed_at?: string | null
}

export interface BoardSettings {
  grid?: 'dots' | 'lines' | 'none'
  bg?: string
  snap?: boolean
  voting?: { open: boolean; max: number; title?: string } | null
  timer?: { endsAt: number | null; duration: number; paused?: number | null } | null
}

export const TEXT_TYPES: ItemType[] = ['sticky', 'text', 'shape']
