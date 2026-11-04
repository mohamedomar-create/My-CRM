// "Install on this phone": shown when the browser offers to install the app (Android, Chrome, Edge), or, on an iPhone
// or iPad, how to add it from Safari's Share menu. Hidden once the app runs installed.
import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { tr } from '../lib/i18n'

type Prompt = Event & { prompt: () => Promise<void> }

export function InstallApp() {
  const installed = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone)
  const [prompt, setPrompt] = useState<Prompt | undefined>(() => (window as unknown as { installPrompt?: Prompt }).installPrompt)
  const [help, setHelp] = useState(false)
  useEffect(() => {
    const on = () => setPrompt((window as unknown as { installPrompt?: Prompt }).installPrompt)
    window.addEventListener('installable', on)
    return () => window.removeEventListener('installable', on)
  }, [])
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  if (installed || (!prompt && !ios)) return null
  return (
    <div className="sidebar-small">
      <button className="ghost small" onClick={() => { if (prompt) void prompt.prompt(); else setHelp(!help) }}><Smartphone size={14} /> {tr('Install on this phone')}</button>
      {help && <p className="tiny" style={{ margin: '4px 0 0' }}>{tr('In Safari, tap Share, then “Add to Home Screen”.')}</p>}
    </div>
  )
}

/** A strip while the app shows the copy kept on this device because there is no connection. */
export function OfflineStrip({ savedAt }: { savedAt: string }) {
  return <div className="note" role="status" style={{ margin: 0, borderRadius: 0 }}>{tr('You are offline: this is the copy kept on this device from {a}. You can look at everything; changes can be made when you are back online.', { a: new Date(savedAt).toLocaleString() })}</div>
}
