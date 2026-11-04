// "Try it on your data": an automation run on a copy of the company's data (sample data when there is none yet), showing
// for each record what it would do or why it would skip it. Nothing is saved.
import { useMemo, useState } from 'react'
import { AlertTriangle, Bell, CheckCircle2, FlaskConical, MinusCircle, Pencil, Play } from 'lucide-react'
import { useDraft } from './useDraft'
import { usePreviewWorkspace } from './ReportsTab'
import { currentUser, useStore } from '../lib/store'
import { list, recordTitle } from '../lib/engine'
import type { User } from '../lib/types'
import type { WorkflowDef } from '../lib/schema'
import { testWorkflow, type EffectKind, type SandboxResult } from '../lib/sandbox'
import { useLang } from '../lib/i18n'

const ICON: Record<EffectKind, typeof Bell> = { task: CheckCircle2, field: Pencil, note: Bell, skipped: MinusCircle, error: AlertTriangle }

export function AutomationTest({ wf }: { wf: WorkflowDef }) {
  const { ws, schema } = useDraft()
  const me = useStore((s) => currentUser(s)) as User
  const { tr } = useLang()
  const { preview, sample } = usePreviewWorkspace(ws, schema)
  const [target, setTarget] = useState('')
  const [out, setOut] = useState<SandboxResult | null>(null)
  const records = useMemo(() => list(preview, wf.module).slice(0, 300), [preview, wf.module])
  const run = () => setOut(testWorkflow(preview, schema, me, wf, { recordId: target || undefined, tr }))
  const ran = out?.rows.filter((r) => r.runs) ?? []
  const skipped = out?.rows.filter((r) => !r.runs) ?? []

  return (
    <div className="card auto-test">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}><FlaskConical size={16} /> {tr('Try it on your data')}</h3>
        <span className="pill gray tiny">{tr('Nothing is saved: it runs on a copy')}</span>
      </div>
      <p className="tiny muted" style={{ margin: '6px 0 10px' }}>{sample ? tr('There is no real data yet, so it runs on sample records.') : tr('Runs on a copy of your real records, as if its event had just happened to them. Changes you haven’t published are included.')}</p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <select value={target} onChange={(e) => { setTarget(e.target.value); setOut(null) }} style={{ width: 'auto', maxWidth: 320 }} aria-label={tr('Records to try it on')}>
          <option value="">{tr('Every record ({a})', { a: records.length })}</option>
          {records.map((r) => <option key={r.id} value={r.id}>{recordTitle(preview, schema, r)}</option>)}
        </select>
        <button className="primary" onClick={run} disabled={!wf.actions.length}><Play size={15} /> {tr('Run the test')}</button>
        {!wf.actions.length && <span className="tiny muted">{tr('Add an action first.')}</span>}
      </div>
      {out && (
        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          <div className={out.runs ? 'info' : 'note'}>
            <b>{tr('It would run on {a} of {b} records.', { a: out.runs, b: out.checked })}</b>{' '}
            {[
              out.totals.task && tr('{a} tasks created', { a: out.totals.task }),
              out.totals.field && tr('{a} fields changed', { a: out.totals.field }),
              out.totals.note && tr('{a} notifications', { a: out.totals.note }),
              out.totals.skipped && tr('{a} steps skipped', { a: out.totals.skipped }),
              out.totals.error && tr('{a} steps would fail', { a: out.totals.error }),
            ].filter(Boolean).join(' · ')}
          </div>
          {ran.map((r) => (
            <div key={r.id} className="auto-test-row">
              <b className="small">{r.title}</b>
              {r.effects.length === 0 && <span className="tiny muted">{tr('Nothing would change')}</span>}
              {r.effects.map((e, i) => { const I = ICON[e.kind]; return <span key={i} className={`auto-effect ${e.kind}`}><I size={13} /> {tr(e.text)}</span> })}
            </div>
          ))}
          {skipped.length > 0 && (
            <details>
              <summary className="small">{tr('Not run on {a} records, and why', { a: out.checked - out.runs })}</summary>
              <ul className="auto-skips">
                {skipped.map((r) => <li key={r.id} className="small"><b>{r.title}</b> · <span className="muted">{r.why}</span></li>)}
              </ul>
            </details>
          )}
          {out.more > 0 && <span className="tiny muted">{tr('…and {a} more records not shown', { a: out.more })}</span>}
        </div>
      )}
    </div>
  )
}
