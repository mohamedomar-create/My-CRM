// Invoices and bills still to be worked on, from Excel into the books: columns matched by name, every row checked here
// on a copy of the company (the same code the server runs), then all saved at once or none. Posted at once if asked.
import { useMemo, useState } from 'react'
import { Modal } from '../components/Dialog'
import { CheckCircle2, Upload, X } from 'lucide-react'
import { useApp } from './useApp'
import { importKey, money, RowsError } from '../lib/engine'
import type { AppSchema } from '../lib/schema'
import { importLiveDocs, LIVE_COLUMNS, type LiveResult, type LiveSide } from '../lib/liveDocs'
import { readXlsx } from '../lib/xlsx'
import { parseCsv } from './ImportModal'
import { msg, tr, translate } from '../lib/i18n'

const norm = (s: string) => importKey(s).replace(/[^a-z0-9؀-ۿ]/g, '')

function matchColumns(header: string[]) {
  const m: Record<string, string> = {}
  for (const c of LIVE_COLUMNS) {
    const names = [c.label, translate('ar', c.label), c.key, ...(c.aliases ?? [])].map(norm)
    const h = header.find((x) => names.includes(norm(x))) ?? header.find((x) => names.some((n) => n.length > 2 && norm(x).includes(n)))
    if (h && !Object.values(m).includes(h)) m[c.key] = h
  }
  return m
}

