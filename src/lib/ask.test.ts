// "Ask Nasq360": what is asked and for when, in English and in Egyptian or standard Arabic, and the answers from the
// books: this month against last, who owes us, best sellers, cash, profit; unknown questions are left to the AI with
// the company's figures only (no names of people).
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, manualJournal, postDocument, registerPayment, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { answer, factsForAi, intentOf, normalize, periodOf } from './ask'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

describe('understanding the question', () => {
  it('knows what is asked, in English and Arabic written any way', () => {
    expect(normalize('أرباح الشهر ده')).toBe('ارباح الشهر ده')
    const cases: [string, string | undefined][] = [
      ['How did we do this month vs last month?', 'compare'], ['مقارنة الشهر ده بالشهر اللي فات', 'compare'],
      ['Who owes us the most?', 'owed'], ['مين عليه فلوس لينا؟', 'owed'], ['المديونيات', 'owed'],
      ['What do we owe suppliers?', 'weOwe'], ['كام علينا للموردين', 'weOwe'],
      ['How much cash do we have?', 'cash'], ['الكاش كام؟', 'cash'], ['السيولة', 'cash'],
      ['Will we run out of cash?', 'forecast'], ['توقعات الأسابيع الجاية', 'forecast'],
      ['Best sellers this month', 'bestSellers'], ['إيه الأكثر مبيعاً؟', 'bestSellers'],
      ['Top customers this year', 'topCustomers'], ['أكبر العملاء', 'topCustomers'],
      ['Sales yesterday', 'sales'], ['بعنا كام النهارده؟', 'sales'],
      ['Profit this year', 'profit'], ['كسبنا كام؟', 'profit'],
      ['Expenses last month', 'expenses'], ['المصاريف', 'expenses'],
      ['What is running low?', 'lowStock'], ['النواقص', 'lowStock'],
      ['What should I watch?', 'watch'], ['في مشاكل؟', 'watch'],
      ['Tell me a joke', undefined],
    ]
    for (const [q, want] of cases) expect([q, intentOf(q)]).toEqual([q, want])
  })

  it('knows for when', () => {
    const t = '2026-11-04'
    expect(periodOf('sales today', t)).toMatchObject({ key: 'today', from: t, to: t })
    expect(periodOf('مبيعات امبارح', t)).toMatchObject({ key: 'yesterday', from: '2026-11-03' })
    expect(periodOf('expenses last month', t)).toMatchObject({ key: 'lastMonth', from: '2026-10-01', to: '2026-10-31' })
    expect(periodOf('ارباح الشهر اللي فات', t)).toMatchObject({ key: 'lastMonth' })
    expect(periodOf('profit this year', t)).toMatchObject({ key: 'year', from: '2026-01-01', to: t })
    expect(periodOf('السنة اللي فاتت', t)).toMatchObject({ key: 'lastYear', from: '2025-01-01', to: '2025-12-31' })
    expect(periodOf('best sellers', t)).toMatchObject({ key: 'month', from: '2026-11-01', to: t })
  })
})

describe('answering from the books', () => {
  it('answers this month against last, who owes us, best sellers and cash; the AI gets figures only', () => {
    const answers = { ...emptyAnswers('Co'), taxId: '1' }
    const schema = generateSchema(templateById('distribution'), answers)
    const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
    const at = (today: string): Ctx => ({ ws, schema, user: admin, today })
    const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
    manualJournal(at('2026-01-01'), { date: '2026-01-01', memo: 'Capital', lines: [{ account: '1110', debit: 50000, credit: 0 }, { account: '3000', debit: 0, credit: 50000 }] })
    const svc = createRecord(at('2026-01-01'), mod('products'), { name: 'Consulting day', sku: 'CD', price: 1000, vat_rate: 0, track_stock: false })
    const C = createRecord(at('2026-01-01'), mod('accounts'), { name: 'Delta Hotels', phone: '01001234567' })
    const sell = (date: string, qty: number) => { const r = createRecord(at(date), mod('invoices'), { customer: C.id, date, due_date: date }, { lines: [{ id: uid('l'), product: svc.id, description: 'Consulting day', qty, price: 1000, discount: 0, vat: 0 }] }); postDocument(at(date), r); return r }
    const oct = sell('2026-10-02', 2)
    registerPayment(at('2026-10-02'), oct, 2000, '2026-10-02', 'bank')
    sell('2026-11-02', 3)
    const t = '2026-11-04'
    const cmp = answer(ws, schema, 'this month vs last', t)!
    // November so far (1–4) against 1–4 October
    expect(cmp.rows![0]).toMatchObject({ label: 'Sales', value: 3000, note: '50%' })
    const owed = answer(ws, schema, 'مين عليه فلوس؟', t)!
    expect(owed.lines[0].values).toEqual({ a: 3000, b: 3000 })
    expect(owed.rows![0]).toMatchObject({ label: 'Delta Hotels', value: 3000, link: `/app/r/${C.id}` })
    expect(answer(ws, schema, 'best sellers', t)!.rows![0]).toMatchObject({ label: 'Consulting day', value: 3000 })
    expect(answer(ws, schema, 'how much cash', t)!.lines[0].values).toEqual({ a: 52000 })
    expect(answer(ws, schema, 'profit this year', t)!.lines[0].values).toMatchObject({ a: 5000, b: 5000 })
    expect(answer(ws, schema, 'tell me a joke', t)).toBeUndefined()
    const facts = factsForAi(ws, schema, t)
    expect(facts.thisMonth.sales).toBe(3000)
    expect(facts.customersOwe).toMatchObject({ total: 3000, customers: 1 })
    // no customer names or phone numbers go to the AI
    expect(JSON.stringify(facts)).not.toMatch(/Delta|0100/)
  })
})
