// "Ask Nasq360": questions about the company, in English or Arabic (Egyptian or standard), answered at once from the
// books — no AI needed, nothing leaves the device. It understands what is asked (this month against last, who owes
// us, what we owe, cash now and ahead, best sellers, best customers, sales, profit, expenses, low stock, what to
// watch) and for when (today, this week, this month, last month, this year, last year). What it doesn't understand
// can be sent to the AI with the company's figures (not its records), when the AI is set up.
import type { Workspace } from './types'
import { moduleByRole, type AppSchema } from './schema'
import { account as findAccount, allMoneyAccounts } from './accounts'
import { accountBalance, ageing, baseBalance, list, round2, todayISO } from './engine'
import { incomeStatement } from './statements'
import { reorderPlan } from './scan'
import { cashAlerts, cashForecast } from './forecast'

export type Intent = 'compare' | 'owed' | 'weOwe' | 'cash' | 'forecast' | 'bestSellers' | 'topCustomers' | 'sales' | 'profit' | 'expenses' | 'lowStock' | 'watch'

/** Arabic written any way: no diacritics, one alef, ta marbuta and alef maqsura as people type them. */
export function normalize(q: string) {
  return q.toLowerCase().replace(/[ً-ٰٟ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim()
}

const WORDS: [Intent, string[]][] = [
  ['compare', ['vs', 'versus', 'compared', 'compare', 'how did we do', 'how are we doing', 'how is business', 'مقارنه', 'قارن', 'بالمقارنه', 'عملنا ايه', 'اخبار الشغل', 'الاداء', 'اداءنا', 'كيف كان']],
  ['forecast', ['forecast', 'next weeks', 'coming weeks', 'run out of cash', 'enough cash', 'التوقع', 'توقعات', 'الاسابيع الجايه', 'الاسابيع القادمه', 'هتكفي', 'هيخلص']],
  ['owed', ['owe us', 'owes us', 'owed to us', 'receivable', 'who owes', 'overdue', 'late customers', 'مديونيه', 'مديونيات', 'عليه فلوس', 'عليهم فلوس', 'مستحق لنا', 'المتاخرين', 'متاخر', 'العملاء المتاخر', 'لينا عند', 'فلوسنا عند']],
  ['weOwe', ['we owe', 'payable', 'owe suppliers', 'bills to pay', 'علينا', 'للموردين', 'مستحق علينا', 'نسدد', 'ندفع للموردين']],
  ['lowStock', ['low stock', 'reorder', 'out of stock', 'running out', 'running low', 'low on', 'buy next', 'نواقص', 'ناقص', 'هيخلص من المخزن', 'اعاده الطلب', 'نشتري ايه']],
  ['bestSellers', ['best selling', 'best sellers', 'top products', 'most sold', 'sold most', 'الاكثر مبيعا', 'اكثر مبيعا', 'اكثر الاصناف', 'افضل المنتجات', 'افضل الاصناف', 'اكتر حاجه بتتباع']],
  ['topCustomers', ['best customers', 'top customers', 'biggest customers', 'largest customers', 'اكبر العملاء', 'افضل العملاء', 'اهم العملاء', 'اكبر عميل']],
  ['watch', ['watch', 'alerts', 'problems', 'risks', 'worry', 'تنبيهات', 'مشاكل', 'مخاطر', 'اخلي بالي', 'انتبه']],
  ['profit', ['profit', 'margin', 'made money', 'earn', 'الربح', 'ربح', 'ارباح', 'مكسب', 'كسبنا', 'هامش']],
  ['expenses', ['expense', 'spending', 'spent', 'costs', 'مصروفات', 'المصاريف', 'مصاريف', 'صرفنا']],
  ['sales', ['sales', 'revenue', 'sold', 'turnover', 'مبيعات', 'بعنا', 'الايرادات', 'ايرادات', 'البيع']],
  ['cash', ['cash', 'bank', 'liquidity', 'money do we have', 'الكاش', 'النقديه', 'السيوله', 'الفلوس', 'البنك', 'الخزنه', 'الرصيد']],
]

export function intentOf(question: string): Intent | undefined {
  const q = ` ${normalize(question)} `
  for (const [intent, words] of WORDS) if (words.some((w) => q.includes(normalize(w)))) return intent
  return undefined
}

export interface Period { from: string; to: string; key: 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'year' | 'lastYear' }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const monthStart = (today: string) => `${today.slice(0, 7)}-01`
const monthEndOf = (first: string) => { const [y, m] = first.split('-').map(Number); return iso(new Date(Date.UTC(y, m, 0))) }

/** When the question is about (this month when it doesn't say). */
export function periodOf(question: string, today = todayISO()): Period {
  const q = normalize(question)
  const has = (...w: string[]) => w.some((x) => q.includes(normalize(x)))
  const t = new Date(today + 'T00:00:00Z')
  if (has('last year', 'السنه اللي فاتت', 'العام الماضي', 'السنه الماضيه', 'السنه اللي فاتت')) { const y = t.getUTCFullYear() - 1; return { key: 'lastYear', from: `${y}-01-01`, to: `${y}-12-31` } }
  if (has('this year', 'السنه دي', 'هذه السنه', 'هذا العام', 'السنه', 'العام')) return { key: 'year', from: `${today.slice(0, 4)}-01-01`, to: today }
  if (has('last month', 'الشهر اللي فات', 'الشهر الماضي', 'الشهر السابق')) { const first = iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1))); return { key: 'lastMonth', from: first, to: monthEndOf(first) } }
  if (has('yesterday', 'امبارح', 'امس')) { const y = iso(new Date(t.getTime() - 86_400_000)); return { key: 'yesterday', from: y, to: y } }
  if (has('today', 'النهارده', 'اليوم')) return { key: 'today', from: today, to: today }
  if (has('this week', 'الاسبوع ده', 'هذا الاسبوع', 'الاسبوع')) { const d = new Date(t.getTime() - ((t.getUTCDay() + 1) % 7) * 86_400_000); return { key: 'week', from: iso(d), to: today } }
  return { key: 'month', from: monthStart(today), to: today }
}

