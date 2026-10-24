// Realistic sample data so a new company sees its system working in seconds.
// Everything goes through the engine, so stock, journals and payments are consistent.
import type { AppSchema, FieldDef, ModuleDef } from './schema'
import { moduleByRole, uid } from './schema'
import type { Rec, User, Workspace } from './types'
import { createRecord, list, moveStage, postDocument, registerPayment, round2, todayISO, type Ctx } from './engine'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const COMPANIES = ['Nile Valley Group', 'Delta Foods', 'Cairo Care Hospital', 'Alex Marine Co.', 'Giza Systems Trading', 'Red Sea Resorts', 'Sinai Cement', 'Mansoura Pharma', 'Pyramids Plastics', 'Heliopolis Clinics', 'October Steel', 'Luxor Hotels', 'Smart Village Tech', 'Zamalek Interiors', 'Suez Logistics']
const PEOPLE = ['Ahmed Hassan', 'Mona Adel', 'Omar Khaled', 'Sara Mahmoud', 'Youssef Ali', 'Nour El-Din', 'Hana Farouk', 'Karim Mostafa', 'Laila Samir', 'Tarek Fawzy', 'Dina Ibrahim', 'Mostafa Gamal', 'Rania Saad', 'Hossam Nabil', 'Yasmin Sherif']
const PRODUCTS = ['Standard unit', 'Premium unit', 'Spare part kit', 'Consumables pack', 'Installation service', 'Annual maintenance', 'Starter bundle', 'Replacement filter']

