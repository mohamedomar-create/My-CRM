import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RotateCcw, Upload, X } from 'lucide-react'
import { useApp } from './useApp'
import { importKey, importStatus, previewImport, recordTitle, findRecord, type ImportOptions, type ImportResult } from '../lib/engine'
import type { AppSchema, FieldDef, ModuleDef } from '../lib/schema'
import { uid } from '../lib/schema'
import { flush } from '../lib/store'
import { readXlsx, type Sheet } from '../lib/xlsx'
import { IMPORT_COLUMNS } from '../lib/migration'
import { dateLocale, msg, tr, translate } from '../lib/i18n'

/** Parses CSV exported from Excel or Google Sheets (quotes, commas or semicolons, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

/** A CSV saved by Arabic Excel on Windows is often in the old Arabic code page, not UTF-8. */
async function readCsvFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  return utf8.includes('�') ? new TextDecoder('windows-1256').decode(bytes) : utf8
}

const norm = (s: string) => importKey(s).replace(/[^a-z0-9؀-ۿ]/g, '')
const toCsv = (rows: string[][]) => '﻿' + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n')

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** Rows sent to the server at a time: each part is saved before the next is sent. */
const PART = 500
const MAX_ROWS = 50_000

/** Columns that go somewhere other than a field. */
const TARGETS = IMPORT_COLUMNS

/** Fields whose values must be one of a list: those values can be matched to what the file says. */
const listField = (f?: FieldDef) => f && ['select', 'multiselect', 'user'].includes(f.type)

type Choice = { value: string; label: string; also: string[] }

