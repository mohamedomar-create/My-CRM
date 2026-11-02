// Phase H5: past invoices, bills, credit notes and quotations from the old system, kept on the server as history (never
// in the books). Like the other imports: columns matched by name, checked here row by row, sent in parts, and a whole
// file can be taken out again.
import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, RotateCcw, Upload, X } from 'lucide-react'
import { useApp } from './useApp'
import { importKey } from '../lib/engine'
import type { AppSchema } from '../lib/schema'
import { moduleByRole, uid } from '../lib/schema'
import { historyAdd, historyBatches, historyUndo, type HistoryBatch } from '../lib/store'
import { buildHistoryDocs, HISTORY_COLUMNS, type HistoryDoc, type HistorySide } from '../lib/historyDocs'
import { readXlsx, type Sheet } from '../lib/xlsx'
import { dateLocale, msg, tr, translate } from '../lib/i18n'

const PART = 500
const norm = (s: string) => importKey(s).replace(/[^a-z0-9؀-ۿ]/g, '')

function matchColumns(header: string[]) {
  const m: Record<string, string> = {}
  for (const c of HISTORY_COLUMNS) {
    const names = [c.label, translate('ar', c.label), c.key, ...(c.aliases ?? [])].map(norm)
    const h = header.find((x) => names.includes(norm(x))) ?? header.find((x) => names.some((n) => n.length > 2 && norm(x).includes(n)))
    if (h && !Object.values(m).includes(h)) m[c.key] = h
  }
  return m
}

type Check = { docs: HistoryDoc[]; errors: { row: number; message: string; column?: string }[] }

