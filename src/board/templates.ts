// Starter layouts. Each builder returns items positioned around (0,0); the caller moves them into view.
import { textToHtml } from '../lib/util'
import { STICKY_COLORS, make } from './defaults'
import type { Item } from './types'

export interface Template { id: string; name: string; desc: string; build: () => Item[] }

const title = (x: number, y: number, text: string, size = 28) => make.text({ x, y, w: 600, autoW: true, fontSize: size, bold: true, html: textToHtml(text) })
const note = (x: number, y: number, text: string, fill: string, w = 200) => make.sticky({ x, y, w, h: w, fill, html: textToHtml(text) })
const link = (a: Item, b: Item, label?: string) => make.connector({ item: a.id, x: a.x, y: a.y }, { item: b.id, x: b.x, y: b.y }, { label })

function columns(names: string[], colors: string[], hints: string[], w = 360, h = 640): Item[] {
  const out: Item[] = []
  names.forEach((n, i) => {
    const f = make.frame({ x: i * (w + 40), y: 0, w, h, title: n })
    const s = note(i * (w + 40) + 30, 30, hints[i] || '', colors[i % colors.length], 180)
    s.parent = f.id
    out.push(f, s)
  })
  return out
}

export const TEMPLATES: Template[] = [
  {
    id: 'kanban', name: 'Kanban board', desc: 'To do, doing, done with task cards',
    build: () => {
      const out: Item[] = []
      const cols = [['To do', '#6e56cf'], ['In progress', '#f76b15'], ['Review', '#0090ff'], ['Done', '#30a46c']]
      cols.forEach(([n, c], i) => {
        const f = make.frame({ x: i * 340, y: 0, w: 320, h: 620, title: n })
        out.push(f)
        const count = i === 0 ? 3 : i === 3 ? 1 : 2
        for (let k = 0; k < count; k++) out.push({ ...make.card({ x: i * 340 + 20, y: 20 + k * 140, title: `Task ${i + 1}.${k + 1}`, status: n, fill: c }), parent: f.id })
      })
      return out
    },
  },
  {
    id: 'retro', name: 'Retrospective', desc: 'Went well, to improve, actions',
    build: () => columns(['Went well', 'To improve', 'Ideas', 'Actions'], [STICKY_COLORS[8], STICKY_COLORS[2], STICKY_COLORS[6], STICKY_COLORS[4]], ['What worked?', 'What slowed us down?', 'What could we try?', 'Who does what by when?']),
  },
  {
    id: 'brainstorm', name: 'Brainstorm', desc: 'A question surrounded by idea notes',
    build: () => {
      const out: Item[] = [title(-200, -330, 'How might we…?', 40)]
      const cols = 5
      for (let i = 0; i < 15; i++) out.push(note((i % cols) * 220 - 550, Math.floor(i / cols) * 220 - 220, '', STICKY_COLORS[i % 9]))
      return out
    },
  },
  {
    id: 'flow', name: 'Flowchart', desc: 'Start, steps, a decision and an end',
    build: () => {
      const s = make.shape({ x: 0, y: 0, w: 180, h: 70, kind: 'pill', html: 'Start', fill: '#c4eea6' })
      const a = make.shape({ x: 0, y: 140, w: 180, h: 80, kind: 'rect', html: 'Step' })
      const d = make.shape({ x: -10, y: 290, w: 200, h: 130, kind: 'diamond', html: 'Decision?', fill: '#fff2a8' })
      const y = make.shape({ x: 0, y: 500, w: 180, h: 80, kind: 'rect', html: 'Do this' })
      const n = make.shape({ x: 300, y: 315, w: 180, h: 80, kind: 'rect', html: 'Do that' })
      const e = make.shape({ x: 0, y: 650, w: 180, h: 70, kind: 'pill', html: 'End', fill: '#ffb7a0' })
      return [s, a, d, y, n, e, link(s, a), link(a, d), link(d, y, 'Yes'), link(d, n, 'No'), link(y, e),
        make.connector({ item: n.id, ax: 0.5, ay: 1, x: 0, y: 0 }, { item: e.id, ax: 1, ay: 0.5, x: 0, y: 0 })]
    },
  },
  {
    id: 'mindmap', name: 'Mind map', desc: 'Central topic with branches',
    build: () => {
      const c = make.shape({ x: -110, y: -45, w: 220, h: 90, kind: 'pill', html: '<b>Main topic</b>', fill: '#1c1e23', color: '#ffffff', fontSize: 20 })
      const out: Item[] = [c]
      const fills = ['#ffd98a', '#a8dcff', '#c4eea6', '#e3c4ff', '#ffb3d1', '#a6ecd9']
      for (let i = 0; i < 6; i++) {
        const side = i < 3 ? 1 : -1
        const row = (i % 3) - 1
        const b = make.shape({ x: side * 360 - 90, y: row * 150 - 32, w: 180, h: 64, kind: 'round', html: `Branch ${i + 1}`, fill: fills[i], strokeW: 0 })
        out.push(b, make.connector({ item: c.id, x: 0, y: 0 }, { item: b.id, x: b.x, y: b.y }, { route: 'curve', capB: 'none' }))
        for (let k = 0; k < 2; k++) {
          // left-hand leaves are right-aligned so their text meets the branch line
          const leaf = make.text({ x: side * 620 - (side < 0 ? 100 : 0), y: row * 150 - 34 + k * 40, w: 120, autoW: side > 0, align: side > 0 ? 'left' : 'right', fontSize: 15, html: `Idea ${k + 1}` })
          out.push(leaf, make.connector({ item: b.id, x: 0, y: 0 }, { item: leaf.id, x: leaf.x, y: leaf.y }, { route: 'curve', capB: 'none', strokeW: 1.5, stroke: '#8f939d' }))
        }
      }
      return out
    },
  },
  {
    id: 'swot', name: 'SWOT analysis', desc: 'Strengths, weaknesses, opportunities, threats',
    build: () => {
      const names = ['Strengths', 'Weaknesses', 'Opportunities', 'Threats']
      const fills = ['#c4eea6', '#ffb7a0', '#a8dcff', '#ffd98a']
      const out: Item[] = []
      names.forEach((n, i) => {
        const x = (i % 2) * 520, y = Math.floor(i / 2) * 420
        out.push(make.shape({ x, y, w: 500, h: 400, kind: 'round', fill: fills[i], strokeW: 0, html: '', opacity: 0.45 }), title(x + 24, y + 18, n, 22))
      })
      return out
    },
  },
  {
    id: 'timeline', name: 'Project timeline', desc: 'Phases across months with milestones',
    build: () => {
      const out: Item[] = []
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
      months.forEach((m, i) => out.push(make.shape({ x: i * 200, y: 0, w: 200, h: 44, kind: 'rect', html: m, fill: '#f1f0ec', strokeW: 1, stroke: '#c9c7c0' })))
      const phases: [string, number, number, string][] = [['Brief', 0, 1.5, '#b9c8ff'], ['Concept design', 1.2, 2, '#a8dcff'], ['Developed design', 2.8, 2, '#a6ecd9'], ['Technical design', 4.2, 1.8, '#ffd98a']]
      phases.forEach(([n, s, len, fill], i) => out.push(make.shape({ x: s * 200, y: 70 + i * 70, w: len * 200, h: 50, kind: 'round', html: n, fill, strokeW: 0 })))
      out.push(make.shape({ x: 3 * 200 - 20, y: 370, w: 40, h: 40, kind: 'diamond', fill: '#e5484d', strokeW: 0, html: '' }), make.text({ x: 3 * 200 + 30, y: 378, autoW: true, fontSize: 15, html: 'Planning submission' }))
      return out
    },
  },
  {
    id: 'review', name: 'Drawing review sheet', desc: 'A1 sheet with a markup legend and action list',
    build: () => {
      const f = make.frame({ x: 0, y: 0, w: 3179, h: 2245, title: 'Drawing review — A1' })
      const legend: [string, string][] = [['Change required', '#e5484d'], ['Query', '#f76b15'], ['Approved', '#30a46c'], ['Note', '#0090ff']]
      const out: Item[] = [f, { ...title(2500, 60, 'Markup legend', 30), parent: f.id }]
      legend.forEach(([n, c], i) => {
        out.push({ ...make.shape({ x: 2500, y: 130 + i * 70, w: 46, h: 46, kind: 'ellipse', fill: c, strokeW: 0, html: '' }), parent: f.id })
        out.push({ ...make.text({ x: 2565, y: 138 + i * 70, autoW: true, fontSize: 24, html: n }), parent: f.id })
      })
      out.push({ ...make.table({ x: 2500, y: 460, cells: [['#', 'Action', 'Owner', 'Due'], ['1', '', '', ''], ['2', '', '', ''], ['3', '', '', '']], colW: [50, 330, 120, 110], rowH: [44, 60, 60, 60], fontSize: 18 }), parent: f.id })
      out.push({ ...make.text({ x: 80, y: 60, w: 1200, autoW: true, fontSize: 30, color: '#8f939d', html: 'Drop a drawing, PDF or IFC model here, then mark it up with the pen' }), parent: f.id })
      return out
    },
  },
  {
    id: 'meeting', name: 'Meeting notes', desc: 'Agenda, notes, decisions and actions',
    build: () => {
      const f = make.frame({ x: 0, y: 0, w: 1100, h: 760, title: 'Meeting' })
      const kids: Item[] = [
        title(40, 30, 'Meeting title'),
        make.text({ x: 40, y: 80, w: 500, fontSize: 15, color: '#8f939d', html: 'Date · Attendees' }),
        title(40, 140, 'Agenda', 18), make.text({ x: 40, y: 175, w: 460, fontSize: 16, html: '<ul><li>Topic one</li><li>Topic two</li><li>Topic three</li></ul>' }),
        title(40, 330, 'Notes', 18), make.text({ x: 40, y: 365, w: 460, fontSize: 16, html: 'Write here…' }),
        title(580, 140, 'Decisions', 18), note(580, 180, '', STICKY_COLORS[8], 160), note(760, 180, '', STICKY_COLORS[8], 160),
        title(580, 380, 'Actions', 18),
        make.table({ x: 580, y: 420, cells: [['Action', 'Owner', 'Due'], ['', '', ''], ['', '', '']], colW: [240, 110, 110], rowH: [38, 46, 46] }),
      ]
      return [f, ...kids.map((k) => ({ ...k, parent: f.id }))]
    },
  },
  {
    id: 'matrix', name: 'Priority matrix', desc: 'Impact against effort in four quadrants',
    build: () => {
      const out: Item[] = []
      const q: [string, string][] = [['Quick wins', '#c4eea6'], ['Big bets', '#a8dcff'], ['Fill-ins', '#d9d6cc'], ['Avoid', '#ffb7a0']]
      q.forEach(([n, fill], i) => {
        const x = (i % 2) * 460, y = Math.floor(i / 2) * 360
        out.push(make.shape({ x, y, w: 450, h: 350, kind: 'rect', fill, strokeW: 0, html: '', opacity: 0.5 }), title(x + 18, y + 14, n, 20))
      })
      out.push(make.text({ x: 380, y: 730, autoW: true, fontSize: 16, color: '#5b5f6a', html: 'Effort →' }), { ...make.text({ x: -90, y: 340, autoW: true, fontSize: 16, color: '#5b5f6a', html: 'Impact →' }), rot: 270 })
      return out
    },
  },
]
