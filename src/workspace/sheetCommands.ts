// Starting, saving and deleting Excel reports from the screens (the Excel reports page and Customise system).
import { moduleById, uid, type AppSchema } from '../lib/schema'
import { starterSheet, type SheetReportDef } from '../lib/sheets'
import { run } from '../lib/store'
import { showToast } from './useApp'

/** A new report: the example (invoices, one row per product sold, with charts) or an empty one. */
export function newSheet(schema: AppSchema, example: boolean, tr: (s: string, v?: Record<string, string | number>) => string): SheetReportDef {
  if (!example) return { id: uid('sheet'), name: tr('New Excel report'), module: (schema.modules.find((m) => m.role === 'invoices') ?? schema.modules[0]).id, columns: [], filters: [] }
  const s = starterSheet(schema)
  const m = moduleById(schema, s.module)
  if (m) s.name = s.perLine ? tr('{a}: one row per product sold', { a: m.name }) : m.name
  return s
}

/** Runs a report command, showing what happened; false when it was refused. */
export function saveSheetCommand(sheet: SheetReportDef, tr: (s: string) => string): boolean {
  try {
    const out = run('sheet.save', { sheet }, 'Excel report') as { live?: boolean } | undefined
    showToast({ kind: 'ok', text: out && out.live === false ? tr('Report saved: it goes live with the next publish, as it uses fields not published yet') : tr('Report saved: everyone who may open it sees it now') })
    return true
  } catch (e) {
    showToast({ kind: 'error', text: (e as Error).message })
    return false
  }
}
export function removeSheetCommand(id: string, tr: (s: string) => string) {
  try {
    run('sheet.remove', { id }, 'Excel report')
    showToast({ kind: 'ok', text: tr('Report deleted') })
  } catch (e) {
    showToast({ kind: 'error', text: (e as Error).message })
  }
}
