// The one way a screen says "nothing here yet": an icon in the area's colour (or the list's own), what this place is
// for in a line, and the step that fills it. A search that finds nothing says so, and offers to clear it.
import type { ReactNode } from 'react'

export function EmptyState({ icon, title, text, action, color, compact }: { icon: ReactNode; title: string; text?: string; action?: ReactNode; color?: string; compact?: boolean }) {
  return (
    <div className={`empty-state${compact ? ' compact' : ''}`} role="status">
      <div className="empty-ic" style={{ background: color ?? 'var(--area-tint)' }} aria-hidden>{icon}</div>
      <b className="empty-title">{title}</b>
      {text && <p className="empty-text">{text}</p>}
      {action && <div className="row" style={{ justifyContent: 'center' }}>{action}</div>}
    </div>
  )
}
