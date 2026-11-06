// Messy workbooks as companies really keep them: the real table is found, every value cleaned, each sheet understood,
// and customers written three ways are recognised as one.
import { describe, expect, it } from 'vitest'
import { applyNames, classify, cleanDate, cleanNumber, groupNames, meaningOf, partyColumn, productsIn, tidySheet } from './messy'

describe('cleaning values', () => {
  it('reads amounts however they were typed', () => {
    expect(cleanNumber('EGP 1,200.50')).toBe(1200.5)
    expect(cleanNumber('1.234,56')).toBe(1234.56)
    expect(cleanNumber('(500)')).toBe(-500)
    expect(cleanNumber('500-')).toBe(-500)
    expect(cleanNumber('١٬٢٠٠ ج.م')).toBe(1200)
    expect(cleanNumber('14%')).toBe(14)
    expect(cleanNumber('12,5')).toBe(12.5)
    expect(cleanNumber('Delta')).toBeUndefined()
    expect(cleanNumber('')).toBeUndefined()
  })

  it('reads dates however they were typed, day first unless the column says otherwise', () => {
    expect(cleanDate('2026-11-05')).toBe('2026-11-05')
    expect(cleanDate('5/11/2026')).toBe('2026-11-05')
    expect(cleanDate('5/11/2026', true)).toBe('2026-05-11')
    expect(cleanDate('11/25/2026')).toBe('2026-11-25')
    expect(cleanDate('05.11.26')).toBe('2026-11-05')
    expect(cleanDate('٥/١١/٢٠٢٦')).toBe('2026-11-05')
    expect(cleanDate('46331')).toBe('2026-11-05')
    expect(cleanDate('5-Nov-2026')).toBe('2026-11-05')
    expect(cleanDate('Nov 5th, 2026')).toBe('2026-11-05')
    expect(cleanDate('5 نوفمبر 2026')).toBe('2026-11-05')
    expect(cleanDate('31/2/2026')).toBeUndefined()
    expect(cleanDate('Delta')).toBeUndefined()
  })

  it('knows header words in English and Arabic, however spelled', () => {
    expect(meaningOf('Customer Name')).toBe('customer')
    expect(meaningOf('اسم العميل')).toBe('customer')
    expect(meaningOf('Unit Price')).toBe('price')
    expect(meaningOf('سعر الوحدة')).toBe('price')
    expect(meaningOf('Invoice Date')).toBe('date')
    expect(meaningOf('الكميه')).toBe('qty')
    expect(meaningOf('Mobile')).toBe('phone')
    expect(meaningOf('Colour')).toBeUndefined()
  })
})

