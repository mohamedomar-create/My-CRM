// Your own Excel, as it is: a step-by-step wizard from the company's messy workbooks into the system. It finds the real
// table in every sheet, says what each holds, cleans the values, lets the same customer written three ways become one,
// then brings everything in an order where nothing points at what isn't there yet (customers and products before the
// invoices that name them). Every step opens the importer the system already has, so each row is checked, previewed
// and can be undone.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, Circle, FileSpreadsheet, Hourglass, Lock, Upload, Wand2 } from 'lucide-react'
import { useApp } from './useApp'
import { Dialog } from '../components/Dialog'
import { ImportModal, parseCsv } from './ImportModal'
import { LiveDocsImport } from './LiveDocsImport'
import { HistoryImport } from './HistoryImport'
import GoLive from './GoLive'
import { canPost } from '../lib/engine'
import type { AppSchema } from '../lib/schema'
import { moduleByRole } from '../lib/schema'
import { readXlsx } from '../lib/xlsx'
import { classify, KIND_LABEL, partyColumn, tidySheet, type Kind, type Meaning, type NameGroup, type Why } from '../lib/messy'
import { buildPlan, nameGroups, type Part, type Step } from '../lib/messyPlan'
import { suggestCodes } from '../lib/quickCreate'
import { msg, N_, tr } from '../lib/i18n'

const STEPS = [N_('Your files'), N_('What is in them'), N_('Same names'), N_('Bring them in'), N_('Check')]
const WHY: Record<Why, string> = { title: N_('title rows'), blank: N_('blank rows'), total: N_('total rows'), 'header again': N_('repeated headers'), note: N_('notes'), heading: N_('heading rows') }
const MEANING: Record<Meaning, string> = {
  customer: N_('Customer'), supplier: N_('Supplier'), party: N_('Customer or supplier'), name: N_('Name'), contact: N_('Contact person'), phone: N_('Phone'), email: N_('E-mail'),
  address: N_('Address'), city: N_('City'), tax_id: N_('Tax registration no.'), product: N_('Product'), sku: N_('Code'), category: N_('Category'), unit: N_('Unit'), qty: N_('Quantity'),
  price: N_('Unit price'), cost: N_('Cost'), amount: N_('Amount'), vat: N_('VAT'), discount: N_('Discount'), date: N_('Date'), due: N_('Due date'), number: N_('Document no.'),
  description: N_('Description'), balance: N_('Balance'), stage: N_('Stage'), source: N_('Source'),
}
const WAITS: Record<string, string> = { accounts: N_('customers'), suppliers: N_('suppliers'), products: N_('products'), stock: N_('opening stock') }

async function readCsv(f: File) {
  const bytes = new Uint8Array(await f.arrayBuffer())
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  return parseCsv(utf8.includes('�') ? new TextDecoder('windows-1256').decode(bytes) : utf8)
}