export function LiveDocsImport({ side, onClose, preset, onDone }: { side: LiveSide; onClose: () => void; preset?: { fileName: string; rows: string[][] }; onDone?: (r: LiveResult) => void }) {
  const { ws, user, act } = useApp()
  const saved = ws.published as AppSchema
  const [file, setFile] = useState(preset?.fileName ?? '')
  const [table, setTable] = useState<string[][] | null>(preset && preset.rows.length > 1 ? preset.rows : null)
  const [map, setMap] = useState<Record<string, string>>(() => (preset ? matchColumns(preset.rows[0] ?? []) : {}))
  const [post, setPost] = useState(true)
  const [check, setCheck] = useState<{ ok?: LiveResult; errors?: { row: number; message: string }[] } | null>(null)
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState<LiveResult | null>(null)
  const header = useMemo(() => table?.[0] ?? [], [table])
  const rows = useMemo(() => (table ?? []).slice(1).filter((r) => r.some((c) => String(c).trim())).map((r) => Object.fromEntries(LIVE_COLUMNS.map((c) => [c.key, map[c.key] ? String(r[header.indexOf(map[c.key])] ?? '').trim() : '']))), [table, map, header])
  const missing = LIVE_COLUMNS.filter((c) => c.required && !map[c.key])
  const cur = saved.company.currency

  async function load(f: File) {
    setProblem('')
    try {
      const t = /\.csv$/i.test(f.name) ? parseCsv(await f.text()) : (await readXlsx(await f.arrayBuffer()))[0]?.rows ?? []
      if (t.length < 2) throw new Error(tr('This file has no rows'))
      setFile(f.name)
      setTable(t)
      setMap(matchColumns(t[0]))
      setCheck(null)
    } catch (e) {
      setProblem(msg((e as Error).message))
    }
  }
  /** The same code the server runs, on a copy: nothing is kept here. */
  function test() {
    setProblem('')
    try {
      const copy = structuredClone(ws)
      setCheck({ ok: importLiveDocs({ ws: copy, schema: copy.published!, user }, side, rows, { post }) })
    } catch (e) {
      if (e instanceof RowsError) setCheck({ errors: e.rows })
      else setProblem(msg((e as Error).message))
    }
  }
  function send() {
    const out = act<LiveResult>('docs.importLive', { side, rows, post }, undefined, side === 'sales' ? 'Imported invoices' : 'Imported bills')
    if (out) { setDone(out); onDone?.(out) }
  }
  const label = (c: (typeof LIVE_COLUMNS)[number]) => (c.key === 'party' ? (side === 'sales' ? tr('Customer') : tr('Supplier')) : tr(c.label))
  return (
    <Modal onClose={onClose}>
      <div className="card stack" style={{ width: 'min(860px, 100%)' }}>
        <div className="row between">
          <h2 style={{ margin: 0 }}>{side === 'sales' ? tr('Invoices to work on, into the books') : tr('Bills to work on, into the books')}</h2>
          <button className="ghost icon" onClick={onClose} aria-label={tr('Close')}><X size={18} /></button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>{tr('One row per line, with the document’s old number repeated on each of its lines. Each becomes a real document: posted, it moves the customer’s or supplier’s balance, stock and VAT, as if typed in. Every row is checked first, and nothing is saved unless all are right.')}</p>
        {problem && <div className="error-box">{problem}</div>}
        {!table && <label className="btn big" style={{ cursor: 'pointer' }}><Upload size={18} /> {tr('Choose an Excel or CSV file')}<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>}
        {table && !done && (
          <>
            <p className="small" style={{ margin: 0 }}><b>{file}</b> · {tr('{n} rows found. Match each column to a field:', { n: rows.length })}</p>
            <div className="form-grid">
              {LIVE_COLUMNS.map((c) => (
                <label key={c.key} className="field small">{label(c)}{c.required ? ' *' : ''}
                  <select value={map[c.key] ?? ''} onChange={(e) => { setMap({ ...map, [c.key]: e.target.value }); setCheck(null) }}>
                    <option value="">{tr('— skip —')}</option>
                    {header.map((h, i) => <option key={h + i} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={post} onChange={(e) => { setPost(e.target.checked); setCheck(null) }} /> {tr('Post them at once (otherwise they come in as drafts to check first)')}</label>
            {check?.errors && (
              <div className="error-box" style={{ maxHeight: 220, overflowY: 'auto' }}>
                <b>{tr('{n} rows have problems:', { n: check.errors.length })}</b> {tr('Nothing is saved until every row is right.')}
                <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{check.errors.slice(0, 100).map((e, i) => <li key={i}>{tr('Row {n}', { n: e.row })}: {msg(e.message)}</li>)}</ul>
              </div>
            )}
            {check?.ok && (
              <div className="ok-box stack" style={{ gap: 4 }}>
                <b>{tr('Every row is right: {d} documents, {l} lines', { d: check.ok.documents, l: check.ok.lines })}</b>
                <span>{tr('Before VAT {a} · VAT {b} · total {c}. Compare with the file’s totals before importing.', { a: money(check.ok.subtotal, cur), b: money(check.ok.tax, cur), c: money(check.ok.total, cur) })}</span>
              </div>
            )}
            <div className="row">
              <button className="secondary" onClick={() => { setTable(null); setCheck(null) }}>{tr('Choose another file')}</button>
              <button className="secondary" disabled={missing.length > 0} onClick={test}>{tr('Check the rows')}</button>
              <button className="glow" disabled={!check?.ok} onClick={send}><Upload size={16} /> {check?.ok ? tr('Import {n} documents', { n: check.ok.documents }) : tr('Check the rows first')}</button>
            </div>
            {missing.length > 0 && <span className="small muted">{tr('Match: {cols}', { cols: missing.map(label).join(', ') })}</span>}
          </>
        )}
        {done && (
          <>
            <div className="ok-box row"><CheckCircle2 size={18} /> {done.posted ? tr('{n} documents brought in and posted.', { n: done.documents }) : tr('{n} documents brought in as drafts.', { n: done.documents })}</div>
            <span className="small">{tr('Before VAT {a} · VAT {b} · total {c}.', { a: money(done.subtotal, cur), b: money(done.tax, cur), c: money(done.total, cur) })}</span>
            <div><button onClick={onClose}>{tr('Done')}</button></div>
          </>
        )}
      </div>
    </Modal>
  )
}
