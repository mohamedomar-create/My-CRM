// An Excel report as a workbook: the sheet itself with a totals row of formulas (they follow the rows when someone
// filters or edits them in Excel), and a Charts sheet with each chart's figures and a native Excel chart beside them.
import type { AppSchema } from './schema'
import { chartTitle, sheetChartData, type SheetReportDef, type SheetResult, type TotalOp } from './sheets'
import { rangeA1, sheetName, writeXlsx, type SheetSpec, type XCell } from './xlsxWrite'

/** SUBTOTAL function numbers that skip rows hidden by a filter in Excel. */
const SUBTOTAL: Record<Exclude<TotalOp, 'none'>, number> = { sum: 109, avg: 101, max: 104, min: 105, count: 103 }
const COLORS = ['0B6E70', '6250D6', 'C2620A', '1D6B46', 'B42318', '2563EB']

export function sheetWorkbook(schema: AppSchema, sheet: SheetReportDef, result: SheetResult, opts: { rtl?: boolean; tr?: (s: string) => string } = {}): SheetSpec[] {
  const tr = opts.tr ?? ((s: string) => s)
  const taken = new Set<string>()
  const name = sheetName(sheet.name, taken)
  const rows: XCell[][] = [result.head, ...result.rows]
  const widths = result.head.map((h, i) => Math.min(48, Math.max(10, h.length + 2, ...result.rows.slice(0, 300).map((r) => String(r[i] ?? '').length + 2))))
  const boldRows: number[] = []
  const hasTotals = result.totals.some((t) => t !== '') && result.rows.length > 0
  if (hasTotals) {
    const last = result.rows.length // 0-based index of the last data row
    const total: XCell[] = result.totalOps.map((op, i) => (op === 'none' || result.totals[i] === '' ? '' : { f: `SUBTOTAL(${SUBTOTAL[op]},${rangeA1(i, 1, last)})`, v: Number(result.totals[i]) }))
    const free = total.findIndex((v) => v === '')
    if (free >= 0) total[free] = tr('Total')
    rows.push(total)
    boldRows.push(rows.length - 1)
  }
  const out: SheetSpec[] = [{ name, rows, widths, header: true, rtl: opts.rtl, boldRows }]

  // The charts: each one's figures in two columns, the chart drawn beside them.
  const charts = (sheet.charts ?? []).map((ch) => ({ ch, pts: sheetChartData(sheet, result, ch, tr('Other')) })).filter((x) => x.pts.length > 0)
  if (charts.length) {
    const crows: XCell[][] = []
    const specs: NonNullable<SheetSpec['charts']> = []
    const by = (id: string) => result.head[sheet.columns.findIndex((c) => c.id === id)] ?? ''
    charts.forEach(({ ch, pts }, k) => {
      const top = crows.length
      const title = chartTitle(schema, sheet, ch, tr)
      crows.push([title])
      crows.push([by(ch.by), ch.op === 'count' ? tr('Number of rows') : by(ch.value ?? '')])
      for (const p of pts) crows.push([p.label, p.value])
      specs.push({ type: ch.type, title, catCol: 0, valCol: 1, firstRow: top + 2, lastRow: top + 1 + pts.length, at: { col: 3, row: top, cols: 9, rows: 18 }, color: COLORS[k % COLORS.length] })
      while (crows.length < top + 20) crows.push([])
    })
    out.push({ name: sheetName(tr('Charts'), taken), rows: crows, widths: [28, 16], rtl: opts.rtl, charts: specs })
  }
  return out
}

/** Saves the report as an Excel file in the browser. */
export function downloadSheet(schema: AppSchema, sheet: SheetReportDef, result: SheetResult, opts: { rtl?: boolean; tr?: (s: string) => string } = {}) {
  const data = writeXlsx(sheetWorkbook(schema, sheet, result, opts))
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${(sheet.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'report').slice(0, 80)}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