export function HistoryImport({ side, preset, onClose }: { side: HistorySide; preset?: { fileName: string; sheet: Sheet }; onClose: () => void }) {
  const { ws, user } = useApp()
  const saved = ws.published as AppSchema
  const [file, setFile] = useState(preset?.fileName ?? '')
  const [table, setTable] = useState<string[][] | null>(preset?.sheet.rows ?? null)
  const [map, setMap] = useState<Record<string, string>>(() => (preset ? matchColumns(preset.sheet.rows[0] ?? []) : {}))
  const [preview, setPreview] = useState<Check | null>(null)
  const [problem, setProblem] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<{ batch: string; added: number; sent: number } | null>(null)
  const header = useMemo(() => table?.[0] ?? [], [table])
  const rows = useMemo(() => (table ?? []).slice(1).filter((r) => r.some((c) => c.trim())).map((r) => Object.fromEntries(HISTORY_COLUMNS.map((c) => [c.key, map[c.key] ? String(r[header.indexOf(map[c.key])] ?? '').trim() : '']))), [table, map, header])
  const missing = HISTORY_COLUMNS.filter((c) => c.required && !map[c.key])
  const party = moduleByRole(saved, side === 'sales' ? 'accounts' : 'suppliers')

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
      setPreview(buildHistoryDocs({ ws, schema: saved, user }, side, rows))
    } catch (e) {
      setProblem(msg((e as Error).message))
    }
  }
  async function send() {
    if (!preview) return
    const batch = uid('imp')
    const total = Math.ceil(preview.docs.length / PART)
    let added = 0
    setProblem('')
    setProgress({ done: 0, total })
    try {
      for (let p = 0; p < total; p++) {
        added += await historyAdd(ws.id, batch, file.slice(0, 120), preview.docs.slice(p * PART, (p + 1) * PART))
        setProgress({ done: p + 1, total })
      }
      setResult({ batch, added, sent: preview.docs.length })
    } catch (e) {
      setProblem(msg((e as Error).message))
      if (added) setResult({ batch, added, sent: preview.docs.length })
    }
    setProgress(null)
  }
  async function undo(batch: string) {
    if (!confirm(tr('Take out every document this file brought in?'))) return
    try {
      await historyUndo(ws.id, batch)
      onClose()
    } catch (e) {
      setProblem(msg((e as Error).message))
    }
  }
  const cellOf = (e: Check['errors'][number]) => (e.column && map[e.column] ? ` · ${map[e.column]}` : '')
  const lines = preview ? preview.docs.reduce((s, d) => s + d.lines.length, 0) : 0
  const title = side === 'sales' ? tr('Past sales invoices') : tr('Past purchase bills')

  return (
    <>
      <div className="overlay" onClick={progress ? undefined : onClose} />
      <div className="modal">
        <div className="card stack" style={{ width: 'min(820px, 100%)' }}>
          <div className="row between">
            <h2 style={{ margin: 0 }}>{title}</h2>
            {!progress && <button className="ghost icon" onClick={onClose} aria-label={tr('Close')}><X size={18} /></button>}
          </div>
          <p className="small muted" style={{ margin: 0 }}>{side === 'sales'
            ? tr('Your old sales invoices, credit notes and quotations, so each customer shows what they bought and your sales analysis covers past years. One row per document, or one row per line with the invoice number repeated. They are history only: the books, stock and VAT are not touched.')
            : tr('Your old purchase bills and debit notes, so each supplier shows what you bought and from whom. One row per document, or one row per line with the bill number repeated. They are history only: the books, stock and VAT are not touched.')}</p>
          {!party && <div className="error-box">{side === 'sales' ? tr('Every CRM needs a Customers module') : tr('Add a Suppliers module first')}</div>}
          {problem && <div className="error-box">{problem}</div>}
          {!table && party && <label className="btn big" style={{ cursor: 'pointer' }}><Upload size={18} /> {tr('Choose an Excel file')}<input type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>}
          {table && party && !result && !progress && (
            <>
              <p className="small" style={{ margin: 0 }}><b>{file}</b> · {tr('{n} rows found. Match each column to a field:', { n: rows.length })}</p>
              <div className="form-grid">
                {HISTORY_COLUMNS.map((c) => (
                  <label key={c.key} className="field small">{c.key === 'party' ? (side === 'sales' ? tr('Customer') : tr('Supplier')) : tr(c.label)}{c.required ? ' *' : ''}
                    <select value={map[c.key] ?? ''} onChange={(e) => { setMap({ ...map, [c.key]: e.target.value }); setPreview(null) }}>
                      <option value="">{tr('— skip —')}</option>
                      {header.map((h, i) => <option key={h + i} value={h}>{h}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              {preview && (
                <>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="pill">{tr('{n} documents', { n: preview.docs.length })}</span>
                    <span className="pill">{tr('{n} lines', { n: lines })}</span>
                    {preview.docs.some((d) => d.openDoc) && <span className="pill">{tr('{n} still owed: linked to their opening balance', { n: preview.docs.filter((d) => d.openDoc).length })}</span>}
                  </div>
                  {preview.errors.length > 0 && (
                    <div className="error-box" style={{ maxHeight: 200, overflowY: 'auto' }}>
                      <b>{tr('{n} rows have problems:', { n: preview.errors.length })}</b>
                      <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{preview.errors.slice(0, 100).map((e) => <li key={e.row}>{tr('Row {n}', { n: e.row })}{cellOf(e)}: {msg(e.message)}</li>)}</ul>
                    </div>
                  )}
                </>
              )}
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="secondary" onClick={check} disabled={missing.length > 0}>{missing.length ? tr('Match: {fields}', { fields: missing.map((c) => (c.key === 'party' ? (side === 'sales' ? tr('Customer') : tr('Supplier')) : tr(c.label))).join('، ') }) : tr('Check the rows')}</button>
                <button className="glow" onClick={() => void send()} disabled={!preview || preview.docs.length === 0}><Upload size={16} /> {preview ? tr('Bring in {n} documents', { n: preview.docs.length }) : tr('Check the rows first')}</button>
              </div>
            </>
          )}
          {progress && <div className="stack"><p className="small" style={{ margin: 0 }}>{tr('Saving part {a} of {b}… Keep this window open.', { a: Math.min(progress.done + 1, progress.total), b: progress.total })}</p><div className="meter"><i style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} /></div></div>}
          {result && (
            <>
              <div className="ok-box row"><CheckCircle2 size={18} /> {tr('{n} documents added.', { n: result.added })}{result.added < result.sent ? ` ${tr('{n} were already here.', { n: result.sent - result.added })}` : ''}</div>
              <div className="row">
                <button onClick={onClose}>{tr('Done')}</button>
                {result.added > 0 && <button className="ghost" onClick={() => void undo(result.batch)}><RotateCcw size={15} /> {tr('Undo this import')}</button>}
              </div>
            </>
          )}
          {!progress && !result && <EarlierBatches onUndo={undo} />}
        </div>
      </div>
    </>
  )
}

/** The files brought in before, each can be taken out again. */
function EarlierBatches({ onUndo }: { onUndo: (batch: string) => void }) {
  const { ws } = useApp()
  const [batches, setBatches] = useState<HistoryBatch[] | null>(null)
  useEffect(() => {
    let live = true
    historyBatches(ws.id).then((b) => live && setBatches(b), () => live && setBatches([]))
    return () => { live = false }
  }, [ws.id])
  if (!batches?.length) return null
  return (
    <div className="card" style={{ padding: 12 }}>
      <b className="small">{tr('Brought in before')}</b>
      <table className="data" style={{ marginTop: 6 }}>
        <tbody>
          {batches.map((b) => (
            <tr key={b.batch} style={{ cursor: 'default' }}>
              <td className="small"><b>{b.file || '—'}</b><br /><span className="tiny muted">{new Date(b.added_at).toLocaleDateString(dateLocale())} · {b.added_by}</span></td>
              <td className="small">{tr('{n} documents', { n: b.docs })} · {tr('{n} lines', { n: b.lines })}</td>
              <td style={{ textAlign: 'end' }}><button className="ghost small" onClick={() => onUndo(b.batch)}><RotateCcw size={14} /> {tr('Undo')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