export interface Answer {
  intent: Intent
  period?: Period
  /** sentences: a message key (English, translated on screen) and its values */
  lines: { key: string; values?: Record<string, string | number> }[]
  rows?: { label: string; value: number; note?: string; link?: string }[]
  money?: boolean
}

const salesBetween = (ws: Workspace, from: string, to: string) => round2(ws.data.journal.filter((j) => j.date >= from && j.date <= to).reduce((s, j) => s + j.lines.reduce((t, l) => t + (l.account === '4000' ? l.credit - l.debit : l.account === '4100' ? l.credit - l.debit : 0), 0), 0))
const pct = (now: number, before: number) => (before ? Math.round(((now - before) / Math.abs(before)) * 100) : 0)

/** The same length of time just before (this month so far against last month to the same day). */
function before(p: Period): Period {
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000)
  if (p.key === 'month') { const t = new Date(p.from + 'T00:00:00Z'); const first = iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1))); const end = iso(new Date(Date.parse(first) + days * 86_400_000)); return { key: 'lastMonth', from: first, to: end < monthEndOf(first) ? end : monthEndOf(first) } }
  if (p.key === 'year' || p.key === 'lastYear') { const y = Number(p.from.slice(0, 4)) - 1; return { key: 'lastYear', from: `${y}${p.from.slice(4)}`, to: `${y}${p.to.slice(4)}` } }
  const to = iso(new Date(Date.parse(p.from) - 86_400_000))
  return { key: p.key, from: iso(new Date(Date.parse(to) - days * 86_400_000)), to }
}

