// Saves a sheet report as an Excel file in the browser.
import type { SheetResult } from './sheets'
import { sheetName, writeXlsx } from './xlsxWrite'

/** Saves the sheet as an Excel file (numbers stay numbers, so Excel can add them up). */
export function downloadSheet(name: string, result: SheetResult, rtl: boolean) {
  const rows = [result.head, ...result.rows]
  const widths = result.head.map((h, i) => Math.min(48, Math.max(10, h.length + 2, ...result.rows.slice(0, 300).map((r) => String(r[i] ?? '').length + 2))))
  const data = writeXlsx([{ name: sheetName(name, new Set()), rows, header: true, rtl, widths }])
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${(name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'report').slice(0, 80)}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
