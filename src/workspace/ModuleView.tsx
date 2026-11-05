import { useDeferredValue, useEffect, useState } from 'react'
import { EmptyState } from '../components/EmptyState'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Bookmark, CalendarDays, ChevronLeft, ChevronRight, Clock, Download, Filter as FilterIcon, Flame, Kanban, Plus, Table2, Upload, X } from 'lucide-react'
import { ImportModal } from './ImportModal'
import { statusLabel, useApp } from './useApp'
import { Icon } from '../components/Icon'
import { can, canSeeCosts, costKeys, csvSafe, displayValue, fieldValue, groupIds, list, matches, money, parentField, recordTitle, rotting, score, todayISO } from '../lib/engine'
import { filtersFromUrl } from '../lib/reports'
import { groupChoices } from '../lib/hierarchy'
import { addView, useStore } from '../lib/store'
import { uid } from '../lib/schema'
import type { FieldDef, ModuleDef } from '../lib/schema'
import { moduleById } from '../lib/schema'
import type { Rec, Workspace } from '../lib/types'
import type { AppSchema } from '../lib/schema'
import { dateLocale, N_, tr } from '../lib/i18n'

const STATUS_PILL: Record<string, string> = { draft: 'gray', posted: '', partial: 'amber', paid: 'green', void: 'red', sent: '', accepted: 'green', declined: 'red', invoiced: 'green', ordered: 'amber' }

export default function ModuleView() {
  const { moduleId } = useParams()
  const { ws, user, schema } = useApp()
  const mod = moduleById(schema, moduleId ?? '')
  if (!mod) return <div className="page">{tr('This module no longer exists.')}</div>
  if (!can({ schema, user }, mod.id, 'view')) return <div className="page">{tr('Your role can’t see {what}.', { what: mod.name })}</div>
  return <View key={mod.id} mod={mod} ws={ws} schema={schema} />
}

