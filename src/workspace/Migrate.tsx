// Phase H3: "Bring your data in". One workbook made from the company's own system, filled in Excel, uploaded once:
// each step then opens with its sheet, in an order where every list comes after the lists it links to, and the
// opening books follow. A summary shows how far the company is.
import { useState } from 'react'
import { CheckCircle2, Circle, Download, FileSpreadsheet, Lock, Upload } from 'lucide-react'
import { useApp } from './useApp'
import { ImportModal } from './ImportModal'
import { ActivityImport } from './ActivityImport'
import GoLive, { type SheetPreset } from './GoLive'
import { HistoryImport } from './HistoryImport'
import { can, canPost, list, money, openingStatus } from '../lib/engine'
import { findStepSheet, migrationSteps, migrationWorkbook, stepSheetName, type MigrationStep } from '../lib/migration'
import type { AppSchema } from '../lib/schema'
import { readXlsx, type Sheet } from '../lib/xlsx'
import { writeXlsx } from '../lib/xlsxWrite'
import { dateLocale, getLang, msg, tr, translate } from '../lib/i18n'

export default function Migrate() {
  const { ws, schema, user } = useApp()
  const saved = ws.published as AppSchema
  const lang = getLang()
  const finance = canPost({ schema: saved, user })
  const steps = migrationSteps(schema)
  const modules = steps.filter((s): s is Extract<MigrationStep, { kind: 'module' }> => s.kind === 'module')
  const [book, setBook] = useState<{ file: string; sheets: Sheet[] } | null>(null)
  const [problem, setProblem] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const o = ws.books?.opening
  const st = openingStatus(ws, saved, lang)
  const quarterStart = o ? ['01', '04', '07', '10'].includes(o.goLive.slice(5, 7)) && o.goLive.endsWith('-01') : false

  function download() {
    const sheets = migrationWorkbook(schema, { t: (en) => tr(en), rtl: lang === 'ar', users: ws.users, books: finance, quarterStart })
    const url = URL.createObjectURL(new Blob([writeXlsx(sheets) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${saved.company.name || 'Bonyan'} – ${tr('migration workbook')}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function upload(f: File) {
    setProblem('')
    try {
      if (!/\.xlsx$/i.test(f.name)) throw new Error(tr('Upload the workbook as an Excel file (.xlsx)'))
      setBook({ file: f.name, sheets: await readXlsx(await f.arrayBuffer()) })
    } catch (e) {
      setProblem(msg((e as Error).message))
    }
  }

  /** The workbook's sheet for a step, by its name in this language, in the other, or the module's saved name. */
  const sheetOf = (step: MigrationStep) => {
    if (!book) return undefined
    const raw = step.kind === 'module' ? saved.modules.find((m) => m.id === step.id)?.name ?? step.module.name : undefined
    const names = [stepSheetName(step, (en) => tr(en)), stepSheetName(step, (en) => en), stepSheetName(step, (en) => translate('ar', en)), ...(raw ? [raw, translate('ar', raw)] : [])]
    const sh = findStepSheet(book.sheets, names)
    return sh && sh.rows.filter((r) => r.some((c) => c.trim())).length > 1 ? sh : undefined
  }
  const rowsIn = (sh?: Sheet) => (sh ? sh.rows.slice(1).filter((r) => r.some((c) => c.trim())).length : 0)
  const presets: Record<string, SheetPreset> = {}
  for (const s of steps) {
    const sh = s.kind === 'books' ? sheetOf(s) : undefined
    if (sh) presets[s.id] = { file: `${book!.file} · ${sh.name}`, rows: sh.rows }
  }

  const imported = (id: string) => (ws.data.imports ?? []).filter((b) => b.module === id && !b.undoneAt)
  const doneModules = modules.filter((s) => list(ws, s.id).length > 0).length
  const opening = steps.filter((s) => s.kind === 'books' && Boolean(o?.steps[s.id])).length
  const current = modules.find((s) => s.id === open)
  const history = steps.filter((s): s is Extract<MigrationStep, { kind: 'history' }> => s.kind === 'history')
  const currentHistory = history.find((s) => s.id === open)

  return (
    <div className="page stack">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0 }}><FileSpreadsheet size={22} /> {tr('Bring your data in')}</h1>
      </div>

      <div className="card stack">
        <p className="small" style={{ margin: 0 }}>{tr('Bring what your old system holds into Bonyan: customers and the people there, suppliers, products, leads and deals, then the opening books. Download a workbook made for your system, fill a sheet per step (copy from your old system’s exports), and upload it here. Each step opens with its sheet; you check the rows and save. Nothing is final until you go live, and each import can be undone.')}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="secondary" onClick={download}><Download size={16} /> {tr('Download your workbook')}</button>
          <label className="btn glow" style={{ cursor: 'pointer' }}><Upload size={16} /> {book ? tr('Upload it again') : tr('Upload the filled workbook')}<input type="file" accept=".xlsx" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
          {book && <span className="small muted">{tr('{file}: {n} sheets with rows', { file: book.file, n: steps.filter((s) => sheetOf(s)).length })}</span>}
        </div>
        {problem && <div className="error-box">{problem}</div>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="pill">{tr('Lists with data: {a} of {b}', { a: doneModules, b: modules.length })}</span>
          {finance && <span className="pill">{tr('Opening books steps done: {a}', { a: opening })}</span>}
          {st && <span className="pill" style={st.equity === 0 && st.hasTb ? { background: '#dcfce7', color: '#166534' } : undefined}>{tr('Opening balance equity (3900): {amount}', { amount: money(st.equity, saved.company.currency) })}</span>}
          {o?.done && <span className="pill" style={{ background: '#dcfce7', color: '#166534' }}><Lock size={12} /> {tr('Live since {date}', { date: o.goLive })}</span>}
        </div>
      </div>

      <div className="card stack">
        <h2 style={{ margin: 0 }}>{tr('1. Your lists, in this order')}</h2>
        <p className="small muted" style={{ margin: 0 }}>{tr('Each list comes after the ones it links to, so a contact finds its company and a deal its customer. Use the old system id in links when names repeat.')}</p>
        <table className="data">
          <tbody>
            {modules.map((s, i) => {
              const sh = sheetOf(s)
              const batches = imported(s.id)
              const count = list(ws, s.id).length
              const allowed = can({ schema: saved, user }, s.id, 'create')
              return (
                <tr key={s.id} style={{ cursor: 'default' }}>
                  <td style={{ width: 28 }}>{count ? <CheckCircle2 size={18} color="#10b981" /> : <Circle size={18} color="#94a3b8" />}</td>
                  <td><b>{i + 1}. {s.module.name}</b><br /><span className="tiny muted">{count ? tr('{n} records', { n: count }) : tr('Nothing yet')}{batches.length ? ` · ${tr('last import {date}', { date: new Date(batches[0].at).toLocaleDateString(dateLocale()) })}` : ''}</span></td>
                  <td className="small">{sh ? tr('{n} rows in your workbook', { n: rowsIn(sh) }) : book ? <span className="muted">{tr('No rows in the workbook')}</span> : ''}</td>
                  <td style={{ textAlign: 'end' }}>{allowed && <button className={sh ? 'glow small' : 'ghost small'} onClick={() => setOpen(s.id)}><Upload size={14} /> {sh ? tr('Import these rows') : tr('Import')}</button>}</td>
                </tr>
              )
            })}
            {(() => {
              const step = steps.find((s) => s.kind === 'activities')!
              const sh = sheetOf(step)
              const count = (ws.data.comments ?? []).filter((c) => c.batch).length
              return (
                <tr style={{ cursor: 'default' }}>
                  <td style={{ width: 28 }}>{count ? <CheckCircle2 size={18} color="#10b981" /> : <Circle size={18} color="#94a3b8" />}</td>
                  <td><b>{modules.length + 1}. {tr('Calls, visits and notes')}</b><br /><span className="tiny muted">{count ? tr('{n} brought in', { n: count }) : tr('Nothing yet')}</span></td>
                  <td className="small">{sh ? tr('{n} rows in your workbook', { n: rowsIn(sh) }) : book ? <span className="muted">{tr('No rows in the workbook')}</span> : ''}</td>
                  <td style={{ textAlign: 'end' }}><button className={sh ? 'glow small' : 'ghost small'} onClick={() => setOpen('activities')}><Upload size={14} /> {sh ? tr('Import these rows') : tr('Import')}</button></td>
                </tr>
              )
            })()}
          </tbody>
        </table>
      </div>

      {finance && (
        <div className="stack">
          <h2 style={{ margin: '8px 0 0' }}>{tr('2. Your opening books')}</h2>
          <GoLive presets={presets} />
        </div>
      )}

      {finance && history.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{tr('3. Past invoices and bills')}</h2>
          <p className="small muted" style={{ margin: 0 }}>{tr('The invoices, credit notes and bills of earlier years, so each customer and supplier shows what they bought and the sales analysis covers past years. They are kept as history: the books, stock and VAT are not touched. Bring them in after the opening books, so an invoice still owed is linked to its opening balance.')}</p>
          <table className="data">
            <tbody>
              {history.map((s) => {
                const sh = sheetOf(s)
                return (
                  <tr key={s.id} style={{ cursor: 'default' }}>
                    <td><b>{stepSheetName(s, (en) => tr(en))}</b></td>
                    <td className="small">{sh ? tr('{n} rows in your workbook', { n: rowsIn(sh) }) : book ? <span className="muted">{tr('No rows in the workbook')}</span> : ''}</td>
                    <td style={{ textAlign: 'end' }}><button className={sh ? 'glow small' : 'ghost small'} onClick={() => setOpen(s.id)}><Upload size={14} /> {sh ? tr('Import these rows') : tr('Import')}</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {currentHistory && (() => {
        const sh = sheetOf(currentHistory)
        return <HistoryImport key={currentHistory.id + (book?.file ?? '')} side={currentHistory.side} preset={sh && book ? { fileName: `${book.file} · ${sh.name}`, sheet: sh } : undefined} onClose={() => setOpen(null)} />
      })()}
      {open === 'activities' && (() => {
        const sh = sheetOf(steps.find((s) => s.kind === 'activities')!)
        return <ActivityImport key={book?.file ?? ''} preset={sh && book ? { fileName: `${book.file} · ${sh.name}`, sheet: sh } : undefined} onClose={() => setOpen(null)} />
      })()}
      {current && <ImportModal key={current.id + (book?.file ?? '')} mod={current.module} preset={sheetOf(current) && book ? { fileName: `${book.file} · ${sheetOf(current)!.name}`, sheet: sheetOf(current)! } : undefined} onClose={() => setOpen(null)} />}
    </div>
  )
}