export default function ExcelWizard() {
  const { ws, schema, user } = useApp()
  const saved = ws.published as AppSchema
  const role = schema.roles.find((r) => r.id === user.roleId)
  const finance = canPost({ schema: saved, user })
  const [step, setStep] = useState(0)
  const [parts, setParts] = useState<Part[]>([])
  const [reading, setReading] = useState(false)
  const [problem, setProblem] = useState('')
  const [choices, setChoices] = useState<Record<string, boolean>>({})
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [seen, setSeen] = useState<Record<string, Step>>({})

  async function load(files: FileList | null) {
    if (!files?.length) return
    setReading(true)
    setProblem('')
    try {
      const out: Part[] = []
      for (const f of [...files]) {
        const sheets = /\.csv$/i.test(f.name) ? [{ name: f.name.replace(/\.csv$/i, ''), rows: await readCsv(f) }] : await readXlsx(await f.arrayBuffer())
        sheets.forEach((sh, i) => {
          const t = tidySheet(sh)
          if (!t.rows.length) return
          const kind = classify(t)[0]?.kind ?? 'skip'
          const sup = t.columns.some((c) => c.meaning === 'supplier')
          out.push({ id: `${f.name}#${i}`, file: f.name, tidy: t, kind, mode: kind === 'balances' ? (sup ? 'suppliers' : 'customers') : 'open' })
        })
      }
      if (!out.length) throw new Error(tr('No table with rows was found in these files'))
      setParts((p) => [...p.filter((x) => !out.some((o) => o.id === x.id)), ...out])
      go(1)
    } catch (e) {
      setProblem(msg((e as Error).message))
    }
    setReading(false)
  }

  const groups = useMemo(() => nameGroups(ws, saved, parts), [ws, saved, parts])
  const accepted = (g: NameGroup) => choices[g.keep] ?? g.sure
  const plan = useMemo(() => buildPlan(ws, saved, parts, groups, accepted), [ws, saved, parts, groups, choices]) // eslint-disable-line react-hooks/exhaustive-deps
  // a step that has disappeared from the plan has nothing left to do: it is shown as done
  const all = useMemo(() => {
    const now = new Map(plan.map((s) => [s.id, s]))
    const gone = Object.values(seen).filter((s) => !now.has(s.id))
    return [...plan, ...gone].sort((a, b) => order(a) - order(b))
  }, [plan, seen])
  // opening the steps remembers each one, so a finished one (gone from the plan) still shows as done
  const go = (i: number) => {
    if (i === 3) setSeen((x) => ({ ...x, ...Object.fromEntries(plan.map((st) => [st.id, st])) }))
    setStep(i)
  }
  if (!role?.admin && !finance) return <div className="page">{tr('Only admins and finance can bring data in.')}</div>

  const update = (id: string, patch: Partial<Part>) => setParts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  const isDone = (s: Step) => !plan.some((x) => x.id === s.id) || done[s.id] || (s.type === 'list' && s.missing === 0) || (s.type === 'balances' && Boolean(ws.books?.opening?.steps[s.side]))
  const used = parts.filter((p) => p.kind !== 'skip')

  return (
    <div className="page stack">
      <div className="page-head">
        <h1><span className="badge" style={{ background: 'var(--area-tint)' }}><Wand2 size={20} /></span>{tr('Your own Excel, as it is')}</h1>
        <Link to="/app/migrate" className="btn secondary small"><ArrowLeft size={14} className="flip" /> {tr('Bring your data in')}</Link>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{tr('Upload the workbooks you already keep, however messy: titles above the table, totals, blank rows, the same customer spelled three ways. The wizard finds the real tables, cleans them, and brings them in step by step in the right order.')}</p>
      <div className="seg wizard-steps" role="tablist">
        {STEPS.map((label, i) => (
          <button key={label} type="button" role="tab" aria-selected={step === i} className={step === i ? 'on' : ''} disabled={i > 0 && !parts.length} onClick={() => go(i)}>
            <span className="pill gray tiny">{i + 1}</span> {tr(label)}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="card stack">
          <label className={`dropzone${reading ? ' busy' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void load(e.dataTransfer.files) }}>
            <Upload size={26} aria-hidden />
            <b>{reading ? tr('Reading…') : tr('Choose or drop your Excel or CSV files')}</b>
            <span className="small muted">{tr('Customers, suppliers, products, invoices, bills or balances: one file or several, any number of sheets.')}</span>
            <input type="file" accept=".xlsx,.csv" multiple hidden onChange={(e) => { void load(e.target.files); e.target.value = '' }} />
          </label>
          {problem && <div className="error-box">{problem}</div>}
          {parts.length > 0 && <p className="small" style={{ margin: 0 }}>{tr('{n} tables found.', { n: parts.length })} <button type="button" className="ghost small" onClick={() => go(1)}>{tr('Next')} <ArrowRight size={14} className="flip" /></button></p>}
        </div>
      )}

      {step === 1 && (
        <>
          {parts.map((p) => <SheetCard key={p.id} part={p} onChange={(patch) => update(p.id, patch)} />)}
          <Footer back={() => go(0)} next={() => go(2)} disabled={!used.length} />
        </>
      )}

      {step === 2 && (
        <>
          <NamesCard title={tr('Customers')} groups={groups.accounts} choices={choices} setChoices={setChoices} />
          <NamesCard title={tr('Suppliers')} groups={groups.suppliers} choices={choices} setChoices={setChoices} />
          <Footer back={() => go(1)} next={() => go(3)} />
        </>
      )}

      {step === 3 && (
        <>
          <p className="small muted" style={{ margin: 0 }}>{tr('Do the steps from the top. Each one opens the importer: it checks every row and shows what will happen before anything is saved, and an import can be taken out again.')}</p>
          {!all.length && <div className="info">{tr('Nothing to bring in: everything in these sheets is already in the system.')}</div>}
          <div className="stack">
            {all.map((s, i) => <StepRow key={s.id} n={i + 1} step={s} done={isDone(s)} finance={finance} onDone={() => setDone((d) => ({ ...d, [s.id]: true }))} />)}
          </div>
          <Footer back={() => go(2)} next={() => go(4)} />
        </>
      )}

      {step === 4 && <CheckCard steps={all} isDone={isDone} />}
    </div>
  )
}

const order = (s: Step) => ({ list: 0, names: 1, products: 2, balances: 3, docs: 4 })[s.type] * 10 + (s.type === 'list' ? ['accounts', 'suppliers', 'products', 'contacts', 'leads'].indexOf(s.role) : s.type === 'names' ? (s.role === 'accounts' ? 0 : 1) : s.type === 'docs' ? (s.side === 'sales' ? 0 : 1) + (s.mode === 'history' ? 2 : 0) : 0)

function Footer({ back, next, disabled }: { back: () => void; next: () => void; disabled?: boolean }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      <button type="button" className="secondary" onClick={back}><ArrowLeft size={14} className="flip" /> {tr('Back')}</button>
      <button type="button" disabled={disabled} onClick={next}>{tr('Next')} <ArrowRight size={14} className="flip" /></button>
    </div>
  )
}

function SheetCard({ part, onChange }: { part: Part; onChange: (p: Partial<Part>) => void }) {
  const t = part.tidy
  const guess = classify(t)
  const sure = guess.length > 0 && (guess.length === 1 || guess[0].score >= guess[1].score + 3)
  const byWhy = t.skipped.reduce<Record<string, number>>((m, s) => ({ ...m, [s.why]: (m[s.why] ?? 0) + 1 }), {})
  const party = ['sales', 'purchases', 'balances', 'customers', 'suppliers'].includes(part.kind) ? partyColumn(t, part.kind) : -1
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <FileSpreadsheet size={18} aria-hidden />
        <b>{t.sheet}</b>
        <span className="tiny muted">{part.file} · {tr('{n} rows', { n: t.rows.length })}</span>
        <label className="row small" style={{ gap: 6, marginInlineStart: 'auto' }}>{tr('It holds')}
          <select value={part.kind} onChange={(e) => { const kind = e.target.value as Kind; onChange({ kind, mode: kind === 'balances' ? 'customers' : 'open' }) }} style={{ width: 'auto' }}>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{tr(KIND_LABEL[k])}</option>)}
          </select>
        </label>
        {part.kind !== 'skip' && <span className={`pill tiny ${sure ? 'green' : 'amber'}`}>{sure ? tr('Recognised') : tr('Please check')}</span>}
      </div>
      {(part.kind === 'sales' || part.kind === 'purchases') && (
        <div className="seg" role="radiogroup" aria-label={tr('These documents are')}>
          <button type="button" className={part.mode !== 'history' ? 'on' : ''} onClick={() => onChange({ mode: 'open' })}>{tr('Still open: into the books')}</button>
          <button type="button" className={part.mode === 'history' ? 'on' : ''} onClick={() => onChange({ mode: 'history' })}>{tr('Past and settled: history only')}</button>
        </div>
      )}
      {(part.kind === 'sales' || part.kind === 'purchases') && <span className="tiny muted">{part.mode === 'history' ? tr('Kept for reports and customer history, never in the books: they were already counted in the old system’s balances.') : tr('Each becomes a real document in the books (sales, VAT, stock and what is owed move). Only for documents still being worked on, so nothing is counted twice with the opening balances.')}</span>}
      {part.kind === 'balances' && (
        <div className="seg" role="radiogroup" aria-label={tr('Who owes')}>
          <button type="button" className={part.mode !== 'suppliers' ? 'on' : ''} onClick={() => onChange({ mode: 'customers' })}>{tr('Customers owe us')}</button>
          <button type="button" className={part.mode === 'suppliers' ? 'on' : ''} onClick={() => onChange({ mode: 'suppliers' })}>{tr('We owe suppliers')}</button>
        </div>
      )}
      <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
        {t.skipped.length > 0 && <li>{tr('Left out')}: {Object.entries(byWhy).map(([w, n]) => `${n} ${tr(WHY[w as Why])}`).join(' · ')} <details style={{ display: 'inline' }}><summary className="tiny muted" style={{ display: 'inline', cursor: 'pointer' }}>{tr('which')}</summary><span className="tiny muted"> {t.skipped.slice(0, 12).map((s) => `${tr('row {n}', { n: s.row })}${s.text ? ` (${s.text.slice(0, 40)})` : ''}`).join(' · ')}</span></details></li>}
        {t.filled.map((f) => <li key={f.column}>{tr('“{col}” written once over several lines: copied onto {n} lines', { col: f.column, n: f.count })}</li>)}
        {t.grouped && <li>{tr('Headings over groups of rows became a column of their own')}</li>}
        {(t.fixed.dates + t.fixed.numbers + t.fixed.text) > 0 && <li>{tr('Cleaned: {d} dates, {n} amounts, {t} cells with extra spaces or Arabic digits', { d: t.fixed.dates, n: t.fixed.numbers, t: t.fixed.text })}{t.monthFirst ? ` · ${tr('dates read month first')}` : ''}</li>}
      </ul>
      <div className="chips">
        {t.columns.map((c, j) => <span key={j} className={`chip${c.meaning ? ' on' : ''}${j === party ? ' strong' : ''}`} title={c.meaning ? tr(MEANING[c.meaning]) : tr('Not used')}>{c.name}{c.meaning ? ` → ${tr(MEANING[c.meaning])}` : ''}</span>)}
      </div>
      <div className="table-wrap" style={{ maxHeight: 220 }}>
        <table className="data small">
          <thead><tr>{t.header.map((h, j) => <th key={j}>{h}</th>)}</tr></thead>
          <tbody>{t.rows.slice(0, 5).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} dir="auto">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}

function NamesCard({ title, groups, choices, setChoices }: { title: string; groups: NameGroup[]; choices: Record<string, boolean>; setChoices: (f: (c: Record<string, boolean>) => Record<string, boolean>) => void }) {
  const dupes = groups.filter((g) => g.others.length)
  const known = groups.filter((g) => g.existing).length
  if (!groups.length) return null
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      <p className="small muted" style={{ margin: 0 }}>{tr('{n} different names in the files', { n: groups.length })}{known ? ` · ${tr('{n} already in the system: they are linked, not added again', { n: known })}` : ''}</p>
      {!dupes.length ? <p className="small" style={{ margin: 0 }}><CheckCircle2 size={14} color="var(--success)" /> {tr('No name is written two ways.')}</p> : dupes.map((g) => {
        const on = choices[g.keep] ?? g.sure
        return (
          <label key={g.keep} className="row small" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={on} onChange={(e) => setChoices((c) => ({ ...c, [g.keep]: e.target.checked }))} />
            <span>{tr('Use “{keep}” for: {others}', { keep: g.keep, others: g.others.map((o) => `“${o}”`).join(', ') })} <span className="tiny muted">({tr('{n} rows', { n: g.rows })})</span>{' '}
              {g.existing && <span className="pill green tiny">{tr('in the system')}</span>} {!g.sure && <span className="pill amber tiny">{tr('a guess: check')}</span>}</span>
          </label>
        )
      })}
    </div>
  )
}

function StepRow({ n, step, done, finance, onDone }: { n: number; step: Step; done: boolean; finance: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [stock, setStock] = useState(false)
  const books = step.type === 'balances' || (step.type === 'docs' && step.mode === 'open')
  const waits = step.type === 'docs' || step.type === 'balances' ? step.waits : []
  const blocked = !done && ((books && !finance) || waits.length > 0)
  const what = step.type === 'list' ? tr('{name}: {n} rows, {m} new', { name: msg(step.title), n: step.rows, m: step.missing })
    : step.type === 'names' ? tr('{n} {name} named only on documents: {list}', { n: step.names.length, name: msg(step.title).toLowerCase(), list: step.names.slice(0, 5).join(', ') + (step.names.length > 5 ? '…' : '') })
      : step.type === 'products' ? tr('{n} products named only on documents', { n: step.items.length })
        : step.type === 'balances' ? tr('{name}: {n} balances', { name: tr(step.title), n: step.rows })
          : tr('{name}: {n} lines, {how}', { name: tr(step.title), n: step.rows, how: step.mode === 'history' ? tr('as history') : tr('into the books') })
  return (
    <div className={`card row wiz-step${done ? ' done' : ''}`} style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      {done ? <CheckCircle2 size={20} color="var(--success)" /> : blocked ? <Hourglass size={20} color="var(--muted)" /> : <Circle size={20} color="var(--muted)" />}
      <div className="grow stack" style={{ gap: 2 }}>
        <b>{n}. {what}</b>
        <span className="tiny muted">{tr('From')}: {step.source}</span>
        {!done && waits.filter((w) => w !== 'stock').length > 0 && <span className="tiny" style={{ color: 'var(--warning)' }}>{tr('Waiting for the {what} steps above, so every row finds what it names', { what: waits.filter((w) => w !== 'stock').map((w) => tr(WAITS[w])).join(', ') })}</span>}
        {!done && step.type === 'docs' && step.short.length > 0 && (
          <span className="tiny" style={{ color: 'var(--warning)' }}>
            {tr('These invoices sell more than is in stock, so they would be refused: enter the opening stock first ({list}).', { list: step.short.slice(0, 4).map((x) => tr('{name}: {have} of {need}', { name: x.name, have: x.have, need: x.need })).join(', ') + (step.short.length > 4 ? '…' : '') })}
            {' '}<button type="button" className="ghost small" onClick={() => setStock(true)}>{tr('Enter opening stock')}</button>
          </span>
        )}
        {!done && books && !finance && <span className="tiny muted"><Lock size={11} /> {tr('Someone who can post (finance or an admin) does this step')}</span>}
      </div>
      {!done && <button type="button" disabled={blocked} onClick={() => setOpen(true)}><Upload size={14} /> {step.type === 'products' ? tr('Review and add') : tr('Bring in')}</button>}
      {open && <Runner step={step} onClose={() => setOpen(false)} onDone={onDone} />}
      {stock && <Dialog title={tr('Opening stock')} onClose={() => setStock(false)} wide><GoLive /></Dialog>}
    </div>
  )
}

/** Opens the importer each step needs, with the cleaned sheet already in it. */
function Runner({ step, onClose, onDone }: { step: Step; onClose: () => void; onDone: () => void }) {
  const fileName = `${step.source}`
  if (step.type === 'list') return <ImportModal mod={step.module} preset={{ fileName, sheet: step.sheet }} onClose={onClose} onDone={() => onDone()} />
  if (step.type === 'names') {
    const label = step.module.fields.find((f) => f.key === step.module.titleField)?.label ?? 'Name'
    return <ImportModal mod={step.module} preset={{ fileName, sheet: { name: step.title, rows: [[label], ...step.names.map((x) => [x])] } }} onClose={onClose} />
  }
  if (step.type === 'products') return <ProductsReview step={step} onClose={onClose} />
  if (step.type === 'balances') return <Dialog title={tr(step.title)} onClose={onClose} wide><GoLive presets={{ [step.side]: { file: fileName, rows: step.sheet.rows } }} /></Dialog>
  if (step.mode === 'history') return <HistoryImport side={step.side} preset={{ fileName, sheet: step.sheet }} onClose={onClose} onDone={() => onDone()} />
  return <LiveDocsImport side={step.side} preset={{ fileName, rows: step.sheet.rows }} onClose={onClose} onDone={() => onDone()} />
}

/** Products found only on invoices or bills: their code, selling price and kind, filled in before they are added. */
function ProductsReview({ step, onClose }: { step: Extract<Step, { type: 'products' }>; onClose: () => void }) {
  const { ws, schema } = useApp()
  const saved = ws.published as AppSchema
  const mod = step.module
  const label = (k: string) => mod.fields.find((f) => f.key === k)?.label ?? k
  const stock = Boolean(moduleByRole(saved, 'purchases'))
  const [rows, setRows] = useState(() => {
    const codes = suggestCodes(ws, mod, 'sku', step.items.filter((it) => !it.code).length)
    return step.items.map((it) => ({ name: it.name, code: it.code ?? codes.shift() ?? '', price: it.price !== undefined ? String(it.price) : '', goods: stock, buying: it.buying }))
  })
  const [go, setGo] = useState(false)
  const missing = rows.filter((r) => r.price === '').length
  if (go) {
    const sheet = { name: step.title, rows: [[label('name'), label('sku'), label('price'), label('vat_rate'), label('track_stock')], ...rows.map((r) => [r.name, r.code, r.price, String(saved.company.vatRate), r.goods ? 'yes' : 'no'])] }
    return <ImportModal mod={mod} preset={{ fileName: step.source, sheet }} onClose={onClose} />
  }
  return (
    <Dialog title={tr('Products named only on documents')} onClose={onClose} wide>
      <p className="small muted" style={{ margin: 0 }}>{tr('Check each one: its code, what you sell it for, and whether it is goods kept in stock or a service. Prices from your sales sheets are filled in; products you only bought need their selling price.')}</p>
      <div className="table-wrap" style={{ maxHeight: 360 }}>
        <table className="data small">
          <thead><tr><th>{msg(label('name'))}</th><th>{msg(label('sku'))}</th><th>{msg(label('price'))}</th><th>{tr('Goods or service')}</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td><input value={r.code} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, code: e.target.value } : y)))} style={{ width: 110 }} /></td>
                <td><input type="number" min={0} step="0.01" value={r.price} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, price: e.target.value } : y)))} style={{ width: 110 }} aria-invalid={r.price === ''} /></td>
                <td><select value={r.goods ? 'goods' : 'service'} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, goods: e.target.value === 'goods' } : y)))} style={{ width: 'auto' }}><option value="goods">{tr('Goods (kept in stock)')}</option><option value="service">{tr('Service (no stock)')}</option></select></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {missing > 0 && <span className="small" style={{ color: 'var(--warning)' }}>{tr('{n} still need a selling price', { n: missing })}</span>}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="secondary" onClick={onClose}>{tr('Cancel')}</button>
        <button type="button" disabled={missing > 0 || rows.some((r) => !r.code.trim())} onClick={() => setGo(true)}>{tr('Next: check and add them')} <ArrowRight size={14} className="flip" /></button>
      </div>
      <span className="tiny muted">{schema.company.vatRate}% {tr('VAT')} · {tr('change any of them later on the product’s page')}</span>
    </Dialog>
  )
}

function CheckCard({ steps, isDone }: { steps: Step[]; isDone: (s: Step) => boolean }) {
  const finished = steps.filter(isDone).length
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>{finished === steps.length ? <><CheckCircle2 size={18} color="var(--success)" /> {tr('All brought in')}</> : tr('{a} of {b} steps done', { a: finished, b: steps.length })}</h2>
      <p className="small" style={{ margin: 0 }}>{tr('Now let the system check the result: the company check-up finds customers without phone numbers, products without prices, invoices that don’t add up, stock below zero and anything else to fix.')}</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <Link to="/app/doctor" className="btn"><CheckCircle2 size={15} /> {tr('Open the company check-up')}</Link>
        <Link to="/app/migrate" className="btn secondary">{tr('Opening balances and go-live')}</Link>
      </div>
    </div>
  )
}