function View({ mod, ws, schema }: { mod: ModuleDef; ws: Workspace; schema: AppSchema }) {
  const nav = useNavigate()
  const { user, act } = useApp()
  // Filters in the web address: a list opened from a figure on the dashboard (4.2c, UX-05).
  const [params, setParams] = useSearchParams()
  const linked = filtersFromUrl(params.get('f'))
  const linkedLabel = params.get('label') ?? ''
  const [view, setView] = useState<'table' | 'board' | 'calendar'>(mod.stages && !linked.length ? 'board' : 'table')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: '__created', dir: -1 })
  const [stage, setStage] = useState('')
  const [group, setGroup] = useState('')
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
  // Layers: a list whose records are under one another (customers under groups), or a list linked to one (their
  // invoices, deals, contacts) can show one group: the record chosen and everything under it.
  const via = parentField(mod) ? { field: parentField(mod)!, target: mod } : (() => {
    for (const f of mod.fields) {
      const t = f.type === 'relation' ? moduleById(schema, f.target ?? '') : undefined
      if (t && t.id !== mod.id && parentField(t)) return { field: f, target: t }
    }
    return undefined
  })()
  const groups = via ? groupChoices(ws, schema, via.target) : []
  const inGroup = group && via ? groupIds(ws, via.target, group) : undefined
  // The list follows the search a moment behind the typing, so the box never stalls on a long list.
  const query = useDeferredValue(q).toLowerCase()
  // Long lists get their search text ready in the background, a slice at a time, so the first letter typed is quick too.
  const colSig = cols.map((c) => c.key).join('|')
  useEffect(() => {
    if (all.length < 500) return
    let i = 0
    let handle = 0
    const step = () => {
      const end = Math.min(all.length, i + 1000)
      for (; i < end; i++) searchText(ws, schema, cols, all[i])
      if (i < all.length) handle = window.setTimeout(step, 0)
    }
    handle = window.setTimeout(step, 50)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, colSig])
  const rows = all
    .filter((r) => !linked.length || matches(schema, r, linked, ws))
    .filter((r) => !inGroup || inGroup.has(via!.target.id === mod.id ? r.id : String(r.values[via!.field.key] ?? '')))
    .filter((r) => !query || searchText(ws, schema, cols, r).includes(query))
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
    const header = [tr('Title'), ...(mod.stages ? [tr('Stage')] : []), ...(mod.lines ? [tr('Status')] : []), ...fields.map((f) => f.label), tr('Nasq360 id')]
    // the record's own id last: the file can be corrected in Excel and imported back onto exactly these records
    const lines = rows.map((r) => [recordTitle(ws, schema, r), ...(mod.stages ? [mod.stages.find((s) => s.id === r.stage)?.name ?? ''] : []), ...(mod.lines ? [statusLabel(r.status)] : []), ...fields.map((f) => f.type === 'currency' || f.type === 'number' ? String(r.values[f.key] ?? '') : displayValue(ws, schema, f, r.values[f.key])), r.id])
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
      {linked.length > 0 && (
        <div className="info row" style={{ marginBottom: 12, gap: 8 }}>
          <FilterIcon size={15} aria-hidden />
          <span className="grow">{tr('Showing {n} of {total}: {what}', { n: rows.length, total: all.length, what: linkedLabel || tr('filtered from the dashboard') })}</span>
          <button className="ghost small" onClick={() => setParams({}, { replace: true })}><X size={14} /> {tr('Show all')}</button>
        </div>
      )}
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
          <select value={stage} onChange={(e) => { setStage(e.target.value); setLimit(PAGE) }} style={{ width: 'auto' }} aria-label={mod.stages ? tr('Stage') : tr('Status')}>
            <option value="">{mod.stages ? tr('All stages') : tr('All statuses')}</option>
            {mod.stages?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            {mod.lines && (mod.role === 'quotes' ? ['draft', 'sent', 'accepted', 'ordered', 'declined', 'invoiced'] : (mod.role === 'purchases' ? ['draft', 'ordered', 'posted', 'partial', 'paid', 'void'] : ['draft', 'posted', 'partial', 'paid', 'void'])).map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
        )}
        {groups.length > 0 && (
          <select value={group} onChange={(e) => { setGroup(e.target.value); setLimit(PAGE) }} style={{ width: 'auto', maxWidth: 280 }} aria-label={tr('Group')}>
            <option value="">{via!.target.id === mod.id ? tr('All groups') : tr('All {what} groups', { what: via!.target.singular.toLowerCase() })}</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{'\u00a0\u00a0'.repeat(g.depth)}{g.label} ({g.members})</option>)}
          </select>
        )}
        <span className="grow" />
        {views.length > 0 && (
          <select value="" aria-label={tr('Saved views…')} onChange={(e) => { const v = views.find((x) => x.id === e.target.value); if (v) { setQ(v.q); setStage(v.stage); setSort(v.sort); setView(v.view === 'board' && !mod.stages ? 'table' : v.view) } }} style={{ width: 'auto' }}>
            <option value="">{tr('Saved views…')}</option>
            {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        <button className="ghost" onClick={saveView} title={tr('Save the current search, filter, sort and layout')}><Bookmark size={15} /> {tr('Save view')}</button>
      </div>

      {all.length === 0 ? (
        <EmptyState color={mod.color} icon={<Icon name={mod.icon} size={30} />} title={tr('No {what} yet', { what: mod.name.toLowerCase() })} text={tr('Create the first one, or bring them all in from Excel at once.')}
          action={can({ schema, user }, mod.id, 'create') && <Link className="btn" to={`/app/new/${mod.id}`}><Plus size={16} /> {tr('New {what}', { what: mod.singular.toLowerCase() })}</Link>} />
      ) : rows.length === 0 && (query || stage) ? (
        <EmptyState compact color={mod.color} icon={<FilterIcon size={22} />} title={tr('Nothing matches')} text={tr('No {what} match this search or filter.', { what: mod.name.toLowerCase() })}
          action={<button className="secondary" onClick={() => { setQ(''); setStage('') }}><X size={14} /> {tr('Clear the search')}</button>} />
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
                <tr key={r.id} onClick={() => nav(`/app/r/${r.id}`)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/app/r/${r.id}`) }} aria-label={recordTitle(ws, schema, r)}>
                  <td><b>{mod.lines ? (r.number ?? tr('Draft')) : recordTitle(ws, schema, r)}</b></td>
                  {mod.stages && <td>{(() => { const s = mod.stages.find((x) => x.id === r.stage); return s ? <span className="pill tint" style={{ ['--c' as string]: s.color }}>{s.name}</span> : null })()}</td>}
                  {mod.lines && <td><span className={`pill ${STATUS_PILL[r.status ?? 'draft']}`}>{statusLabel(r.status)}</span></td>}
                  {scored && <td><ScorePill n={score(ws, schema, r)} /></td>}
                  {cols.filter((c) => c.key !== mod.titleField).map((c) => <td key={c.id} className={isNum(c) ? 'num' : ''}><Cell field={c} rec={r} ws={ws} schema={schema} /></td>)}
                </tr>
              ))}
            </tbody>
            {cols.some((c) => c.type === 'currency') && (
              <tfoot>
                <tr>
                  <td>{tr('Total ({n})', { n: rows.length })}</td>
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

/**
 * What a record is found by in its list (its title, the columns shown, its old-system id and number), worked out once
 * per record and kept until the record changes: typing in the search box then only compares text.
 */
const SEARCH = new WeakMap<Rec, { sig: string; text: string }>()
function searchText(ws: Workspace, schema: AppSchema, cols: FieldDef[], r: Rec) {
  const sig = cols.map((c) => c.key).join('|')
  const hit = SEARCH.get(r)
  if (hit && hit.sig === sig) return hit.text
  const text = [recordTitle(ws, schema, r), ...cols.map((c) => displayValue(ws, schema, c, r.values[c.key])), r.legacy?.id ?? '', r.legacy?.number ?? ''].join('\n').toLowerCase()
  SEARCH.set(r, { sig, text })
  return text
}
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
    return o ? <span className="pill tint" style={{ ['--c' as string]: o.color }}>{o.label}</span> : null
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
  // Won and lost columns show what closed in the last 90 days; older history (imported years, say) only when asked.
  const [older, setOlder] = useState(false)
  const [cutoff] = useState(() => new Date(Date.now() - 90 * 86_400_000).toISOString())
  const closedAt = (r: Rec) => r.stageHistory?.at(-1)?.at ?? r.updatedAt
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="kanban">
        {mod.stages!.map((s) => {
          const all = rows.filter((r) => r.stage === s.id)
          const items = s.type === 'open' || older ? all : all.filter((r) => closedAt(r) >= cutoff)
          const hidden = all.length - items.length
          const sum = amountField ? items.reduce((t, r) => t + Number(r.values[amountField.key] ?? 0), 0) : 0
          return (
            <Column key={s.id} id={s.id}>
              <div className="kcol-head"><span className="dot" style={{ background: s.color }} />{s.name} <span className="pill gray tiny">{items.length}</span><span className="sum">{amountField ? money(sum, schema.company.currency).replace('.00', '') : `${s.probability}%`}</span></div>
              {items.slice(0, BOARD_CARDS).map((r) => <Card key={r.id} rec={r} color={s.color} mod={mod} ws={ws} schema={schema} amountField={amountField} />)}
              {items.length > BOARD_CARDS && <div className="tiny muted" style={{ padding: 8, textAlign: 'center' }}>{tr('+{n} more. Search or use the table to find them.', { n: (items.length - BOARD_CARDS).toLocaleString('en-US') })}</div>}
              {hidden > 0 && <button className="ghost small" style={{ width: '100%' }} onClick={() => setOlder(true)}>{tr('Show {n} closed more than 90 days ago', { n: hidden.toLocaleString('en-US') })}</button>}
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
    <div ref={setNodeRef} {...listeners} {...attributes} className={`kcard ${isDragging ? 'dragging' : ''} ${rot.rotting ? 'rotting' : ''}`} style={{ ['--c' as string]: rot.rotting ? 'var(--danger)' : color, transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }} onClick={() => nav(`/app/r/${rec.id}`)}>
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
