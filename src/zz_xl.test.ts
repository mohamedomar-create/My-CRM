// @ts-nocheck
import { it } from 'vitest'
import { writeFileSync } from 'fs'
import { templateById } from './lib/templates'
import { emptyAnswers, generateSchema } from './lib/recommend'
import { seedSampleData } from './lib/seed'
import { emptyData } from './lib/types'
import { starterSheet, runSheet } from './lib/sheets'
import { sheetWorkbook } from './lib/sheetDownload'
import { writeXlsx } from './lib/xlsxWrite'
it('x', () => {
  const admin = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }
  const schema = generateSchema(templateById('distribution'), { ...emptyAnswers('Co'), taxId: '1' })
  const ws = { id: 'ws', createdAt: '', answers: emptyAnswers('Co'), users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  seedSampleData(ws, schema, admin)
  const s = starterSheet(schema)
  s.name = 'Sales by product'
  const r = runSheet(ws, schema, admin, s)
  writeFileSync('/tmp/claude-0/-home-user-My-CRM/a1eb219c-d48c-5ff8-82ce-1f15a380901d/scratchpad/xl/report.xlsx', writeXlsx(sheetWorkbook(schema, s, r)))
})
