// Phase H4: calls, meetings, visits, e-mails and notes from the old system, each on the record it was about. Like the
// other imports: columns matched by name, people matched (or kept as former members), checked on a copy, sent in
// parts, and undone as a whole.
import { useMemo, useState } from 'react'
import { CheckCircle2, RotateCcw, Upload, X } from 'lucide-react'
import { useApp } from './useApp'
import { FORMER, importActivities, importKey, type ImportResult } from '../lib/engine'
import type { AppSchema } from '../lib/schema'
import { uid } from '../lib/schema'
import { flush } from '../lib/store'
import { ACTIVITY_COLUMNS } from '../lib/migration'
import { readXlsx, type Sheet } from '../lib/xlsx'
import { msg, tr, translate } from '../lib/i18n'

const PART = 500
const norm = (s: string) => importKey(s).replace(/[^a-z0-9؀-ۿ]/g, '')

function matchColumns(header: string[]) {
  const m: Record<string, string> = {}
  for (const c of ACTIVITY_COLUMNS) {
    const names = [c.label, translate('ar', c.label), c.key, ...(c.aliases ?? [])].map(norm)
    const h = header.find((x) => names.includes(norm(x))) ?? header.find((x) => names.some((n) => n.length > 2 && norm(x).includes(n)))
    if (h && !Object.values(m).includes(h)) m[c.key] = h
  }
  return m
}

