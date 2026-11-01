import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Bookmark, CalendarDays, ChevronLeft, ChevronRight, Clock, Download, Flame, Kanban, Plus, Table2, Upload } from 'lucide-react'
import { ImportModal } from './ImportModal'
import { statusLabel, useApp } from './useApp'
import { Icon } from '../components/Icon'
import { can, canSeeCosts, costKeys, csvSafe, displayValue, fieldValue, list, money, recordTitle, rotting, score, todayISO } from '../lib/engine'
import { addView, useStore } from '../lib/store'
import { uid } from '../lib/schema'
import type { FieldDef, ModuleDef } from '../lib/schema'
import { moduleById } from '../lib/schema'
import type { Rec, Workspace } from '../lib/types'
import type { AppSchema } from '../lib/schema'
import { dateLocale, N_, tr } from '../lib/i18n'

const STATUS_PILL: Record<string, string> = { draft: 'gray', posted: '', partial: 'amber', paid: 'green', void: 'red', sent: '', accepted: 'green', declined: 'red', invoiced: 'green' }

export default function ModuleView() {
  const { moduleId } = useParams()
  const { ws, user, schema } = useApp()
  const mod = moduleById(schema, moduleId ?? '')
  if (!mod) return <div className="page">{tr('This module no longer exists.')}</div>
  if (!can({ schema, user }, mod.id, 'view')) return <div className="page">Your role can’t see {mod.name}.</div>
  return <View key={mod.id} mod={mod} ws={ws} schema={schema} />
}

