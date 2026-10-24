import { useState } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react'
import { useApp } from './useApp'
import { importRows, type ImportResult } from '../lib/engine'
import type { ModuleDef } from '../lib/schema'

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

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '')

export function ImportModal({ mod, onClose }: { mod: ModuleDef; onClose: () => void }) {
  const { act } = useApp()
  const [header, setHeader] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ImportResult | null>(null)
  const fields = mod.fields.filter((f) => !f.readOnly && !['formula', 'lookup', 'rollup'].includes(f.type))

  function load(file: File) {
    file.text().then((text) => {
      const all = parseCsv(text)
      const [h, ...body] = all
      setHeader(h ?? [])
      setRows(body)
      setResult(null)
      // Auto-match columns to fields by label or key.
      const m: Record<string, string> = {}
      for (const col of h ?? []) {
        const f = fields.find((x) => norm(x.label) === norm(col) || norm(x.key) === norm(col)) ?? fields.find((x) => norm(col).includes(norm(x.label)) || norm(x.label).includes(norm(col)))
        if (f && !Object.values(m).includes(f.key)) m[col] = f.key
      }
      setMapping(m)
    })
  }

  function template() {
    const csv = '﻿' + fields.map((f) => `"${f.label}"`).join(',') + '\n'
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${mod.name} – import template.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function run() {
    const objects = rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
    const res = act((ctx) => importRows(ctx, mod.id, objects, mapping))
    if (res) setResult(res)
  }

  const missing = mod.fields.filter((f) => f.required && !f.readOnly && !f.showIf && !Object.values(mapping).includes(f.key))
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="card stack" style={{ width: 'min(760px, 100%)' }}>
          <div className="row between"><h2 style={{ margin: 0 }}><FileSpreadsheet size={18} /> Import {mod.name.toLowerCase()}</h2><button className="ghost icon" onClick={onClose}><X size={18} /></button></div>
          {!header.length && (
            <>
              <p className="muted small" style={{ margin: 0 }}>Upload a CSV from Excel or Google Sheets (File → Save as → CSV). The first row must be the column names. Each row is checked like a normal save: good rows are imported, and problem rows are listed so you can fix them.</p>
              <label className="btn big" style={{ cursor: 'pointer' }}><Upload size={18} /> Choose CSV file<input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
              <button className="ghost" onClick={template}><Download size={15} /> Download an empty template</button>
            </>
          )}
          {header.length > 0 && !result && (
            <>
              <p className="small" style={{ margin: 0 }}><b>{rows.length}</b> rows found. Match each column to a field:</p>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="data">
                  <thead><tr><th>Column in your file</th><th>Example</th><th>Goes into</th></tr></thead>
                  <tbody>
                    {header.map((h, i) => (
                      <tr key={h + i} style={{ cursor: 'default' }}>
                        <td><b>{h}</b></td>
                        <td className="muted">{rows[0]?.[i] ?? ''}</td>
                        <td>
                          <select value={mapping[h] ?? ''} onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}>
                            <option value="">— skip —</option>
                            {fields.map((f) => <option key={f.id} value={f.key} disabled={Object.entries(mapping).some(([c, k]) => k === f.key && c !== h)}>{f.label}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {missing.length > 0 && <div className="note small">Required fields not matched: {missing.map((f) => f.label).join(', ')}. Rows without them will be skipped.</div>}
              <div className="row"><button className="secondary" onClick={() => setHeader([])}>Choose another file</button><button className="glow" onClick={run}><Upload size={16} /> Import {rows.length} rows</button></div>
            </>
          )}
          {result && (
            <>
              <div className="ok-box row"><CheckCircle2 size={18} /> {result.created} {mod.name.toLowerCase()} imported.</div>
              {result.errors.length > 0 && (
                <div className="error-box" style={{ maxHeight: 220, overflowY: 'auto' }}>
                  <b>{result.errors.length} rows skipped:</b>
                  <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>
                </div>
              )}
              <button onClick={onClose}>Done</button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
