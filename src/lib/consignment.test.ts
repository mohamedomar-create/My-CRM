// Consignment (the handmade template): an invoice to a stockist for pieces on its shelf takes them off the shelf;
// voiding it or a credit note that takes pieces back puts them back. The books stay as they were (the pieces are the
// company's stock until sold, and the invoice takes them out of stock).
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, creditNote, findRecord, onHand, onShelf, placementList, postDocument, voidDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { translateMessage } from './i18n'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Naia Design House'), taxId: '1', industry: 'handmade' }
  const schema = generateSchema(templateById('handmade'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const pl = placementList(schema)!
  const vase = createRecord(ctx, mod('products'), { name: 'Blue vase', sku: 'V1', price: 1000, cost: 400, vat_rate: 14, track_stock: true })
  const bowl = createRecord(ctx, mod('products'), { name: 'Clay bowl', sku: 'B1', price: 500, cost: 150, vat_rate: 14, track_stock: true })
  const museum = createRecord(ctx, mod('accounts'), { name: 'Museum shop', terms: 'consignment', commission: 30 })
  const store = createRecord(ctx, mod('accounts'), { name: 'Concept store', terms: 'consignment', commission: 35 })
  const artisan = createRecord(ctx, mod('suppliers'), { name: 'Workshop' })
  const bill = createRecord(ctx, mod('purchases'), { supplier: artisan.id, date: '2026-01-02' }, {
    lines: [{ id: uid('l'), product: vase.id, description: 'Blue vase', qty: 20, price: 400, discount: 0, vat: 14 }, { id: uid('l'), product: bowl.id, description: 'Clay bowl', qty: 20, price: 150, discount: 0, vat: 14 }],
  })
  postDocument(ctx, bill)
  const place = (stockist: string, piece: string, date: string, qty: number) => createRecord(ctx, pl.module.id, { name: `Placement ${date}`, stockist, piece, placed_on: date, qty_placed: qty, shelf_price: 1000, commission: 30, status: 'on_the_shelf' })
  const invoice = (customer: string, lines: { product: string; qty: number; price: number }[], date = '2026-02-01') => {
    const inv = createRecord(ctx, mod('invoices'), { customer, date }, { lines: lines.map((l) => ({ id: uid('l'), product: l.product, description: 'Piece', qty: l.qty, price: l.price, discount: 0, vat: 14 })) })
    postDocument(ctx, inv)
    return inv
  }
  return { ws, schema, ctx, pl, vase, bowl, museum, store, place, invoice }
}

describe('consignment: pieces on stockists’ shelves', () => {
  it('finds the placements list in the handmade template', () => {
    const { pl } = setup()
    expect(pl).toMatchObject({ party: 'stockist', piece: 'piece' })
    expect(pl.module.id).toBe('m_placements')
  })

  it('an invoice to the stockist takes the sold pieces off its shelf, the oldest placement first', () => {
    const { ws, ctx, vase, museum, store, place, invoice } = setup()
    const first = place(museum.id, vase.id, '2026-01-10', 3)
    const second = place(museum.id, vase.id, '2026-01-20', 5)
    const other = place(store.id, vase.id, '2026-01-05', 4)
    const inv = invoice(museum.id, [{ product: vase.id, qty: 4, price: 700 }])
    // 3 from the first placement (now sold out), 1 from the second; the concept store's shelf is untouched.
    expect(first.values).toMatchObject({ qty_sold: 3, qty_on_shelf: 0, status: 'sold_out' })
    expect(second.values).toMatchObject({ qty_sold: 1, qty_on_shelf: 4, status: 'partly_sold' })
    expect(other.values.qty_sold ?? 0).toBe(0)
    expect(inv.values.consigned).toEqual([{ placement: first.id, product: vase.id, qty: 3 }, { placement: second.id, product: vase.id, qty: 1 }])
    // The stock leaves the books once, through the invoice.
    expect(onHand(ws, vase.id)).toBe(16)
    expect(ws.data.activity.some((a) => a.record === first.id && /3 sold on invoice/.test(a.text))).toBe(true)
    expect(ctx.ws.data.activity.some((a) => a.record === inv.id && /took 4 pieces off/.test(a.text))).toBe(true)
  })

  it('sells beyond the shelf as an outright sale, and leaves other pieces and taken-back placements alone', () => {
    const { vase, bowl, museum, place, invoice } = setup()
    const shelf = place(museum.id, vase.id, '2026-01-10', 2)
    const back = place(museum.id, bowl.id, '2026-01-10', 5)
    back.values.status = 'taken_back'
    const inv = invoice(museum.id, [{ product: vase.id, qty: 5, price: 700 }, { product: bowl.id, qty: 2, price: 350 }])
    expect(shelf.values).toMatchObject({ qty_sold: 2, status: 'sold_out' })
    expect(back.values.qty_sold ?? 0).toBe(0)
    expect(inv.values.consigned).toEqual([{ placement: shelf.id, product: vase.id, qty: 2 }])
  })

  it('a customer without placements: nothing changes', () => {
    const { ctx, vase, store, invoice } = setup()
    const inv = invoice(store.id, [{ product: vase.id, qty: 1, price: 1000 }])
    expect(inv.values.consigned).toBeUndefined()
    expect(ctx.ws.data.activity.some((a) => /off the stockist/.test(a.text))).toBe(false)
  })

  it('a credit note that takes pieces back puts them back on the shelf, the latest first; voiding it takes them off again', () => {
    const { ctx, vase, museum, place, invoice } = setup()
    const first = place(museum.id, vase.id, '2026-01-10', 3)
    const second = place(museum.id, vase.id, '2026-01-20', 5)
    const inv = invoice(museum.id, [{ product: vase.id, qty: 5, price: 700 }])
    expect([first.values.qty_sold, second.values.qty_sold]).toEqual([3, 2])
    const cn = creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 3 }], date: '2026-02-03', reason: 'Customer returned them to the shop' })
    expect([first.values.qty_sold, second.values.qty_sold]).toEqual([2, 0])
    expect(second.values.status).toBe('on_the_shelf')
    expect(first.values.status).toBe('partly_sold')
    expect(onShelf(first) + onShelf(second)).toBe(6)
    // A price reduction (nothing comes back) leaves the shelves as they are.
    creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 1, price: 100 }], date: '2026-02-04', reason: 'Price agreed lower', restock: false })
    expect([first.values.qty_sold, second.values.qty_sold]).toEqual([2, 0])
    voidDocument(ctx, findRecord(ctx.ws, cn.id)!)
    expect([first.values.qty_sold, second.values.qty_sold]).toEqual([3, 2])
  })

  it('voiding the invoice puts every piece back on its shelf', () => {
    const { ctx, vase, museum, place, invoice } = setup()
    const shelf = place(museum.id, vase.id, '2026-01-10', 3)
    const inv = invoice(museum.id, [{ product: vase.id, qty: 3, price: 700 }])
    expect(shelf.values.status).toBe('sold_out')
    voidDocument(ctx, inv)
    expect(shelf.values).toMatchObject({ qty_sold: 0, qty_on_shelf: 3, status: 'on_the_shelf' })
    expect(inv.values.consigned).toEqual([])
  })

  it('says what it did on each placement, in Arabic too', () => {
    expect(translateMessage('ar', '3 sold on invoice INV-2026-0001')).toBe('بيع 3 في الفاتورة INV-2026-0001')
    expect(translateMessage('ar', 'took 4 pieces off the stockist’s shelf')).toBe('سحب 4 قطعة من رف منفذ البيع')
    expect(translateMessage('ar', '2 back on the shelf (INV-2026-0001 voided)')).toBe('عاد 2 إلى الرف (أُلغي INV-2026-0001)')
  })

  it('other industries have no placements list and are not affected', () => {
    const answers = { ...emptyAnswers('Test Co'), taxId: '1' }
    expect(placementList(generateSchema(templateById('distribution'), answers))).toBeNull()
  })
})