describe('finding the table in a messy sheet', () => {
  it('a sales report: title rows, a header, an invoice written once over its lines, a page-break header, totals', () => {
    const t = tidySheet({
      name: 'مبيعات أكتوبر',
      rows: [
        ['Nile Trading Co.', '', '', '', '', ''],
        ['Sales report – October 2026', '', '', '', '', ''],
        ['', '', '', '', '', ''],
        ['Invoice No', 'Date', 'Customer', 'Item', 'Qty', 'Unit Price'],
        ['INV-101', '5/10/2026', 'Delta Foods', 'Rice 5kg', '10', 'EGP 200'],
        ['', '', '', 'Oil 1L', '٢٠', '90.00'],
        ['INV-102', '12/10/2026', 'delta foods co.', 'Rice 5kg', '5', '1,200.50'],
        ['Invoice No', 'Date', 'Customer', 'Item', 'Qty', 'Unit Price'],
        ['INV-103', '20/10/2026', 'Cairo Hotel', 'Sugar', '3', '45'],
        ['Total', '', '', '', '38', ''],
      ],
    })
    expect(t.header).toEqual(['Invoice No', 'Date', 'Customer', 'Item', 'Qty', 'Unit Price'])
    expect(t.rows).toEqual([
      ['INV-101', '2026-10-05', 'Delta Foods', 'Rice 5kg', '10', '200'],
      ['INV-101', '2026-10-05', 'Delta Foods', 'Oil 1L', '20', '90'],
      ['INV-102', '2026-10-12', 'delta foods co.', 'Rice 5kg', '5', '1200.5'],
      ['INV-103', '2026-10-20', 'Cairo Hotel', 'Sugar', '3', '45'],
    ])
    expect(t.from).toEqual([5, 6, 7, 9])
    expect(t.skipped.map((s) => [s.row, s.why])).toEqual([[1, 'title'], [2, 'title'], [3, 'blank'], [8, 'header again'], [10, 'total']])
    expect(t.filled).toEqual([{ column: 'Invoice No', count: 1 }, { column: 'Date', count: 1 }, { column: 'Customer', count: 1 }])
    expect(t.fixed.dates).toBe(4)
    expect(classify(t)[0].kind).toBe('sales')
    expect(t.columns.map((c) => c.meaning)).toEqual(['number', 'date', 'customer', 'product', 'qty', 'price'])
  })

  it('a header split over two rows, and a sum row at the bottom without the word Total', () => {
    const t = tidySheet({
      name: 'Sheet1',
      rows: [
        ['Customer', '', 'Contact', ''],
        ['Name', 'City', 'Phone', 'Balance'],
        ['Delta Foods', 'Cairo', '0100 123 4567', '1,500'],
        ['Cairo Hotel', 'Giza', '0122 000 1111', '2,500'],
        ['Nile Pharmacy', 'Alexandria', '', '(250)'],
        ['', '', '', '3750'],
      ],
    })
    expect(t.header).toEqual(['Name', 'City', 'Phone', 'Balance'])
    expect(t.rows.map((r) => r[3])).toEqual(['1500', '2500', '-250'])
    expect(t.skipped.map((s) => s.why)).toEqual(['title', 'total'])
    expect(classify(t)[0].kind).toBe('balances')
  })

  it('a report grouped by customer: the heading rows become the customer of the rows under them', () => {
    const t = tidySheet({
      name: 'Statement',
      rows: [
        ['Date', 'Invoice', 'Item', 'Qty', 'Price'],
        ['Delta Foods', '', '', '', ''],
        ['2026-10-01', 'A1', 'Rice', '2', '200'],
        ['2026-10-03', 'A2', 'Oil', '1', '90'],
        ['Cairo Hotel', '', '', '', ''],
        ['2026-10-04', 'A3', 'Rice', '5', '200'],
      ],
    })
    expect(t.header[0]).toBe('Group')
    expect(t.rows.map((r) => r[0])).toEqual(['Delta Foods', 'Delta Foods', 'Cairo Hotel'])
    expect(t.columns[0].meaning).toBe('party')
    expect(t.skipped.map((s) => s.why)).toEqual(['heading', 'heading'])
  })

  it('a customer list where some rows have only a name keeps those rows', () => {
    const t = tidySheet({ name: 'العملاء', rows: [['الاسم', 'الهاتف', 'المحافظة'], ['شركة دلتا', '01001234567', 'القاهرة'], ['فندق القاهرة', '', ''], ['صيدلية النيل', '', '']] })
    expect(t.rows).toHaveLength(3)
    expect(classify(t)[0].kind).toBe('customers')
  })

  it('a product list, and products found inside a sales sheet with their last price', () => {
    const p = tidySheet({ name: 'Items', rows: [['Code', 'Item name', 'Category', 'Selling price'], ['R5', 'Rice 5kg', 'Food', '200'], ['O1', 'Oil 1L', 'Food', '90']] })
    expect(classify(p)[0].kind).toBe('products')
    const s = tidySheet({ name: 'Sales', rows: [['Date', 'Customer', 'Item', 'Qty', 'Price'], ['2026-10-01', 'Delta', 'Rice 5kg', '1', '190'], ['2026-10-02', 'Delta', 'Rice 5kg', '1', '200'], ['2026-10-02', 'Delta', 'Oil', '1', '90']] })
    expect(productsIn(s)).toEqual([{ name: 'Rice 5kg', price: 200 }, { name: 'Oil', price: 90 }])
    expect(partyColumn(s, 'sales')).toBe(1)
  })
})

describe('the same customer written differently', () => {
  it('groups spellings, prefers the record already in the system, and marks near spellings to confirm', () => {
    const groups = groupNames(['Delta Foods', 'delta foods co.', 'DELTA FOODS', 'Cairo Hotel', 'Cairo Hotell', 'شركة النيل للتجارة', 'النيل', 'Nile Pharmacy'], ['Nile Pharmacy Co'])
    const by = (n: string) => groups.find((g) => g.keep === n || g.others.includes(n))!
    expect(by('Delta Foods')).toMatchObject({ keep: 'Delta Foods', sure: true, rows: 3, existing: false })
    expect(by('Delta Foods').others.sort()).toEqual(['DELTA FOODS', 'delta foods co.'])
    expect(by('Cairo Hotell')).toMatchObject({ keep: 'Cairo Hotel', others: ['Cairo Hotell'], sure: false })
    expect(by('Nile Pharmacy')).toMatchObject({ keep: 'Nile Pharmacy Co', existing: true })
    expect(by('النيل').others.concat(by('النيل').keep)).toEqual(expect.arrayContaining(['شركة النيل للتجارة', 'النيل']))
  })

  it('writes the kept name into the sheet, confirmed guesses only', () => {
    const t = tidySheet({ name: 'Sales', rows: [['Customer', 'Item', 'Qty', 'Price'], ['Cairo Hotel', 'Rice', '1', '2'], ['Cairo Hotell', 'Rice', '1', '2'], ['delta foods co.', 'Oil', '1', '3'], ['Delta Foods', 'Oil', '1', '3']] })
    const groups = groupNames(t.rows.map((r) => r[0]))
    expect(applyNames(t, 0, groups).rows.map((r) => r[0])).toEqual(['Cairo Hotel', 'Cairo Hotell', 'Delta Foods', 'Delta Foods'])
    expect(applyNames(t, 0, groups, () => true).rows.map((r) => r[0])).toEqual(['Cairo Hotel', 'Cairo Hotel', 'Delta Foods', 'Delta Foods'])
  })
})