function View({ mod, ws, schema }: { mod: ModuleDef; ws: Workspace; schema: AppSchema }) {
  const nav = useNavigate()
  const { user, act } = useApp()
  const [view, setView] = useState<'table' | 'board' | 'calendar'>(mod.stages ? 'board' : 'table')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: '__created', dir: -1 })
  const [stage, setStage] = useState('')
  const [importing, setImporting] = useState(false)
  /** long lists show a page at a time, so they open fast */
  const [limit, setLimit] = useState(PAGE)
  const scored = (mod.scoring?.length ?? 0) > 0
  const dateField = mod.fields.find((f) => ['close_date', 'due_date', 'date', 'visit_date', 'survey_date'].includes(f.key)) ?? mod.fields.find((f) => f.type === 'date')
  const myViews = useStore((s) => s.prefs.views)
  const views = [...(ws.data.views ?? []).filter((v) => v.user === user.id), ...(myViews ?? [])].filter((v) => v.module === mod.id)
  function saveView() {
    const name = prompt(tr('Name this view'), stage ? tr('My filtered view') : tr('My view'))
    if (!name) return
    addView({ id: uid('v'), module: mod.id, user: user.id, name, q, stage, sort, view })
  }
  const costs = canSeeCosts({ schema, user })
  const secret = costs ? [] : costKeys(schema)
  const hidden = (key: string) => secret.includes(key)
  const cols = mod.fields.filter((f) => f.inList && !hidden(f.key)).slice(0, 7)
  const all = list(ws, mod.id)
  const rows = all
    .filter((r) => !q || recordTitle(ws, schema, r).toLowerCase().includes(q.toLowerCase()) || cols.some((c) => displayValue(ws, schema, c, r.values[c.key]).toLowerCase().includes(q.toLowerCase())))
    .filter((r) => !stage || r.stage === stage || r.status === stage)
    // each sort value is worked out once per record, not once per comparison
    .map((r) => {
      if (sort.key === '__created') return { r, v: r.createdAt as string | number }
      if (sort.key === '__score') return { r, v: score(ws, schema, r) as string | number }
      const f = mod.fields.find((x) => x.key === sort.key)
      return { r, v: ((f ? fieldValue(ws, schema, r, f) : r.values[sort.key]) as string | number | undefined) ?? '' }
    })
    .sort((a, b) => (a.v > b.v ? 1 : a.v < b.v ? -1 : 0) * sort.dir)
    .map((x) => x.r)

  function exportCsv() {
    const fields = mod.fields.filter((f) => !hidden(f.key))
    const header = [tr('Title'), ...(mod.stages ? [tr('Stage')] : []), ...(mod.lines ? [tr('Status')] : []), ...fields.map((f) => f.label)]
    const lines = rows.map((r) => [recordTitle(ws, schema, r), ...(mod.stages ? [mod.stages.find((s) => s.id === r.stage)?.name ?? ''] : []), ...(mod.lines ? [statusLabel(r.status)] : []), ...fields.map((f) => f.type === 'currency' || f.type === 'number' ? String(r.values[f.key] ?? '') : displayValue(ws, schema, f, r.values[f.key]))])
    const csv = [header, ...lines].map((l) => l.map((c) => `"${csvSafe(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${mod.name}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1><span className="badge" style={{ background: mod.color }}><Icon name={mod.icon} size={20} /></span>{mod.name} <span className="pill gray">{all.length}</span></h1>
        <div className="row">
          <div className="seg">
            {mod.stages && <button className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}><Kanban size={15} /> {tr('Board')}</button>}
            <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}><Table2 size={15} /> {tr('Table')}</button>
            {dateField && <button className={view === 'calendar' ? 'on' : ''} onClick={() => setView('calendar')}><CalendarDays size={15} /> {tr('Calendar')}</button>}
          </div>
          {can({ schema, user }, mod.id, 'create') && !mod.lines && <button className="secondary" onClick={() => setImporting(true)}><Upload size={15} /> {tr('Import')}</button>}
          <button className="secondary" onClick={exportCsv}><Download size={15} /> {tr('Export')}</button>
          {can({ schema, user }, mod.id, 'create') && <button onClick={() => nav(`/app/new/${mod.id}`)}><Plus size={16} /> {tr('New {what}', { what: mod.singular.toLowerCase() })}</button>}
        </div>
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE) }} placeholder={tr('Search {what}…', { what: mod.name.toLowerCase() })} style={{ maxWidth: 320 }} />
        {(mod.stages || mod.lines) && (
          <select value={stage} onChange={(e) => { setStage(e.target.value); setLimit(PAGE) }} style={{ width: 'auto' }}>
            <option value="">{mod.stages ? tr('All stages') : tr('All statuses')}</option>
            {mod.stages?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            {mod.lines && (mod.role === 'quotes' ? ['draft', 'sent', 'accepted', 'declined', 'invoiced'] : ['draft', 'posted', 'partial', 'paid', 'void']).map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        )}
        <span className="grow" />
        {views.length > 0 && (
          <select value="" onChange={(e) => { const v = views.find((x) => x.id === e.target.value); if (v) { setQ(v.q); setStage(v.stage); setSort(v.sort); setView(v.view === 'board' && !mod.stages ? 'table' : v.view) } }} style={{ width: 'auto' }}>
            <option value="">{tr('Saved views…')}</option>
            {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        <button className="ghost" onClick={saveView} title={tr('Save the current search, filter, sort and layout')}><Bookmark size={15} /> {tr('Save view')}</button>
      </div>

      {all.length === 0 ? (
        <div className="card empty">
          <div className="big-ic" style={{ background: mod.color }}><Icon name={mod.icon} size={32} /></div>
          <b>{tr('No {what} yet', { what: mod.name.toLowerCase() })}</b>
          <p className="small">{tr('Create the first one to get started.')}</p>
          {can({ schema, user }, mod.id, 'create') && <Link className="btn" to={`/app/new/${mod.id}`}><Plus size={16} /> New {mod.singular.toLowerCase()}</Link>}
        </div>
      ) : view === 'calendar' && dateField ? (
        <Calendar rows={rows} dateKey={dateField.key} ws={ws} schema={schema} color={mod.color} />
      ) : view === 'board' && mod.stages ? (
        <Board mod={mod} rows={rows} ws={ws} schema={schema} onMove={(id, st) => act('record.moveStage', { id, stage: st }, undefined, 'Moved on the board')} />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th onClick={() => setSort({ key: mod.titleField, dir: sort.dir === 1 ? -1 : 1 })}>{mod.lines ? tr('Number') : mod.fields.find((f) => f.key === mod.titleField)?.label}</th>
                {mod.stages && <th>{tr('Stage')}</th>}
                {mod.lines && <th>{tr('Status')}</th>}
                {scored && <th onClick={() => setSort({ key: '__score', dir: sort.key === '__score' && sort.dir === -1 ? 1 : -1 })}>{tr('Score')}{sort.key === '__score' ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</th>}
                {cols.filter((c) => c.key !== mod.titleField).map((c) => (
                  <th key={c.id} className={isNum(c) ? 'num' : ''} onClick={() => setSort({ key: c.key, dir: sort.key === c.key && sort.dir === 1 ? -1 : 1 })}>{c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((r) => (
                <tr key={r.id} onClick={() => nav(`/app/r/${r.id}`)}>
                  <td><b>{mod.lines ? (r.number ?? tr('Draft')) : recordTitle(ws, schema, r)}</b></td>
                  {mod.stages && <td>{(() => { const s = mod.stages.find((x) => x.id === r.stage); return s ? <span className="pill" style={{ background: s.color + '22', color: s.color }}>{s.name}</span> : null })()}</td>}
                  {mod.lines && <td><span className={`pill ${STATUS_PILL[r.status ?? 'draft']}`}>{statusLabel(r.status)}</span></td>}
                  {scored && <td><ScorePill n={score(ws, schema, r)} /></td>}
                  {cols.filter((c) => c.key !== mod.titleField).map((c) => <td key={c.id} className={isNum(c) ? 'num' : ''}><Cell field={c} rec={r} ws={ws} schema={schema} /></td>)}
                </tr>
              ))}
            </tbody>
            {cols.some((c) => c.type === 'currency') && (
              <tfoot>
                <tr>
                  <td>Total ({rows.length})</td>
                  {mod.stages && <td />}
                  {scored && <td />}
                  {mod.lines && <td />}
                  {cols.filter((c) => c.key !== mod.titleField).map((c) => <td key={c.id} className="num">{c.type === 'currency' ? money(rows.filter((r) => r.status !== 'void').reduce((s, r) => s + Number(fieldValue(ws, schema, r, c) ?? 0), 0), schema.company.currency) : ''}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
          {rows.length > limit && (
            <div className="row" style={{ justifyContent: 'center', padding: 12, gap: 12 }}>
              <span className="tiny muted">{tr('Showing {n} of {total}', { n: limit.toLocaleString('en-US'), total: rows.length.toLocaleString('en-US') })}</span>
              <button className="secondary small" onClick={() => setLimit(limit + PAGE)}>{tr('Show {n} more', { n: Math.min(PAGE, rows.length - limit) })}</button>
            </div>
          )}
        </div>
      )}
      {importing && <ImportModal mod={mod} onClose={() => setImporting(false)} />}
    </div>
  )
}

const PAGE = 100
/** cards shown per board column; the rest are counted, and the table or search finds them */
const BOARD_CARDS = 50

const isNum = (f: FieldDef) => ['number', 'currency', 'percent', 'formula'].includes(f.type)

function ScorePill({ n }: { n: number }) {
  const hot = n >= 40
  return <span className={`pill ${hot ? 'red' : n >= 20 ? 'amber' : 'gray'}`}><Flame size={12} /> {n}</span>
}

function Cell({ field, rec, ws, schema }: { field: FieldDef; rec: Rec; ws: Workspace; schema: AppSchema }) {
  const v = fieldValue(ws, schema, rec, field)
  if (field.type === 'select') {
    const o = field.options?.find((x) => x.value === v)
    return o ? <span className="pill" style={{ background: o.color + '22', color: o.color }}>{o.label}</span> : null
  }
  if (field.type === 'formula') return <>{v === undefined ? '' : Number(v).toLocaleString()}</>
  return <>{displayValue(ws, schema, field, v)}</>
}

function Board({ mod, rows, ws, schema, onMove }: { mod: ModuleDef; rows: Rec[]; ws: Workspace; schema: AppSchema; onMove: (id: string, stage: string) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const amountField = mod.fields.find((f) => f.type === 'currency')
  function onDragEnd(e: DragEndEvent) {
    if (e.over && e.active.data.current?.stage !== e.over.id) onMove(String(e.active.id), String(e.over.id))
  }
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="kanban">
        {mod.stages!.map((s) => {
          const items = rows.filter((r) => r.stage === s.id)
          const sum = amountField ? items.reduce((t, r) => t + Number(r.values[amountField.key] ?? 0), 0) : 0
          return (
            <Column key={s.id} id={s.id}>
              <div className="kcol-head"><span className="dot" style={{ background: s.color }} />{s.name} <span className="pill gray tiny">{items.length}</span><span className="sum">{amountField ? money(sum, schema.company.currency).replace('.00', '') : `${s.probability}%`}</span></div>
              {items.slice(0, BOARD_CARDS).map((r) => <Card key={r.id} rec={r} color={s.color} mod={mod} ws={ws} schema={schema} amountField={amountField} />)}
              {items.length > BOARD_CARDS && <div className="tiny muted" style={{ padding: 8, textAlign: 'center' }}>{tr('+{n} more. Search or use the table to find them.', { n: (items.length - BOARD_CARDS).toLocaleString('en-US') })}</div>}
            </Column>
          )
        })}
      </div>
    </DndContext>
  )
}

function Column({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return <div ref={setNodeRef} className={`kcol ${isOver ? 'over' : ''}`}>{children}</div>
}

function Card({ rec, color, mod, ws, schema, amountField }: { rec: Rec; color: string; mod: ModuleDef; ws: Workspace; schema: AppSchema; amountField?: FieldDef }) {
  const nav = useNavigate()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: rec.id, data: { stage: rec.stage } })
  const rot = rotting(schema, rec)
  const owner = mod.fields.find((f) => f.type === 'user')
  const rel = mod.fields.find((f) => f.type === 'relation')
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={`kcard ${isDragging ? 'dragging' : ''} ${rot.rotting ? 'rotting' : ''}`} style={{ ['--c' as string]: rot.rotting ? '#ef4444' : color, transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }} onClick={() => nav(`/app/r/${rec.id}`)}>
      <b>{recordTitle(ws, schema, rec)}</b>
      {(rot.rotting || (mod.scoring?.length ?? 0) > 0) && (
        <div className="row" style={{ gap: 4, margin: '2px 0 4px' }}>
          {(mod.scoring?.length ?? 0) > 0 && <ScorePill n={score(ws, schema, rec)} />}
          {rot.rotting && <span className="pill red tiny"><Clock size={11} /> idle {rot.days}d</span>}
        </div>
      )}
      {rel && <div className="tiny muted">{displayValue(ws, schema, rel, rec.values[rel.key])}</div>}
      <div className="meta">
        <span>{amountField ? displayValue(ws, schema, amountField, rec.values[amountField.key]) : ''}</span>
        <span>{owner ? displayValue(ws, schema, owner, rec.values[owner.key]) : ''}</span>
      </div>
    </div>
  )
}

function Calendar({ rows, dateKey, ws, schema, color }: { rows: Rec[]; dateKey: string; ws: Workspace; schema: AppSchema; color: string }) {
  const nav = useNavigate()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [y, m] = month.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1, 1))
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const lead = (first.getUTCDay() + 1) % 7 // weeks start on Saturday (Egypt); Sunday-first locales still read fine
  const shift = (d: number) => { const t = new Date(Date.UTC(y, m - 1 + d, 1)); setMonth(t.toISOString().slice(0, 7)) }
  const byDay = new Map<number, Rec[]>()
  for (const r of rows) {
    const v = String(r.values[dateKey] ?? '')
    if (v.slice(0, 7) === month) byDay.set(Number(v.slice(8, 10)), [...(byDay.get(Number(v.slice(8, 10))) ?? []), r])
  }
  const today = todayISO()
  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <button className="ghost icon" onClick={() => shift(-1)} aria-label={tr('Previous month')}><ChevronLeft size={18} className="flip" /></button>
        <b>{first.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })}</b>
        <button className="ghost icon" onClick={() => shift(1)} aria-label={tr('Next month')}><ChevronRight size={18} className="flip" /></button>
      </div>
      <div className="cal">
        {[N_('Sat'), N_('Sun'), N_('Mon'), N_('Tue'), N_('Wed'), N_('Thu'), N_('Fri')].map((d) => <div key={d} className="cal-h">{tr(d)}</div>)}
        {Array.from({ length: lead }, (_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1
          const iso = `${month}-${String(d).padStart(2, '0')}`
          return (
            <div key={d} className={`cal-d ${iso === today ? 'today' : ''}`}>
              <span className="cal-n">{d}</span>
              {(byDay.get(d) ?? []).slice(0, 4).map((r) => <div key={r.id} className="cal-ev" style={{ borderColor: color }} onClick={() => nav(`/app/r/${r.id}`)}>{recordTitle(ws, schema, r)}</div>)}
              {(byDay.get(d)?.length ?? 0) > 4 && <span className="tiny muted">{tr('+{n} more', { n: byDay.get(d)!.length - 4 })}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