export function seedSampleData(ws: Workspace, schema: AppSchema, admin: User, productNames: string[] = []) {
  const r = rng(42)
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const int = (a: number, b: number) => Math.floor(a + r() * (b - a + 1))
  const day = (offset: number) => todayISO(new Date(Date.now() + offset * 86_400_000))

  // Demo team members, one or two per team role, so owner and assignee fields have real people.
  const demoUsers: User[] = []
  for (const role of schema.roles.filter((x) => !x.admin)) {
    const n = role.name.toLowerCase().includes('sales') ? 2 : 1
    for (let i = 0; i < n; i++) {
      const name = PEOPLE[(demoUsers.length + 3) % PEOPLE.length]
      demoUsers.push({ id: uid('u'), name, email: `${name.split(' ')[0].toLowerCase()}.${role.name.toLowerCase().replace(/\W+/g, '')}@demo.local`, roleId: role.id, demo: true })
    }
  }
  ws.users.push(...demoUsers)
  const people = [admin, ...demoUsers]
  // Everything below is tagged as sample data, so “Remove sample data” can take it all out before the company goes live.
  const ctx: Ctx = { ws, schema, user: admin, sample: true }

  const value = (m: ModuleDef, f: FieldDef, i: number): unknown => {
    if (f.readOnly || f.type === 'formula') return undefined
    const k = f.key
    switch (f.type) {
      case 'text':
        if (k === 'name') return m.role === 'contacts' || m.role === 'leads' ? PEOPLE[i % PEOPLE.length] : m.role === 'accounts' || m.role === 'suppliers' ? (m.role === 'suppliers' ? `${pick(['Global', 'Euro', 'Orient', 'Prime'])} Supplies ${i + 1}` : COMPANIES[i % COMPANIES.length]) : `${m.singular} ${i + 1}`
        if (k === 'sku') return `SKU-${1001 + i}`
        if (k === 'title') return `${pick(['Supply contract', 'Expansion', 'Renewal', 'New line', 'Upgrade'])} – ${COMPANIES[(i * 3) % COMPANIES.length]}`
        if (k === 'subject') return pick(['Device not starting', 'Routine maintenance', 'Pressure drop', 'Training request', 'Spare part needed'])
        if (k === 'company') return COMPANIES[(i + 5) % COMPANIES.length]
        if (k.includes('tax')) return `${int(100, 999)}-${int(100, 999)}-${int(100, 999)}`
        return `${f.label} ${i + 1}`
      case 'longtext':
        return pick(['Customer asked for a call next week.', 'Prefers delivery to the main branch.', 'Decision expected after budget approval.', ''])
      case 'number':
        if (k === 'area') return int(80, 320)
        if (k === 'capacity') return int(50, 2000)
        if (k === 'hours') return int(1, 8)
        if (k === 'reorder_level') return int(5, 20)
        if (k === 'years') return int(3, 10)
        return int(1, 100)
      case 'currency':
        if (k === 'amount' || k === 'budget' || k === 'value' || k === 'contract_value') return int(20, 900) * 1000
        if (k === 'price_per_m2') return int(25, 60) * 1000
        if (k === 'rate') return int(4, 15) * 100
        return int(1, 50) * 1000
      case 'percent':
        if (k === 'vat_rate') return schema.company.vatRate
        if (k === 'progress') return int(0, 100)
        return int(5, 25)
      case 'rating':
        return int(1, 5)
      case 'date':
        return day(int(-60, 45))
      case 'select':
        return f.options?.length ? pick(f.options).value : undefined
      case 'multiselect':
        return f.options?.length ? [pick(f.options).value] : []
      case 'checkbox':
        if (k === 'track_stock') return true
        if (k === 'done') return r() < 0.3
        return r() < 0.5
      case 'email':
        return `${PEOPLE[i % PEOPLE.length].split(' ')[0].toLowerCase()}@example.com`
      case 'phone':
        return `+20 10${int(10000000, 99999999)}`
      case 'url':
        return 'https://example.com'
      case 'relation': {
        const targets = list(ws, f.target ?? '')
        return targets.length ? pick(targets).id : undefined
      }
      case 'user':
        return pick(people).id
    }
  }

  const counts: Partial<Record<ModuleDef['role'], number>> = { accounts: 10, contacts: 12, leads: 12, deals: 14, suppliers: 4, tickets: 6, custom: 8, tasks: 4 }
  // Create modules whose relations point at already-filled modules first.
  const pending = schema.modules.filter((m) => !m.lines && m.role !== 'products')
  const done = new Set<string>()
  const productsMod = moduleByRole(schema, 'products')
  if (productsMod) {
    const names = productNames.length ? productNames : PRODUCTS
    const services = /service|maintenance|installation|fee|course|hour/i
    names.slice(0, 12).forEach((name, i) => {
      const price = int(5, 120) * 100
      createRecord(ctx, productsMod.id, { ...Object.fromEntries(productsMod.fields.map((f) => [f.key, value(productsMod, f, i)]).filter(([, v]) => v !== undefined)), name, sku: `SKU-${1001 + i}`, price, track_stock: !services.test(name), vat_rate: schema.company.vatRate }, { silent: true })
    })
    done.add(productsMod.id)
  }
  let guard = 0
  while (pending.length && guard++ < 50) {
    const idx = pending.findIndex((m) => m.fields.every((f) => f.type !== 'relation' || !f.target || done.has(f.target) || f.target === m.id || !schema.modules.some((x) => x.id === f.target && !x.lines && x.role !== 'products' && !done.has(x.id))))
    const m = pending.splice(idx < 0 ? 0 : idx, 1)[0]
    const n = counts[m.role] ?? 6
    for (let i = 0; i < n; i++) {
      const vals: Record<string, unknown> = {}
      for (const f of m.fields) {
        const v = value(m, f, i)
        if (v !== undefined) vals[f.key] = v
      }
      try {
        const rec = createRecord(ctx, m.id, vals, { silent: m.role === 'tasks' })
        backdate(rec, int(0, 150))
        if (m.stages) {
          const target = pick(m.stages)
          try {
            moveStage(ctx, rec, target.id)
          } catch {
            /* stage gate not met for this sample, leave it in the first stage */
          }
        }
      } catch {
        /* skip a sample that doesn't pass validation */
      }
    }
    done.add(m.id)
  }

  const purchases = moduleByRole(schema, 'purchases')
  const invoices = moduleByRole(schema, 'invoices')
  const quotes = moduleByRole(schema, 'quotes')
  const products = productsMod ? list(ws, productsMod.id) : []
  const tracked = products.filter((p) => p.values.track_stock)
  const suppliers = moduleByRole(schema, 'suppliers')
  const accounts = moduleByRole(schema, 'accounts')

  if (purchases && suppliers && tracked.length && list(ws, suppliers.id).length) {
    for (let b = 0; b < 2; b++) {
      const bill = createRecord(ctx, purchases.id, { supplier: pick(list(ws, suppliers.id)).id, date: day(-150 + b * 40), due_date: day(-120 + b * 40) }, {
        lines: tracked.map((p) => ({ id: uid('l'), product: p.id, description: String(p.values.name), qty: int(12, 30), price: round2(Number(p.values.price) * 0.55), discount: 0, vat: schema.company.vatRate })),
      })
      backdate(bill, 150 - b * 40)
      postDocument(ctx, bill)
      registerPayment(ctx, bill, round2(Number(bill.values.total) * (b === 0 ? 0.35 : 0.15)), String(bill.values.date), 'bank')
    }
  }

  if (invoices && accounts && products.length && list(ws, accounts.id).length) {
    for (let i = 0; i < 18; i++) {
      const ago = 170 - i * 9
      const lines = Array.from({ length: int(1, 3) }, () => {
        const p = pick(products)
        const stock = Number(p.values.stock ?? 0)
        const qty = p.values.track_stock ? Math.max(1, Math.min(int(2, 10), Math.floor(stock / 4))) : int(1, 4)
        return { id: uid('l'), product: p.id, description: String(p.values.name), qty, price: Number(p.values.price), discount: pick([0, 0, 5, 10]), vat: Number(p.values.vat_rate ?? schema.company.vatRate) }
      })
      const inv = createRecord(ctx, invoices.id, { customer: pick(list(ws, accounts.id)).id, date: day(-ago), due_date: day(-ago + 30) }, { lines })
      backdate(inv, ago)
      try {
        postDocument(ctx, inv)
        // Older invoices are mostly collected; the newest ones are still open, as in a healthy business.
        const share = ago > 45 ? pick([1, 1, 1, 1, 0.5]) : pick([1, 0.5, 0, 0])
        if (share) registerPayment(ctx, inv, round2(Number(inv.values.total) * share), day(Math.min(0, -ago + 10)), pick(['bank', 'cash', 'instapay']))
      } catch {
        /* not enough stock for this sample: keep as a draft */
      }
    }
  }

  if (quotes && accounts && products.length) {
    for (let i = 0; i < 4; i++) {
      const p = pick(products)
      const q = createRecord(ctx, quotes.id, { customer: pick(list(ws, accounts.id)).id, date: day(-i * 5) }, { lines: [{ id: uid('l'), product: p.id, description: String(p.values.name), qty: int(1, 10), price: Number(p.values.price), discount: 0, vat: schema.company.vatRate }] })
      backdate(q, i * 5)
    }
  }
}

function backdate(rec: Rec, daysAgo: number) {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  rec.createdAt = d.toISOString()
  if (rec.stageHistory?.[0]) rec.stageHistory[0].at = rec.createdAt
}
