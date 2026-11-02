// One accessible dialog for the whole app (4.2a, UX-06): a modal labelled by its heading that takes the focus, keeps
// Tab inside, closes on Escape (unless it is busy), and gives the focus back to what opened it.
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The modal frame: the backdrop and the box (its first heading names it for screen readers). */
export function Modal({ onClose, busy, alert, children }: { onClose?: () => void; busy?: boolean; alert?: boolean; children: ReactNode }) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  const blocked = useRef(busy)
  useEffect(() => {
    close.current = onClose
    blocked.current = busy
  })
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const el = box.current
    if (!el) return
    const heading = el.querySelector('h1, h2, h3')
    if (heading) {
      if (!heading.id) heading.id = id
      el.setAttribute('aria-labelledby', heading.id)
    }
    const first = el.querySelector<HTMLElement>('[autofocus]') ?? el.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') ?? el.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? el).focus()
    function key(e: KeyboardEvent) {
      if (!el) return
      if (e.key === 'Escape' && close.current && !blocked.current) {
        e.stopPropagation()
        close.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null)
      if (!items.length) return
      const [a, z] = [items[0], items[items.length - 1]]
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      if (before && document.contains(before)) before.focus()
    }
  }, [id])
  return (
    <>
      <div className="overlay" onClick={busy ? undefined : onClose} />
      <div className="modal">
        <div ref={box} role={alert ? 'alertdialog' : 'dialog'} aria-modal="true" tabIndex={-1} style={{ display: 'contents' }}>{children}</div>
      </div>
    </>
  )
}

/** A dialog with its title and content in a card. */
export function Dialog({ title, onClose, children, wide, busy, alert }: { title: ReactNode; onClose?: () => void; children: ReactNode; wide?: boolean; busy?: boolean; alert?: boolean }) {
  return (
    <Modal onClose={onClose} busy={busy} alert={alert}>
      <div className={`card stack dialog${wide ? ' wide' : ''}`}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {children}
      </div>
    </Modal>
  )
}
