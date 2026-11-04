// The steps of a document (Draft → Posted → Paid, or a quotation's) with the one thing to do next.
import { ArrowRight, Check, CheckCircle2, CircleSlash, AlertTriangle } from 'lucide-react'
import { useLang } from '../lib/i18n'
import type { Flow } from './docFlow'

export function DocFlow({ flow }: { flow: Flow }) {
  const { tr } = useLang()
  const Icon = flow.tone === 'ok' ? CheckCircle2 : flow.tone === 'warn' ? AlertTriangle : flow.tone === 'stopped' ? CircleSlash : ArrowRight
  return (
    <section className={`docflow ${flow.tone}`} aria-label={tr('Where this document is')}>
      <ol className="docflow-steps">
        {flow.steps.map((s, i) => (
          <li key={s.label} className={s.state} aria-current={s.state === 'cur' ? 'step' : undefined}>
            <span className="docflow-dot" aria-hidden>{s.state === 'done' ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
            <span className="docflow-label">{tr(s.label)}</span>
          </li>
        ))}
      </ol>
      <p className="docflow-next"><Icon size={15} aria-hidden className={flow.tone === "info" ? "flip" : undefined} /> <span>{tr(flow.next, flow.vars)}</span></p>
    </section>
  )
}
