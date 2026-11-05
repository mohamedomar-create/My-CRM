// Payroll: people with checked bank details (IBAN check digits, no account paid twice), a month prepared with a bonus
// and an absence, approved by someone other than who prepared it (the owner may approve their own), posted as one
// entry by cost center, the bank file in the bank's own layout (only those paid by bank, totals equal to the
// payroll), paid from the bank and the cash box, and only the payroll right sees any of it.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, booksHealth, manualJournal, type Ctx } from './engine'
import { applyCommand } from './commands'
import { approvePayroll, bankCsv, bankRows, payPayroll, peopleOf, preparePayroll, run, runsOf, runTotals, saveEmployee, savePayrollSetup, validIban } from './payroll'
import { saveRole } from './access'

const owner: User = { id: 'u_owner', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
const clerk: User = { id: 'u_hr', name: 'Sara', email: 's@x.com', roleId: 'role_hr' }
const seller: User = { id: 'u_s', name: 'Hany', email: 'h@x.com', roleId: 'role_sales' }

/** A valid Egyptian IBAN for a 25-digit account (the check digits worked out as banks do). */
function egIban(bban: string) {
  const digits = (bban + 'EG00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let r = 0
  for (const d of digits) r = (r * 10 + Number(d)) % 97
  return `EG${String(98 - r).padStart(2, '0')}${bban}`
}

function setup() {
  const answers = { ...emptyAnswers('Nile'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const base = schema.roles.find((r) => r.admin)!
  schema.roles.push({ ...base, id: 'role_hr', name: 'HR', admin: false, finance: false, access: {} }, { ...base, id: 'role_sales', name: 'Sales', admin: false, finance: false, access: {} })
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [owner, clerk, seller], draft: schema, published: schema, history: [], data: emptyData() }
  const as = (u: User, today = '2026-12-02'): Ctx => ({ ws, schema, user: u, today })
  return { ws, schema, as }
}

describe('payroll', () => {
  it('checks IBANs by their check digits', () => {
    const good = egIban('0019000500000000263180002')
    expect(good).toHaveLength(29)
    expect(validIban(good)).toBe(true)
    expect(validIban(good.slice(0, 28) + (good.endsWith('2') ? '3' : '2'))).toBe(false)
    expect(validIban('EG12')).toBe(false)
    expect(validIban('GB82WEST12345698765432')).toBe(true) // a foreign IBAN, standard example
  })

  it('a month from people to the bank file: prepared, approved by another, posted, paid', () => {
    const { ws, schema, as } = setup()
    // the owner gives HR the payroll right (and nothing else)
    saveRole(as(owner), { id: 'role_hr', payroll: true })
    expect(schema.roles.find((r) => r.id === 'role_hr')!.access).toMatchObject({ payroll_people: ['view', 'create', 'edit'], payroll_runs: ['view', 'create', 'edit'] })
    expect(() => saveEmployee(as(seller), { name: 'X', basic: 1 })).toThrow(/payroll right/)
    manualJournal(as(owner, '2026-01-01'), { date: '2026-01-01', memo: 'Capital', lines: [{ account: '1110', debit: 100000, credit: 0 }, { account: '1100', debit: 10000, credit: 0 }, { account: '3000', debit: 0, credit: 110000 }] })
    const ibanA = egIban('0019000500000000263180002')
    const ibanB = egIban('0019000500000000263180003')
    const a = saveEmployee(as(clerk), { name: 'Ahmed Ali', national_id: '29001011234567', iban: ibanA, bank_name: 'CIB', basic: 10000, allowances: 2000, insurance: 1100, tax: 900, employer_insurance: 1875 })
    saveEmployee(as(clerk), { name: 'Mai Hassan', account_no: '1002003004', bank_name: 'NBE', iban: ibanB, basic: 8000, insurance: 880, tax: 400, employer_insurance: 1500 })
    saveEmployee(as(clerk), { name: 'Sayed (driver)', pay_by: 'cash', basic: 5000, allowances: 500 })
    // checks on the bank details
    expect(() => saveEmployee(as(clerk), { name: 'Bad IBAN', iban: ibanA.slice(0, -1) + '9', basic: 1 })).toThrow(/IBAN of Bad IBAN isn’t right/)
    expect(() => saveEmployee(as(clerk), { name: 'Twin', iban: ibanA, basic: 1 })).toThrow(/Ahmed Ali already has this IBAN/)
    expect(() => saveEmployee(as(clerk), { name: 'No bank', basic: 1 })).toThrow(/add the account number or IBAN/)
    expect(peopleOf(ws).map((p) => p.values.code)).toEqual(['EMP-0003', 'EMP-0002', 'EMP-0001'])

    // November: Ahmed gets a 1,000 bonus, Mai loses 500 for an absence
    const id = preparePayroll(as(clerk), '2026-11', { [a]: { additions: 1000, note: 'Target bonus' }, [peopleOf(ws)[1].id]: { deductions: 500, note: 'One day absent' } })
    const r = runsOf(ws)[0]
    const t = runTotals(run(r).items)
    // gross: 13,000 + 7,500 + 5,500; net: 26,000 − 1,980 insurance − 1,300 tax
    expect(t).toMatchObject({ people: 3, gross: 26000, insurance: 1980, tax: 1300, net: 22720, employer: 3375, bank: 17220, cash: 5500 })
    // the bank file waits for the approval, and HR can't approve their own payroll
    savePayrollSetup(as(clerk), { bank: '1110', template: { id: 'cib', name: 'CIB salaries', format: 'xlsx', header: true, columns: [{ header: 'Beneficiary Name', field: 'name' }, { header: 'IBAN', field: 'iban' }, { header: 'Amount', field: 'amount' }, { header: 'Currency', field: 'currency' }, { header: 'Narrative', field: 'text', text: 'Salary {month}' }] } })
    const tpl = ws.payrollSetup!.templates[0]
    expect(() => bankRows(ws, r, tpl, 'Nile', 'EGP')).toThrow(/Approve the payroll/)
    expect(() => approvePayroll(as(clerk), id)).toThrow(/Another person approves/)
    const ref = approvePayroll(as(owner), id)
    expect(ref).toBe('PAY-2026-0001')
    const je = ws.data.journal.find((j) => j.ref === ref)!
    expect(je.date).toBe('2026-11-30')
    // one black box: one line per account, totals only, no names, nothing per person
    expect(je.memo).toBe('Payroll 2026-11')
    expect(je.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([['5300', 26000, 0], ['5330', 3375, 0], ['2270', 0, 5355], ['2280', 0, 1300], ['2260', 0, 22720]])
    expect(JSON.stringify(ws.data.journal)).not.toMatch(/Ahmed|Mai|Sayed/)
    // the activity everyone may read names no one
    expect(JSON.stringify(ws.data.activity)).not.toMatch(/Ahmed|Mai|Sayed/)
    expect(accountBalance(ws, '2260')).toBe(-22720)
    expect(accountBalance(ws, '2270')).toBe(-(1980 + 3375))
    expect(accountBalance(ws, '2280')).toBe(-1300)
    expect(() => preparePayroll(as(clerk), '2026-11')).toThrow(/already approved/)

    // the bank file: the two paid by bank, in the bank's columns, adding up to the bank part
    const file = bankRows(ws, r, tpl, 'Nile', 'EGP')
    expect(file.header).toEqual(['Beneficiary Name', 'IBAN', 'Amount', 'Currency', 'Narrative'])
    expect(file.rows).toEqual([['Mai Hassan', ibanB, 6220, 'EGP', 'Salary 2026-11'], ['Ahmed Ali', ibanA, 11000, 'EGP', 'Salary 2026-11']])
    expect(file.total).toBe(17220)
    expect(bankCsv(file.header, file.rows).split('\r\n')[1]).toBe(`Mai Hassan,${ibanB},6220.00,EGP,Salary 2026-11`)

    // paid: the bank and the cash box, nothing left owed to the people
    payPayroll(as(clerk), id, { date: '2026-12-01' })
    expect(accountBalance(ws, '2260')).toBe(0)
    expect(accountBalance(ws, '1110')).toBe(100000 - 17220)
    expect(accountBalance(ws, '1100')).toBe(10000 - 5500)
    // the payment too: one total from the bank, one from the cash box
    expect(ws.data.journal.find((j) => j.ref === `${ref} PAID`)!.lines.map((l) => [l.account, l.debit, l.credit])).toEqual([['2260', 22720, 0], ['1110', 0, 17220], ['1100', 0, 5500]])
    expect(run(r).status).toBe('paid')
    expect(() => payPayroll(as(clerk), id, { date: '2026-12-01' })).toThrow(/already paid/)
    expect(booksHealth(ws, schema, '2026-11').filter((c) => c.blocking && !c.ok)).toEqual([])
  })

  it('through commands as on the server; someone without the right is refused', () => {
    const { ws } = setup()
    const out = applyCommand(ws, { userId: owner.id, isAdmin: true }, { name: 'access.saveRole', args: { id: 'role_hr', payroll: true } })
    const w = applyCommand(out.ws, { userId: clerk.id, isAdmin: false }, { name: 'payroll.saveEmployee', args: { name: 'Omar', pay_by: 'cash', basic: 6000 } }).ws
    expect(w.data.records.payroll_people).toHaveLength(1)
    expect(() => applyCommand(w, { userId: seller.id, isAdmin: false }, { name: 'payroll.prepare', args: { month: '2026-11' } })).toThrow(/payroll right/)
    // the right taken back: the role no longer reads payroll
    const back = applyCommand(w, { userId: owner.id, isAdmin: true }, { name: 'access.saveRole', args: { id: 'role_hr', payroll: false } }).ws
    expect(back.published!.roles.find((r) => r.id === 'role_hr')!.access.payroll_people).toBeUndefined()
  })
})