export function ImportModal({ mod, onClose, preset }: { mod: ModuleDef; onClose: () => void; preset?: { fileName: string; sheet: Sheet } }) {
  const { ws, user, act } = useApp()
  // The saved schema (English names), which the server imports with; mod is the one shown, in the chosen language.
  const saved = ws.published as AppSchema
  const raw = saved.modules.find((m) => m.id === mod.id) ?? mod
  const isAdmin = Boolean(saved.roles.find((r) => r.id === user.roleId)?.admin)

  const fields = raw.fields.filter((f) => !f.readOnly && !['formula', 'lookup', 'rollup'].includes(f.type))
  const shown = (f: FieldDef) => mod.fields.find((x) => x.id === f.id)?.label ?? f.label
  const targets = TARGETS.filter((t) => !t.stages || raw.stages)

  /** Columns matched to fields by their names (in either language, * for required ignored). */
  function mapFor(h: string[]) {
    const m: Record<string, string> = {}
    const names = [
      ...fields.map((f) => ({ key: f.key, names: [f.label, shown(f), translate('ar', f.label), f.key] })),
      ...targets.map((t) => ({ key: t.key, names: [t.label, translate('ar', t.label)] })),
    ]
    for (const col of h) {
      const c = norm(col)
      const hit = names.find((x) => x.names.some((n) => norm(n) === c)) ?? names.find((x) => x.names.some((n) => norm(n).length > 2 && (c.includes(norm(n)) || norm(n).includes(c))))
      if (hit && !Object.values(m).includes(hit.key)) m[col] = hit.key
    }
    return m
  }
  const headerOf = (sh?: Sheet) => (sh?.rows[0] ?? []).map((x, i) => x.trim() || tr('Column {n}', { n: i + 1 }))
  // A sheet handed over by the migration wizard opens straight on the matching step.
  const [initial] = useState(() => (preset ? mapFor(headerOf(preset.sheet)) : {}))

  const [fileName, setFileName] = useState(preset?.fileName ?? '')
  const [sheets, setSheets] = useState<Sheet[]>(preset ? [preset.sheet] : [])
  const [sheet, setSheet] = useState(0)
  const [problem, setProblem] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>(initial)
  const [match, setMatch] = useState(Object.values(initial).includes('__legacy_id') ? '__legacy_id' : '')
  const [onlyUpdate, setOnlyUpdate] = useState(false)
  const [manual, setManual] = useState<Record<string, Record<string, string>>>({})
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<(Pick<ImportResult, 'created' | 'updated' | 'skipped' | 'errors'> & { batch: string; stopped: boolean }) | null>(null)

  // The chosen sheet as a header and rows of named cells (duplicate or empty headers made unique).
  const table = useMemo(() => sheets[sheet]?.rows ?? [], [sheets, sheet])
  const header = useMemo(() => {
    const seen = new Map<string, number>()
    return (table[0] ?? []).map((h, i) => {
      const base = h.trim() || tr('Column {n}', { n: i + 1 })
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return n > 1 ? `${base} (${n})` : base
    })
  }, [table])
  const objects = useMemo(() => table.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))), [table, header])

  function autoMap(h: string[]) {
    const m = mapFor(h)
    setMapping(m)
    setMatch(Object.values(m).includes('__legacy_id') ? '__legacy_id' : '')
  }

  async function load(file: File) {
    setProblem('')
    setPreview(null)
    setResult(null)
    try {
      let got: Sheet[]
      if (/\.xlsx$/i.test(file.name)) got = await readXlsx(await file.arrayBuffer())
      else if (/\.xls$/i.test(file.name)) throw new Error(tr('Old .xls files can’t be read. In Excel, choose File → Save as → Excel workbook (.xlsx) or CSV.'))
      else got = [{ name: file.name, rows: parseCsv(await readCsvFile(file)) }]
      got = got.filter((s) => s.rows.length > 0)
      if (!got.length) throw new Error(tr('This file has no rows'))
      if (got.some((s) => s.rows.length - 1 > MAX_ROWS)) throw new Error(tr('Import up to {n} rows from one file. Split the file and import it in parts.', { n: MAX_ROWS.toLocaleString('en-US') }))
      setFileName(file.name)
      setSheets(got)
      setSheet(0)
      setManual({})
      const h = got[0].rows[0].map((x, i) => x.trim() || tr('Column {n}', { n: i + 1 }))
      autoMap(h)
    } catch (e) {
      setProblem((e as Error).message)
    }
  }

  // The values each list column holds, and what each means here: matched by itself, matched by hand, or not yet.
  const valueColumns = useMemo(() => {
    const out: { col: string; key: string; label: string; choices: Choice[]; values: { key: string; raw: string; count: number; auto?: string }[] }[] = []
    for (const [col, key] of Object.entries(mapping)) {
      const f = fields.find((x) => x.key === key)
      let choices: Choice[] | undefined
      if (key === '__stage' && raw.stages) choices = raw.stages.map((s) => ({ value: s.id, label: mod.stages?.find((x) => x.id === s.id)?.name ?? s.name, also: [s.name, translate('ar', s.name)] }))
      else if (f && listField(f)) {
        choices = f.type === 'user'
          ? ws.users.map((u) => ({ value: u.id, label: u.name, also: [u.name, u.email, u.name.split(' ')[0]] }))
          : (f.options ?? []).map((o) => ({ value: o.value, label: mod.fields.find((x) => x.id === f.id)?.options?.find((y) => y.value === o.value)?.label ?? o.label, also: [o.value, o.label, translate('ar', o.label)] }))
      }
      if (!choices) continue
      const counts = new Map<string, { raw: string; count: number }>()
      for (const r of objects) {
        const cell = String(r[col] ?? '').trim()
        if (!cell) continue
        for (const part of f?.type === 'multiselect' ? cell.split(/[,;|،]/) : [cell]) {
          const k = importKey(part)
          if (!k) continue
          counts.set(k, { raw: counts.get(k)?.raw ?? part.trim(), count: (counts.get(k)?.count ?? 0) + 1 })
        }
      }
      const values = [...counts].slice(0, 300).map(([k, v]) => {
        const exact = choices!.filter((c) => c.also.some((a) => importKey(a) === k))
        return { key: k, raw: v.raw, count: v.count, auto: exact.length === 1 ? exact[0].value : undefined }
      })
      out.push({ col, key, label: key === '__stage' ? tr('Stage') : mod.fields.find((x) => x.id === f!.id)?.label ?? f!.label, choices, values })
    }
    return out
  }, [mapping, objects, fields, raw, mod, ws.users])

  /** Every list value the file holds, as the import should read it (matched by itself or by hand). */
  const values = useMemo(() => {
    const out: Record<string, Record<string, string>> = {}
    for (const c of valueColumns) {
      for (const v of c.values) {
        const chosen = manual[c.key]?.[v.key] ?? v.auto
        if (chosen !== undefined) (out[c.key] ??= {})[v.key] = chosen
      }
    }
    return out
  }, [valueColumns, manual])
  const unmatched = valueColumns.flatMap((c) => c.values.filter((v) => (manual[c.key]?.[v.key] ?? v.auto) === undefined).map((v) => ({ ...v, column: c })))

  // Columns that can find a record already here: the old system id, or a field the file fills.
  const matchable = [
    ...(Object.values(mapping).includes('__legacy_id') ? [{ key: '__legacy_id', label: tr('Old system id') }] : []),
    ...fields.filter((f) => ['text', 'email', 'phone', 'number'].includes(f.type) && Object.values(mapping).includes(f.key)).map((f) => ({ key: f.key, label: shown(f) })),
  ]
  const missing = raw.fields.filter((f) => f.required && !f.readOnly && !f.showIf && !Object.values(mapping).includes(f.key))
  const options = (): ImportOptions => ({ match: match || undefined, onlyUpdate: Boolean(match) && onlyUpdate, values })

  function check() {
    setChecking(true)
    setTimeout(() => {
      try {
        setPreview(previewImport({ ws, schema: saved, user }, mod.id, objects, mapping, options()))
      } catch (e) {
        setProblem(msg((e as Error).message))
      }
      setChecking(false)
    }, 20)
  }

  async function send() {
    const batch = { id: uid('imp'), file: fileName.slice(0, 120) }
    const total = Math.ceil(objects.length / PART)
    const sum = { batch: batch.id, created: 0, updated: 0, skipped: 0, errors: [] as ImportResult['errors'], stopped: false }
    setProgress({ done: 0, total })
    for (let p = 0; p < total; p++) {
      const rows = objects.slice(p * PART, (p + 1) * PART)
      const res = act<ImportResult>('import.rows', { module: mod.id, rows, mapping, batch, firstRow: 2 + p * PART, ...options() }, undefined, `Imported ${raw.name.toLowerCase()}`)
      if (!res) { sum.stopped = true; break }
      sum.created += res.created
      sum.updated += res.updated
      sum.skipped += res.skipped
      sum.errors.push(...res.errors)
      // Each part is saved before the next one is sent, so a big file never becomes one huge change.
      await flush()
      setProgress({ done: p + 1, total })
    }
    setResult(sum)
    setProgress(null)
  }

  function problemRows(errors: ImportResult['errors']) {
    const byRow = new Map<number, string[]>()
    for (const e of errors) byRow.set(e.row, [...(byRow.get(e.row) ?? []), msg(e.message)])
    const out = [[...header, tr('Problem')]]
    for (const [row, problems] of byRow) out.push([...header.map((h) => objects[row - 2]?.[h] ?? ''), problems.join(' · ')])
    download(`${fileName.replace(/\.\w+$/, '')} – ${tr('rows with problems')}.csv`, toCsv(out))
  }

  function template() {
    const cols = [...fields.map(shown), ...targets.filter((t) => t.key !== '__stage_date').map((t) => tr(t.label))]
    download(`${mod.name} – ${tr('import template')}.csv`, toCsv([cols]))
  }

  const earlier = (ws.data.imports ?? []).filter((b) => b.module === mod.id).slice(0, 8)
  const who = (id: string) => ws.users.find((u) => u.id === id)?.name ?? '—'
  const errorList = (errors: ImportResult['errors']) => (
    <div className="error-box" style={{ maxHeight: 220, overflowY: 'auto' }}>
      <div className="row between"><b>{tr('{n} rows have problems:', { n: new Set(errors.map((e) => e.row)).size })}</b><button className="ghost small" onClick={() => problemRows(errors)}><Download size={14} /> {tr('Download them to fix')}</button></div>
      <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
        {errors.slice(0, 100).map((e, i) => <li key={i}>{tr('Row {n}', { n: e.row })}{e.column ? ` · ${e.column}` : ''}: {msg(e.message)}</li>)}
      </ul>
    </div>
  )

  const step = result ? 'done' : progress ? 'sending' : sheets.length ? 'map' : 'file'
  return (
    <>
      <div className="overlay" onClick={step === 'sending' ? undefined : onClose} />
      <div className="modal">
        <div className="card stack" style={{ width: 'min(880px, 100%)' }}>
          <div className="row between">
            <h2 style={{ margin: 0 }}><FileSpreadsheet size={18} /> {tr('Import {what}', { what: mod.name.toLowerCase() })}</h2>
            {step !== 'sending' && <button className="ghost icon" onClick={onClose} aria-label={tr('Close')}><X size={18} /></button>}
          </div>
          {problem && <div className="error-box">{problem}</div>}

          {step === 'file' && (
            <>
              <p className="muted small" style={{ margin: 0 }}>{tr('Upload an Excel workbook (.xlsx) or a CSV file. The first row must be the column names. Nothing is saved until you have checked the rows, and a whole import can be undone afterwards.')}</p>
              <label className="btn big" style={{ cursor: 'pointer' }}><Upload size={18} /> {tr('Choose an Excel or CSV file')}<input type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
              <button className="ghost" onClick={template}><Download size={15} /> {tr('Download an empty template')}</button>
              {earlier.length > 0 && (
                <div>
                  <b className="small">{tr('Earlier imports')}</b>
                  <table className="data" style={{ marginTop: 6 }}>
                    <tbody>
                      {earlier.map((b) => {
                        const blockers = b.undoneAt ? [] : importStatus({ ws, schema: saved }, b.id).blockers
                        const mayUndo = !b.undoneAt && (b.by === user.id || isAdmin)
                        return (
                          <tr key={b.id} style={{ cursor: 'default' }}>
                            <td><b>{b.file || tr('a file')}</b><br /><span className="tiny muted">{new Date(b.at).toLocaleString(dateLocale())} · {who(b.by)}</span></td>
                            <td className="small">{tr('{a} added, {b} updated, {c} skipped', { a: b.created, b: b.updated, c: b.skipped })}</td>
                            <td style={{ textAlign: 'end' }}>
                              {b.undoneAt ? <span className="pill">{tr('Undone')}</span> : mayUndo && (
                                <button className="ghost small" disabled={blockers.length > 0} title={blockers.length ? blockers.slice(0, 5).map(msg).join('\n') : undefined} onClick={() => confirm(tr('Undo this import? Records it added are removed, and records it changed get their earlier values back.')) && act('import.undo', { batch: b.id }, tr('Import undone'))}>
                                  <RotateCcw size={14} /> {tr('Undo')}
                                </button>
                              )}
                              {mayUndo && blockers.length > 0 && <div className="tiny muted">{tr('Can’t be undone: {n} records changed or used since', { n: blockers.length })}</div>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {step === 'map' && (
            <>
              <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
                <p className="small" style={{ margin: 0 }}><b>{fileName}</b> · {tr('{n} rows found. Match each column to a field:', { n: objects.length })}</p>
                {sheets.length > 1 && (
                  <label className="small row" style={{ gap: 6 }}>{tr('Sheet')}
                    <select value={sheet} onChange={(e) => { setSheet(Number(e.target.value)); setPreview(null); setManual({}); autoMap((sheets[Number(e.target.value)].rows[0] ?? []).map((x, i) => x.trim() || tr('Column {n}', { n: i + 1 }))) }} style={{ width: 'auto' }}>
                      {sheets.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table className="data">
                  <thead><tr><th>{tr('Column in your file')}</th><th>{tr('Example')}</th><th>{tr('Goes into')}</th></tr></thead>
                  <tbody>
                    {header.map((h) => (
                      <tr key={h} style={{ cursor: 'default' }}>
                        <td><b>{h}</b></td>
                        <td className="muted">{objects.find((r) => r[h])?.[h] ?? ''}</td>
                        <td>
                          <select value={mapping[h] ?? ''} onChange={(e) => { setMapping({ ...mapping, [h]: e.target.value }); setPreview(null) }}>
                            <option value="">{tr('— skip —')}</option>
                            <optgroup label={tr('Fields')}>
                              {fields.map((f) => <option key={f.id} value={f.key} disabled={Object.entries(mapping).some(([c, k]) => k === f.key && c !== h)}>{shown(f)}</option>)}
                            </optgroup>
                            <optgroup label={tr('From the old system')}>
                              {targets.map((t) => <option key={t.key} value={t.key} disabled={Object.entries(mapping).some(([c, k]) => k === t.key && c !== h)}>{tr(t.label)}</option>)}
                            </optgroup>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {missing.length > 0 && <div className="note small">{tr('Required fields not matched: {fields}. Rows without them will be skipped.', { fields: missing.map(shown).join('، ') })}</div>}

              <div className="card" style={{ padding: 12 }}>
                <b className="small">{tr('Records already in Bonyan')}</b>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  <select value={match} onChange={(e) => { setMatch(e.target.value); setPreview(null) }} style={{ width: 'auto' }}>
                    <option value="">{tr('Always add new records')}</option>
                    {matchable.map((m) => <option key={m.key} value={m.key}>{tr('Update the record with the same {what}', { what: m.label })}</option>)}
                  </select>
                  {match && <label className="inline small"><input type="checkbox" checked={onlyUpdate} onChange={(e) => { setOnlyUpdate(e.target.checked); setPreview(null) }} /> {tr('Only update; don’t add new records')}</label>}
                </div>
                <p className="tiny muted" style={{ margin: '6px 0 0' }}>{tr('Choose a column such as the old system id, phone or e-mail, so importing the same people again updates them instead of adding them twice.')}</p>
              </div>

              {unmatched.length > 0 && (
                <div className="card" style={{ padding: 12 }}>
                  <b className="small">{tr('Values to match ({n})', { n: unmatched.length })}</b>
                  <p className="tiny muted" style={{ margin: '4px 0 8px' }}>{tr('These values in your file are not options here. Choose what each one means, or leave it empty.')}</p>
                  <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                    <table className="data">
                      <tbody>
                        {unmatched.slice(0, 200).map((v) => (
                          <tr key={v.column.key + v.key} style={{ cursor: 'default' }}>
                            <td className="small">{v.column.label}</td>
                            <td><b>{v.raw}</b> <span className="tiny muted">× {v.count}</span></td>
                            <td>
                              <select value="" onChange={(e) => { setManual({ ...manual, [v.column.key]: { ...manual[v.column.key], [v.key]: e.target.value === '\u0000' ? '' : e.target.value } }); setPreview(null) }}>
                                <option value="" disabled>{tr('Choose…')}</option>
                                {v.column.choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                                <option value={'\u0000'}>{tr('— leave empty —')}</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {preview && (
                <div className="stack">
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="pill">{tr('{n} new', { n: preview.created })}</span>
                    {preview.updated > 0 && <span className="pill">{tr('{n} updated', { n: preview.updated })}</span>}
                    {preview.skipped - preview.errors.length > 0 && <span className="pill">{tr('{n} not found, skipped', { n: preview.skipped - preview.errors.length })}</span>}
                    {preview.errors.length > 0 && <span className="pill" style={{ background: '#fee2e2', color: '#991b1b' }}>{tr('{n} with problems', { n: new Set(preview.errors.map((e) => e.row)).size })}</span>}
                  </div>
                  {preview.errors.length > 0 && errorList(preview.errors)}
                  {preview.rows.some((r) => r.similar) && (
                    <div className="note small">
                      <AlertTriangle size={14} /> {tr('{n} new rows look like records already in Bonyan (same name, phone or e-mail). To update those instead of adding them twice, choose a column under “Records already in Bonyan”.', { n: preview.rows.filter((r) => r.similar).length })}
                      <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
                        {preview.rows.filter((r) => r.similar).slice(0, 5).map((r) => <li key={r.row}>{tr('Row {n} looks like “{name}”', { n: r.row, name: recordTitle(ws, saved, findRecord(ws, r.similar)) })}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="secondary" onClick={() => { setSheets([]); setPreview(null) }}>{tr('Choose another file')}</button>
                <button className="secondary" onClick={check} disabled={checking}>{checking ? tr('Checking…') : tr('Check the rows')}</button>
                <button className="glow" onClick={send} disabled={!preview || preview.created + preview.updated === 0}><Upload size={16} /> {preview ? tr('Import {n} rows', { n: preview.created + preview.updated }) : tr('Check the rows first')}</button>
              </div>
            </>
          )}

          {step === 'sending' && progress && (
            <div className="stack">
              <p className="small" style={{ margin: 0 }}>{tr('Saving part {a} of {b}… Keep this window open.', { a: Math.min(progress.done + 1, progress.total), b: progress.total })}</p>
              <div className="meter"><i style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div>
            </div>
          )}

          {step === 'done' && result && (
            <>
              <div className="ok-box row"><CheckCircle2 size={18} /> {tr('{a} added and {b} updated.', { a: result.created, b: result.updated })}</div>
              {result.stopped && <div className="error-box">{tr('The import stopped before the end. The parts already saved are kept; you can undo them below.')}</div>}
              {result.errors.length > 0 && errorList(result.errors)}
              <div className="row">
                <button onClick={onClose}>{tr('Done')}</button>
                {(result.created > 0 || result.updated > 0) && (
                  <button className="ghost" onClick={() => confirm(tr('Undo this import? Records it added are removed, and records it changed get their earlier values back.')) && act('import.undo', { batch: result.batch }, tr('Import undone')) && onClose()}><RotateCcw size={15} /> {tr('Undo this import')}</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