export function answer(ws: Workspace, schema: AppSchema, question: string, today = todayISO()): Answer | undefined {
  const intent = intentOf(question)
  if (!intent) return undefined
  const p = periodOf(question, today)
  const docRows = (role: 'invoices' | 'purchases') => { const m = moduleByRole(schema, role); return m ? list(ws, m.id).filter((d) => !d.sample) : [] }
  switch (intent) {
    case 'compare': {
      const b = before(p)
      const now = incomeStatement(ws, p.from, p.to)
      const was = incomeStatement(ws, b.from, b.to)
      const custNow = new Set(docRows('invoices').filter((d) => d.status !== 'draft' && d.status !== 'void' && String(d.values.date) >= p.from && String(d.values.date) <= p.to).map((d) => d.values.customer)).size
      return {
        intent, period: p, money: true,
        lines: [{ key: 'Sales {a} against {b} ({c}%), profit {d} against {e}.', values: { a: now.revenue.total, b: was.revenue.total, c: pct(now.revenue.total, was.revenue.total), d: now.net, e: was.net } }],
        rows: [
          { label: 'Sales', value: now.revenue.total, note: `${pct(now.revenue.total, was.revenue.total)}%` },
          { label: 'Gross profit', value: now.gross, note: `${pct(now.gross, was.gross)}%` },
          { label: 'Expenses', value: now.overheads.total, note: `${pct(now.overheads.total, was.overheads.total)}%` },
          { label: 'Net profit', value: now.net, note: `${pct(now.net, was.net)}%` },
          { label: 'Customers who bought', value: custNow },
        ],
      }
    }
    case 'owed': {
      const rows = ageing(ws, schema, 'invoices', today).filter((r) => r.total > 0).sort((a, b) => b.total - a.total)
      const total = round2(rows.reduce((s, r) => s + r.total, 0))
      const late = round2(rows.reduce((s, r) => s + r.total - r.current, 0))
      return { intent, money: true, lines: [{ key: 'Customers owe {a}, of which {b} is overdue.', values: { a: total, b: late } }], rows: rows.slice(0, 10).map((r) => ({ label: r.name, value: r.total, note: r.total - r.current > 0 ? 'overdue' : undefined, link: `/app/r/${r.party}` })) }
    }
    case 'weOwe': {
      const rows = ageing(ws, schema, 'purchases', today).filter((r) => r.total > 0).sort((a, b) => b.total - a.total)
      const total = round2(rows.reduce((s, r) => s + r.total, 0))
      const late = round2(rows.reduce((s, r) => s + r.total - r.current, 0))
      return { intent, money: true, lines: [{ key: 'We owe suppliers {a}, of which {b} is past due.', values: { a: total, b: late } }], rows: rows.slice(0, 10).map((r) => ({ label: r.name, value: r.total, link: `/app/r/${r.party}` })) }
    }
    case 'cash': {
      const accts = allMoneyAccounts(ws).map((a) => ({ label: a.name, value: accountBalance(ws, a.code) })).filter((r) => r.value !== 0)
      const total = round2(accts.reduce((s, r) => s + r.value, 0))
      const f = cashForecast(ws, schema, today)
      return { intent, money: true, lines: [{ key: 'Cash and bank: {a}.', values: { a: total } }, { key: f.lowest.end < 0 ? 'It runs short in the week of {d} ({e}).' : 'The lowest point in the next 13 weeks: {e} (week of {d}).', values: { d: f.lowest.from, e: f.lowest.end } }], rows: accts }
    }
    case 'forecast': {
      const f = cashForecast(ws, schema, today)
      return { intent, money: true, lines: [{ key: f.lowest.end < 0 ? 'It runs short in the week of {d} ({e}).' : 'The lowest point in the next 13 weeks: {e} (week of {d}).', values: { d: f.lowest.from, e: f.lowest.end } }], rows: f.weeks.map((w) => ({ label: w.from, value: w.end })) }
    }
    case 'bestSellers': {
      const by = new Map<string, { label: string; value: number }>()
      for (const d of docRows('invoices')) {
        if (d.status === 'draft' || d.status === 'void' || d.values.credit_for || String(d.values.date) < p.from || String(d.values.date) > p.to) continue
        for (const l of d.lines ?? []) { const k = l.product ?? l.description; const r = by.get(k) ?? { label: l.description, value: 0 }; r.value = round2(r.value + l.qty * l.price * (1 - l.discount / 100)); by.set(k, r) }
      }
      const rows = [...by.entries()].sort((a, b) => b[1].value - a[1].value).slice(0, 10).map(([k, r]) => ({ ...r, link: k.startsWith('r_') ? `/app/r/${k}` : undefined }))
      return { intent, period: p, money: true, lines: [rows.length ? { key: 'Best seller: {a}.', values: { a: rows[0].label } } : { key: 'No sales in this period.' }], rows }
    }
    case 'topCustomers': {
      const by = new Map<string, number>()
      for (const d of docRows('invoices')) {
        if (d.status === 'draft' || d.status === 'void' || String(d.values.date) < p.from || String(d.values.date) > p.to) continue
        by.set(String(d.values.customer), round2((by.get(String(d.values.customer)) ?? 0) + Number(d.values.subtotal ?? 0)))
      }
      const cust = moduleByRole(schema, 'accounts')
      const name = (id: string) => String((cust ? list(ws, cust.id).find((c) => c.id === id)?.values.name : '') ?? id)
      const rows = [...by.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => ({ label: name(id), value: v, link: `/app/r/${id}` }))
      return { intent, period: p, money: true, lines: [rows.length ? { key: 'Biggest customer: {a} ({b}).', values: { a: rows[0].label, b: rows[0].value } } : { key: 'No sales in this period.' }], rows }
    }
    case 'sales': {
      const now = salesBetween(ws, p.from, p.to)
      const b = before(p)
      const was = salesBetween(ws, b.from, b.to)
      const invoices = docRows('invoices').filter((d) => d.status !== 'draft' && d.status !== 'void' && !d.values.credit_for && String(d.values.date) >= p.from && String(d.values.date) <= p.to)
      return { intent, period: p, money: true, lines: [{ key: 'Sales {a} from {n} invoices ({c}% against the period before).', values: { a: now, n: invoices.length, c: pct(now, was) } }] }
    }
    case 'profit': {
      const s = incomeStatement(ws, p.from, p.to)
      return { intent, period: p, money: true, lines: [{ key: 'Net profit {a} on sales of {b} (gross margin {c}%).', values: { a: s.net, b: s.revenue.total, c: s.grossMargin } }], rows: [{ label: 'Sales', value: s.revenue.total }, { label: 'Cost of sales', value: -s.cost.total }, { label: 'Gross profit', value: s.gross }, { label: 'Expenses', value: -s.overheads.total }, { label: 'Net profit', value: s.net }] }
    }
    case 'expenses': {
      const s = incomeStatement(ws, p.from, p.to)
      const b = before(p)
      const was = incomeStatement(ws, b.from, b.to)
      const rows = s.overheads.rows.sort((x, y) => y.amount - x.amount).slice(0, 10).map((r) => ({ label: r.name, value: r.amount, note: `${pct(r.amount, was.overheads.rows.find((x) => x.code === r.code)?.amount ?? 0)}%` }))
      return { intent, period: p, money: true, lines: [{ key: 'Expenses {a} ({c}% against the period before).', values: { a: s.overheads.total, c: pct(s.overheads.total, was.overheads.total) } }], rows }
    }
    case 'lowStock': {
      const plan = reorderPlan(ws, schema, today)
      return { intent, lines: [plan.length ? { key: '{n} products are at or under their reorder level.', values: { n: plan.length } } : { key: 'Nothing is at or under its reorder level.' }], rows: plan.slice(0, 10).map((r) => ({ label: r.name, value: r.onHand, note: `→ ${r.qty}`, link: `/app/r/${r.product}` })) }
    }
    case 'watch': {
      const alerts = cashAlerts(ws, schema, today)
      const receivable = round2(docRows('invoices').filter((d) => (d.status === 'posted' || d.status === 'partial') && d.values.due_date && String(d.values.due_date) < today).reduce((s, d) => s + baseBalance(d), 0))
      return { intent, lines: alerts.length ? alerts.map((a) => ({ key: a.text, values: a.values })) : [{ key: 'Nothing unusual right now.' }], ...(receivable ? { rows: [{ label: 'Overdue from customers', value: receivable, link: '/app/accounting?tab=ageing' }] } : {}), money: true }
    }
  }
}

