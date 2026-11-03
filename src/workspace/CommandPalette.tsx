// Phase 4.2d (UX-10, SALE-14): Ctrl/⌘-K from anywhere. Find a record (by name, phone, number, SKU or tax number),
// go to a page, or start a new invoice, customer or deal, all from the keyboard.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Plus, Search } from 'lucide-react'
import { Modal } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { useApp } from './useApp'
import { can, canPost } from '../lib/engine'
import { searchRecords, normalize } from '../lib/search'
import { tr } from '../lib/i18n'
import { hasErp } from '../lib/scope'

const KEYS = { enter: 'Enter', esc: 'Esc' }

interface Item { id: string; group: string; label: string; why?: string; icon?: React.ReactNode; go: () => void }

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const { ws, schema, user } = useApp()
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const role = schema.roles.find((r) => r.id === user.roleId)
  const finance = canPost({ schema, user })
  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => { onClose(); nav(to) }
    const view = (m: string) => can({ schema, user }, m, 'view')
    const records = searchRecords(ws, schema, q, view, 8).map((h) => ({ id: h.rec.id, group: tr('Records'), label: h.title, why: h.why ? `${h.mod.singular} · ${h.why}` : h.mod.singular, icon: <Icon name={h.mod.icon} size={15} style={{ color: h.mod.color }} />, go: go(`/app/r/${h.rec.id}`) }))
    const pages: Item[] = [
      { id: 'p-home', group: tr('Go to'), label: tr('Dashboard'), go: go('/app') },
      ...schema.modules.filter((m) => view(m.id)).map((m) => ({ id: `p-${m.id}`, group: tr('Go to'), label: m.name, icon: <Icon name={m.icon} size={15} style={{ color: m.color }} />, go: go(`/app/m/${m.id}`) })),
      ...(finance && hasErp(schema) ? [{ id: 'p-acc', group: tr('Go to'), label: tr('Accounting'), go: go('/app/accounting') }, { id: 'p-plan', group: tr('Go to'), label: tr('Business plan'), go: go('/app/plan') }] : []),
      ...(role?.admin ? [{ id: 'p-team', group: tr('Go to'), label: tr('Team'), go: go('/app/team') }, { id: 'p-builder', group: tr('Go to'), label: tr('Customise system'), go: go('/builder') }] : []),
    ]
    const create: Item[] = schema.modules.filter((m) => can({ schema, user }, m.id, 'create')).map((m) => ({ id: `n-${m.id}`, group: tr('Create'), label: tr('New {what}', { what: m.singular.toLowerCase() }), icon: <Plus size={15} />, go: go(`/app/new/${m.id}`) }))
    const n = normalize(q)
    const fits = (x: Item) => !n || normalize(x.label).includes(n)
    return [...records, ...pages.filter(fits).slice(0, n ? 6 : 4), ...create.filter(fits).slice(0, n ? 6 : 4)]
  }, [q, ws, schema, user, finance, role, nav, onClose])
  function key(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    if (e.key === 'Enter' && items[active]) { e.preventDefault(); items[active].go() }
  }
  return (
    <Modal onClose={onClose}>
      <div className="card palette-box">
        <h2 className="sr-only">{tr('Search and go')}</h2>
        <div className="palette-search">
          <Search size={17} aria-hidden style={{ color: 'var(--muted)' }} />
          <input autoFocus role="combobox" aria-expanded aria-controls="palette-list" aria-activedescendant={items[active] ? `pal-${active}` : undefined} value={q} onChange={(e) => { setQ(e.target.value); setActive(0) }} onKeyDown={key} placeholder={tr('Search by name, phone, number, SKU or tax number, or type a page…')} dir="auto" />
        </div>
        <ul id="palette-list" role="listbox" className="palette-list">
          {items.map((x, i) => (
            <li key={x.id} role="presentation">
              {(i === 0 || items[i - 1].group !== x.group) && <div className="grp" aria-hidden>{x.group}</div>}
              <div id={`pal-${i}`} role="option" aria-selected={i === active} className={`item${i === active ? ' on' : ''}`} onClick={x.go} onMouseEnter={() => setActive(i)}>
                {x.icon ?? <ArrowRight size={15} aria-hidden />} <span>{x.label}</span>{x.why && <span className="why">{x.why}</span>}
              </div>
            </li>
          ))}
          {!items.length && <li className="muted small" style={{ padding: 12 }}>{tr('Nothing matches.')}</li>}
        </ul>
        <div className="tiny muted row" style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', gap: 12 }}><span><kbd>↑</kbd> <kbd>↓</kbd> {tr('move')}</span><span><kbd>{KEYS.enter}</kbd> {tr('open')}</span><span><kbd>{KEYS.esc}</kbd> {tr('close')}</span></div>
      </div>
    </Modal>
  )
}
