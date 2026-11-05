// On a product that is made in-house: its recipe (components per batch, what a batch makes, labour and overhead), what
// one unit costs to make, and its production orders: plan one (shows what is short), complete it, or take it back.
import { useState } from 'react'
import { Factory, Plus, Trash2, Undo2 } from 'lucide-react'
import { useApp } from './useApp'
import { can, canPost, findRecord, list, money, todayISO } from '../lib/engine'
import { productionOf, recipeOf, requirements, unitCostToMake } from '../lib/production'
import { moduleByRole } from '../lib/schema'
import type { Rec } from '../lib/types'
import { tr } from '../lib/i18n'
import { PickOrCreate } from './Fields'

export function RecipePanel({ rec }: { rec: Rec }) {
  const { ws, schema, user, act } = useApp()
  const recipe = recipeOf(ws, rec.id)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState(() => ({ yield: String(recipe?.yield ?? 1), labour: String(recipe?.labour ?? ''), items: (recipe?.items ?? []).map((i) => ({ product: i.product, qty: String(i.qty) })) }))
  const [qty, setQty] = useState('')
  const edit = can({ schema, user }, rec.module, 'edit')
  const finance = canPost({ schema, user })
  if (!rec.values.track_stock) return null
  if (!recipe && !edit) return null
  const cur = schema.company.currency
  const productsMod = moduleByRole(schema, 'products')
  // a component is goods kept in stock, and not the product itself; a missing raw material is created right here
  const notComponents = new Set([rec.id, ...(productsMod ? list(ws, productsMod.id).filter((p) => !p.values.track_stock).map((p) => p.id) : [])])
  const name = (id: string) => String(findRecord(ws, id)?.values.name ?? '')
  const orders = productionOf(ws, rec.id).slice(0, 10)
  const plan = Number(qty) > 0 ? requirements(ws, rec.id, Number(qty)) : []
  return (
    <div className="card stack" style={{ marginBottom: 14, gap: 8 }}>
      <div className="row between"><h2 style={{ margin: 0, fontSize: '1rem' }}><Factory size={16} /> {tr('Made in-house')}</h2>{edit && !editing && <button className="ghost small" onClick={() => setEditing(true)}>{recipe ? tr('Change the recipe') : tr('Add a recipe')}</button>}</div>
      {!editing && recipe && (
        <p className="small" style={{ margin: 0 }}>
          {tr('A batch of {n} takes', { n: recipe.yield })}: {recipe.items.map((i) => `${i.qty} × ${name(i.product)}`).join('، ')}{recipe.labour ? ` + ${tr('labour and overhead {a}', { a: money(recipe.labour, cur) })}` : ''}.{' '}
          <b>{tr('Cost to make one: {a}', { a: money(unitCostToMake(ws, schema, rec.id), cur) })}</b>
        </p>
      )}
      {!editing && !recipe && <p className="small muted" style={{ margin: 0 }}>{tr('Make this product from other products: add what goes into one batch.')}</p>}
      {editing && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="field" style={{ width: 150 }}>{tr('One batch makes')}<input inputMode="decimal" value={form.yield} onChange={(e) => setForm({ ...form, yield: e.target.value })} /></label>
            <label className="field" style={{ width: 200 }}>{tr('Labour and overhead per batch')}<input inputMode="decimal" value={form.labour} onChange={(e) => setForm({ ...form, labour: e.target.value })} placeholder="0" /></label>
          </div>
          {form.items.map((it, i) => (
            <div key={i} className="row" style={{ gap: 8, alignItems: 'end' }}>
              <div className="field grow">{tr('Component')}{productsMod && <PickOrCreate moduleId={productsMod.id} stock exclude={notComponents} value={it.product || undefined} label={tr('Component')} onChange={(id) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, product: id ?? '' } : x)) })} />}</div>
              <label className="field" style={{ width: 120 }}>{tr('Quantity')}<input inputMode="decimal" value={it.qty} onChange={(e) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} /></label>
              <button type="button" className="ghost icon" aria-label={tr('Remove')} onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="ghost small" onClick={() => setForm({ ...form, items: [...form.items, { product: '', qty: '' }] })}><Plus size={13} /> {tr('Add a component')}</button>
            <button className="small" onClick={() => { if (act('recipe.set', { product: rec.id, recipe: form.items.length ? { yield: Number(form.yield) || 1, labour: Number(form.labour) || 0, items: form.items.map((x) => ({ product: x.product, qty: Number(x.qty) })) } : null }, tr('Recipe saved')) !== undefined) setEditing(false) }}>{tr('Save')}</button>
            <button type="button" className="ghost small" onClick={() => setEditing(false)}>{tr('Cancel')}</button>
          </div>
        </div>
      )}
      {recipe && finance && !editing && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field" style={{ width: 140 }}>{tr('Make how many')}<input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
          <button disabled={!(Number(qty) > 0)} onClick={() => { if (act('production.plan', { product: rec.id, qty: Number(qty), date: todayISO() }, tr('Production order planned')) !== undefined) setQty('') }}>{tr('Plan production')}</button>
          {plan.length > 0 && <span className="small">{plan.map((r) => `${name(r.product)}: ${r.need}${r.short ? ` (${tr('short {n}', { n: r.short })})` : ''}`).join(' · ')}</span>}
        </div>
      )}
      {orders.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Production order')}</th><th>{tr('Date')}</th><th className="num">{tr('Quantity')}</th><th>{tr('Status')}</th><th className="num">{tr('Cost')}</th><th /></tr></thead>
            <tbody>{orders.map((o) => (
              <tr key={o.id}>
                <td className="mono">{o.number}</td><td>{o.date}</td><td className="num">{o.qty}</td>
                <td>{o.status === 'done' ? <span className="pill green">{tr('done')}</span> : o.status === 'planned' ? <span className="pill amber">{tr('planned')}</span> : <span className="pill gray">{tr('cancelled')}</span>}</td>
                <td className="num">{o.cost !== undefined && o.status === 'done' ? money(o.cost, cur) : ''}</td>
                <td className="row" style={{ gap: 4 }}>
                  {finance && o.status === 'planned' && <button className="success small" onClick={() => act('production.complete', { id: o.id, date: todayISO() }, tr('Made: the components left stock and the goods came in'))}>{tr('Complete')}</button>}
                  {finance && o.status !== 'cancelled' && <button className="ghost small" onClick={() => confirm(o.status === 'done' ? tr('Take back {a}? The components go back into stock and the goods made come out.', { a: o.number }) : tr('Cancel {a}?', { a: o.number })) && act('production.cancel', { id: o.id }, o.status === 'done' ? tr('Production taken back') : tr('Cancelled'))}><Undo2 size={13} /> {o.status === 'done' ? tr('Take back') : tr('Cancel')}</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
