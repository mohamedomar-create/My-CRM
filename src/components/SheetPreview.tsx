// The table of a sheet report as it will look in Excel: the column titles, the rows (the first few hundred), sorted by
// any column, and the download of the whole sheet.
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Download } from 'lucide-react'
import type { SheetResult } from '../lib/sheets'
import { downloadSheet } from '../lib/sheetDownload'
import { useLang } from '../lib/i18n'

const SHOWN = 200

export function SheetPreview({ name, result, sample }: { name: string; result: SheetResult; sample?: boolean }) {
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

  return (
    <div className="sheet-preview">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="small muted">
          {tr('{a} rows', { a: result.rows.length.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US') })}
          {result.rows.length > SHOWN && ` · ${tr('showing the first {a}; the Excel file has them all', { a: SHOWN })}`}
          {sample && <> · <span className="pill amber tiny">{tr('sample data preview')}</span></>}
        </span>
        <button className="primary" disabled={!result.head.length} onClick={() => downloadSheet(name, { ...result, rows }, lang === 'ar')}><Download size={15} /> {tr('Download Excel')}</button>
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
                  {r.map((v, j) => <td key={j} className={typeof v === 'number' ? 'num' : ''}>{typeof v === 'number' ? v.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US', { maximumFractionDigits: 2 }) : v}</td>)}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={result.head.length + 1} className="muted small" style={{ textAlign: 'center', padding: 18 }}>{tr('No rows match yet.')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
