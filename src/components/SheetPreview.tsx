// An Excel report as it will look: its charts, then the table (the first few hundred rows) with a totals row, sorted by
// any column, and the download of the whole workbook (the sheet, its totals as formulas and its charts).
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Download } from 'lucide-react'
import { Chart } from './Chart'
import type { AppSchema } from '../lib/schema'
import { chartTitle, sheetChartData, sheetTotals, TOTAL_LABEL, type SheetReportDef, type SheetResult } from '../lib/sheets'
import { downloadSheet } from '../lib/sheetDownload'
import { seriesColor } from '../lib/palette'
import { useLang } from '../lib/i18n'

const SHOWN = 200

/** The report's charts, drawn from the rows shown. */
export function SheetCharts({ schema, sheet, result }: { schema: AppSchema; sheet: SheetReportDef; result: SheetResult }) {
  const { tr } = useLang()
  const charts = sheet.charts ?? []
  if (!charts.length || !result.rows.length) return null
  return (
    <div className="sheet-charts">
      {charts.map((ch, k) => {
        const pts = sheetChartData(sheet, result, ch, tr('Other'))
        const res = { rows: pts.map((p, i) => ({ key: p.label, label: p.label, value: p.value, color: seriesColor(i) })), total: pts.reduce((s, p) => s + p.value, 0), count: result.rows.length }
        return (
          <div key={ch.id} className="card sheet-chart">
            <h3>{chartTitle(schema, sheet, ch, tr)}</h3>
            {pts.length ? <Chart type={ch.type} result={res} color={seriesColor(k)} height={200} whole={ch.op === 'count'} /> : <span className="tiny muted">{tr('No rows match yet.')}</span>}
          </div>
        )
      })}
    </div>
  )
}

export function SheetPreview({ schema, sheet, result, sample }: { schema: AppSchema; sheet: SheetReportDef; result: SheetResult; sample?: boolean }) {
  const { tr, lang } = useLang()
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null)
  const rows = useMemo(() => {
    if (!sort) return result.rows
    const { col, dir } = sort
    return [...result.rows].sort((a, b) => {
      const x = a[col], y = b[col]
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir
      return String(x ?? '').localeCompare(String(y ?? ''), lang) * dir
    })
  }, [result.rows, sort, lang])
  const hidden = result.head.filter((_, i) => result.hidden[i])
  const toggle = (col: number) => setSort((s) => (s?.col === col ? (s.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 }))
  const num = (v: number) => v.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 })
  const totals = sheetTotals(result.rows, result.totalOps, result.hidden)
  const hasTotals = totals.some((t) => t !== '') && result.rows.length > 0
  const firstFree = totals.findIndex((t) => t === '')

  return (
    <div className="sheet-preview">
      <SheetCharts schema={schema} sheet={sheet} result={result} />
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="small muted">
          {tr('{a} rows', { a: num(result.rows.length) })}
          {result.rows.length > SHOWN && ` · ${tr('showing the first {a}; the Excel file has them all', { a: SHOWN })}`}
          {sample && <> · <span className="pill amber tiny">{tr('sample data preview')}</span></>}
        </span>
        <button className="primary" disabled={!result.head.length} onClick={() => downloadSheet(schema, sheet, { ...result, rows }, { rtl: lang === 'ar', tr })}><Download size={15} /> {tr('Download Excel')}</button>
      </div>
      {hidden.length > 0 && <div className="note small">{tr('Your role can’t open the list behind these columns, so they are left empty: {a}', { a: hidden.join('، ') })}</div>}
      {result.head.length === 0 ? (
        <div className="empty">{tr('Add a column to see the sheet.')}</div>
      ) : (
        <div className="sheet-scroll">
          <table className="sheet-table">
            <thead>
              <tr>
                <th className="rn">#</th>
                {result.head.map((h, i) => (
                  <th key={i} className={result.hidden[i] ? 'off' : ''}>
                    <button className="sheet-sort" onClick={() => toggle(i)} aria-label={tr('Sort by {a}', { a: h })}>
                      {h} {sort?.col === i && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, SHOWN).map((r, i) => (
                <tr key={i}>
                  <td className="rn">{i + 1}</td>
                  {r.map((v, j) => <td key={j} className={typeof v === 'number' ? 'num' : ''}>{typeof v === 'number' ? num(v) : v}</td>)}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={result.head.length + 1} className="muted small" style={{ textAlign: 'center', padding: 18 }}>{tr('No rows match yet.')}</td></tr>}
            </tbody>
            {hasTotals && (
              <tfoot>
                <tr>
                  <td className="rn">Σ</td>
                  {totals.map((t, i) => (
                    <td key={i} className={typeof t === 'number' ? 'num' : ''}>
                      {t === '' ? (i === firstFree ? <b>{tr('Total')}</b> : '') : <><span className="tiny muted">{tr(TOTAL_LABEL[result.totalOps[i]])} </span><b>{num(Number(t))}</b></>}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
