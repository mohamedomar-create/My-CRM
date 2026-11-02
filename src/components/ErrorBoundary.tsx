// The crash screen (4.2a, UX-15): when a screen fails, say so plainly, keep the work saved on the server safe, and
// offer to go back, reload, or copy the details to send to support.
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Copy, RotateCcw } from 'lucide-react'
import { tr } from '../lib/i18n'
import { isStaleChunk } from '../lib/update'

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error?: Error; info?: string; copied?: boolean; key?: string }> {
  state: { error?: Error; info?: string; copied?: boolean; key?: string } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: { resetKey?: string }, state: { error?: Error; key?: string }) {
    // Moving to another page clears the crash, so one broken screen doesn't lock the whole app.
    if (props.resetKey !== state.key) return { key: props.resetKey, error: state.key === undefined ? state.error : undefined, info: undefined, copied: false }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
    this.setState({ info: info.componentStack ?? '' })
  }

  render() {
    const { error, info, copied } = this.state
    if (!error) return this.props.children
    const details = `${error.name}: ${error.message}\n${location.pathname}\n${new Date().toISOString()}\n${(error.stack ?? '').split('\n').slice(0, 8).join('\n')}${info ? `\n${info.split('\n').slice(0, 8).join('\n')}` : ''}`
    return (
      <div className="crash" role="alert">
        <div className="card stack">
          <h2 className="row" style={{ margin: 0 }}><AlertTriangle size={20} aria-hidden /> {tr('Something went wrong on this screen')}</h2>
          <p className="small" style={{ margin: 0 }}>{isStaleChunk(error) ? tr('A new version of Bonyan is out. Reload the page to use it; your saved work is safe on the server. If it still fails, check your internet connection.') : tr('Your saved work is safe on the server. Go back or reload the page; if it happens again, copy the details and send them to support.')}</p>
          <pre className="small mono" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 10, borderRadius: 'var(--r-md)', maxHeight: 160, overflow: 'auto', margin: 0 }}>{error.message}</pre>
          <div className="row">
            <button onClick={() => history.back()} className="secondary">{tr('Back')}</button>
            <button onClick={() => location.reload()}><RotateCcw size={15} aria-hidden /> {tr('Reload the page')}</button>
            <button className="ghost" onClick={() => void navigator.clipboard?.writeText(details).then(() => this.setState({ copied: true }), () => undefined)}><Copy size={15} aria-hidden /> {copied ? tr('Copied') : tr('Copy the details')}</button>
          </div>
        </div>
      </div>
    )
  }
}