/** The company's figures for the AI (no names of people, no contact details): what it may answer from. */
export function factsForAi(ws: Workspace, schema: AppSchema, today = todayISO()) {
  const month = periodOf('this month', today)
  const last = periodOf('last month', today)
  const year = periodOf('this year', today)
  const s = (p: Period) => { const x = incomeStatement(ws, p.from, p.to); return { from: p.from, to: p.to, sales: x.revenue.total, grossProfit: x.gross, expenses: x.overheads.total, netProfit: x.net, topExpenses: x.overheads.rows.slice(0, 6).map((r) => ({ account: findAccount(ws, r.code)?.name ?? r.name, amount: r.amount })) } }
  const f = cashForecast(ws, schema, today)
  const owed = ageing(ws, schema, 'invoices', today)
  const weOwe = ageing(ws, schema, 'purchases', today)
  return {
    company: { currency: schema.company.currency, industry: schema.company.industry, today },
    thisMonth: s(month), lastMonth: s(last), thisYear: s(year),
    cash: { now: f.start, lowestIn13Weeks: f.lowest.end, lowestWeek: f.lowest.from },
    customersOwe: { total: round2(owed.reduce((t, r) => t + r.total, 0)), overdue: round2(owed.reduce((t, r) => t + r.total - r.current, 0)), customers: owed.filter((r) => r.total > 0).length },
    weOweSuppliers: { total: round2(weOwe.reduce((t, r) => t + r.total, 0)), pastDue: round2(weOwe.reduce((t, r) => t + r.total - r.current, 0)) },
    lowStockProducts: reorderPlan(ws, schema, today).length,
    alerts: cashAlerts(ws, schema, today).map((a) => ({ kind: a.kind, text: a.text, values: a.values })),
  }
}
