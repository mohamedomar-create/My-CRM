// "Ask Nasq360" on the dashboard: a question in English or Arabic, answered at once from the books (no AI, nothing
// leaves the device). What it doesn't understand goes to the AI with the company's figures (not its records), when the
// AI is switched on; otherwise it says which questions it knows.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useApp } from './useApp'
import { money, todayISO } from '../lib/engine'
import { getLang, tr } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { answer, factsForAi, type Answer } from '../lib/ask'

const EXAMPLES = ['This month vs last month', 'Who owes us the most?', 'Cash in the coming weeks', 'Best sellers this month', 'What should I watch?']
const MONEY_KEYS = new Set(['a', 'b', 'd', 'e'])

export function AskBox() {
  const { ws, schema } = useApp()
  const [q, setQ] = useState('')
  const [a, setA] = useState<Answer | null>(null)
  const [ai, setAi] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const cur = schema.company.currency
  const fmt = (ans: Answer, v: Record<string, string | number> = {}) => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === 'number' && ans.money && MONEY_KEYS.has(k) ? money(x, cur) : x]))
  const ask = async (question: string) => {
    setQ(question); setA(null); setAi(null); setError('')
    const local = answer(ws, schema, question, todayISO())
    if (local) return setA(local)
    setBusy(true)
    const { data, error: e } = await supabase.functions.invoke<{ answer: string }>('ask', { body: { workspace: ws.id, lang: getLang(), question, facts: factsForAi(ws, schema, todayISO()) } })
    setBusy(false)
    if (data?.answer) return setAi(data.answer)
    const status = (e as { context?: { status?: number } } | null)?.context?.status
    setError(status === 503 ? tr('I can answer questions like the ones below. For anything else, an admin can switch on the AI.') : tr('I didn’t understand that. Try one of the questions below.'))
  }
  return (
    <div className="card stack ask" style={{ gap: 8, marginBottom: 14 }}>
      <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (q.trim()) void ask(q.trim()) }}>
        <Sparkles size={18} color="var(--primary)" aria-hidden />
        <input aria-label={tr('Ask about your business')} placeholder={tr('Ask about your business… e.g. this month vs last')} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button disabled={busy || !q.trim()}>{busy ? tr('Thinking…') : tr('Ask')}</button>
      </form>
      {!a && !ai && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{EXAMPLES.map((x) => <button key={x} type="button" className="ghost small chip" onClick={() => void ask(tr(x))}>{tr(x)}</button>)}</div>}
      {error && <p className="small muted" style={{ margin: 0 }}>{error}</p>}
      {ai && <div className="stack" style={{ gap: 4 }}><p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }} dir="auto">{ai}</p><span className="tiny muted">{tr('Answered by the AI from your figures. Check important numbers in the reports.')}</span></div>}
      {a && (
        <div className="stack" style={{ gap: 6 }}>
          {a.lines.map((l, i) => <p key={i} className={i === 0 ? '' : 'small'} style={{ margin: 0 }}><b>{tr(l.key, fmt(a, l.values))}</b></p>)}
          {a.rows && a.rows.length > 0 && (
            <table className="data"><tbody>{a.rows.map((r, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td className="small">{r.link ? <Link to={r.link}>{tr(r.label)}</Link> : tr(r.label)}</td>
                <td className="num small">{a.money && a.intent !== 'lowStock' && !(a.intent === 'compare' && i === 4) ? money(r.value, cur) : r.value}</td>
                <td className="tiny muted" dir="ltr">{r.note ? tr(r.note) : ''}</td>
              </tr>
            ))}</tbody></table>
          )}
          <button type="button" className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => { setA(null); setQ('') }}>{tr('Ask something else')}</button>
        </div>
      )}
    </div>
  )
}