export function ActivityImport({ preset, onClose }: { preset?: { fileName: string; sheet: Sheet }; onClose: () => void }) {
  const { ws, user, act } = useApp()
  const saved = ws.published as AppSchema
  const isAdmin = Boolean(saved.roles.find((r) => r.id === user.roleId)?.admin)
  const [file, setFile] = useState(preset?.fileName ?? '')
  const [table, setTable] = useState<string[][] | null>(preset?.sheet.rows ?? null)
  const [map, setMap] = useState<Record<string, string>>(() => (preset ? matchColumns(preset.sheet.rows[0] ?? []) : {}))
  const [people, setPeople] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [problem, setProblem] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ batch: string; created: number; errors: ImportResult['errors'] } | null>(null)
  const header = useMemo(() => table?.[0] ?? [], [table])
  const rows = useMemo(() => (table ?? []).slice(1).filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(ACTIVITY_COLUMNS.map((c) => [c.key, map[c.key] ? String(r[header.indexOf(map[c.key])] ?? '').trim() : '']))), [table, map, header])
  // Names in the "By" column that aren't team members: choose who they are, or keep them as former members.
  const unknown = [...new Set(rows.map((r) => r.by).filter(Boolean))].filter((n) => !ws.users.some((u) => importKey(u.name) === importKey(n) || u.email.toLowerCase() === n.toLowerCase()))
  const peopleMap = Object.fromEntries(Object.entries(people).map(([k, v]) => [importKey(k), v]))
  const missing = ACTIVITY_COLUMNS.filter((c) => c.required && !map[c.key])

  async function load(f: File) {
    setProblem('')
    try {
      const t = (await readXlsx(await f.arrayBuffer()))[0]?.rows ?? []
      if (t.length < 2) throw new Error(tr('This file has no rows'))
      setFile(f.name)
      setTable(t)
      setMap(matchColumns(t[0]))
      setPreview(null)
    } catch (e) {
      setProblem(msg((e as Error).message))
    }
  }
  function check() {
    setProblem('')
    try {
      setPreview(importActivities({ ws: structuredClone(ws), schema: saved, user }, rows, { people: peopleMap }))
    } catch (e) {
      setProblem(msg((e as Error).message))
    }
  }
  async function send() {
    const batch = { id: uid('imp'), file: file.slice(0, 120) }
    const total = Math.ceil(rows.length / PART)
    const sum = { batch: batch.id, created: 0, errors: [] as ImportResult['errors'] }
    setProgress({ done: 0, total })
    for (let p = 0; p < total; p++) {
      const res = act<ImportResult>('import.activities', { rows: rows.slice(p * PART, (p + 1) * PART), batch, firstRow: 2 + p * PART, people: peopleMap }, undefined, 'Imported activities and notes')
      if (!res) break
      sum.created += res.created
      sum.errors.push(...res.errors)
      await flush()
      setProgress({ done: p + 1, total })
    }
    setProgress(null)
    setResult(sum)
  }
  const cellOf = (e: ImportResult['errors'][number]) => (e.column && map[e.column] ? ` · ${map[e.column]}` : '')

  return (
    <>
      <div className="overlay" onClick={progress ? undefined : onClose} />
      <div className="modal">
        <div className="card stack" style={{ width: 'min(820px, 100%)' }}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>{tr('Calls, visits and notes')}</h2>
            {!progress && <button className="ghost icon" onClick={onClose} aria-label={tr('Close')}><X size={18} /></button>}
          </div>
          <p className="small muted" style={{ margin: 0 }}>{tr('One row per call, meeting, visit, e-mail or note, on the record it was about (its old system id or name). They join that record’s timeline with their own dates and notify nobody.')}</p>
          {problem && <div className="error-box">{problem}</div>}
          {!table && <label className="btn big" style={{ cursor: 'pointer' }}><Upload size={18} /> {tr('Choose an Excel file')}<input type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>}
          {table && !result && !progress && (
            <>
              <p className="small" style={{ margin: 0 }}><b>{file}</b> · {tr('{n} rows found. Match each column to a field:', { n: rows.length })}</p>
              <div className="form-grid">
                {ACTIVITY_COLUMNS.map((c) => (
                  <label key={c.key} className="field small">{tr(c.label)}{c.required ? ' *' : ''}
                    <select value={map[c.key] ?? ''} onChange={(e) => { setMap({ ...map, [c.key]: e.target.value }); setPreview(null) }}>
                      <option value="">{tr('— skip —')}</option>
                      {header.map((h, i) => <option key={h + i} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {unknown.length > 0 && (
                <div className="card" style={{ padding: 12 }}>
                  <b className="small">{tr('People to match ({n})', { n: unknown.length })}</b>
                  <table className="data" style={{ marginTop: 6 }}>
                    <tbody>
                      {unknown.map((n) => (
                        <tr key={n} style={{ cursor: 'default' }}>
                          <td><b>{n}</b></td>
                          <td>
                            <select value={people[n] ?? ''} onChange={(e) => { setPeople({ ...people, [n]: e.target.value }); setPreview(null) }}>
                              <option value="">{tr('Choose…')}</option>
                              {ws.users.filter((u) => !u.demo).map((u) => <option key={u.id} value={u.id}>{u.former ? tr('{name} (former)', { name: u.name }) : u.name}</option>)}
                              {isAdmin && <option value={FORMER}>{tr('Someone who has left: keep the name as a former member')}</option>}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {preview && (
                <>
                  <span className="pill">{tr('{n} new', { n: preview.created })}</span>
                  {preview.errors.length > 0 && (
                    <div className="error-box" style={{ maxHeight: 200, overflowY: 'auto' }}>
                      <b>{tr('{n} rows have problems:', { n: preview.errors.length })}</b>
                      <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{preview.errors.slice(0, 100).map((e) => <li key={e.row}>{tr('Row {n}', { n: e.row })}{cellOf(e)}: {msg(e.message)}</li>)}</ul>
                    </div>
                  )}
                </>
              )}
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="secondary" onClick={check} disabled={missing.length > 0}>{missing.length ? tr('Match: {fields}', { fields: missing.map((c) => tr(c.label)).join('، ') }) : tr('Check the rows')}</button>
                <button className="glow" onClick={() => void send()} disabled={!preview || preview.created === 0}><Upload size={16} /> {preview ? tr('Import {n} rows', { n: preview.created }) : tr('Check the rows first')}</button>
              </div>
            </>
          )}
          {progress && <div className="stack"><p className="small" style={{ margin: 0 }}>{tr('Saving part {a} of {b}… Keep this window open.', { a: Math.min(progress.done + 1, progress.total), b: progress.total })}</p><div className="meter"><i style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div></div>}
          {result && (
            <>
              <div className="ok-box row"><CheckCircle2 size={18} /> {tr('{n} activities and notes added.', { n: result.created })}</div>
              {result.errors.length > 0 && <div className="error-box"><ul style={{ margin: 0, paddingInlineStart: 18 }}>{result.errors.slice(0, 100).map((e) => <li key={e.row}>{tr('Row {n}', { n: e.row })}{cellOf(e)}: {msg(e.message)}</li>)}</ul></div>}
              <div className="row">
                <button onClick={onClose}>{tr('Done')}</button>
                {result.created > 0 && <button className="ghost" onClick={() => confirm(tr('Undo this import? Records it added are removed, and records it changed get their earlier values back.')) && act('import.undo', { batch: result.batch }, tr('Import undone')) && onClose()}><RotateCcw size={15} /> {tr('Undo this import')}</button>}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
