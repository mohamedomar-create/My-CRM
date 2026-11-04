import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { init } from './lib/store'
import { applyTheme } from './lib/theme'
import { reloadForUpdate } from './lib/update'
// The family fonts of Aql360: Poppins for Latin letters and figures, IBM Plex Sans Arabic for Arabic letters.
import '@fontsource/poppins/400.css'
import '@fontsource/poppins/500.css'
import '@fontsource/poppins/600.css'
import '@fontsource/poppins/700.css'
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import './styles.css'

applyTheme()
// A file a screen needs has gone because a new version went live: reload once to get it.
window.addEventListener('vite:preloadError', (e) => { if (reloadForUpdate()) e.preventDefault() })
void init()
// installable and opens offline (production builds only: in development every file changes all the time)
if (import.meta.env.PROD && 'serviceWorker' in navigator) window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
// the browser offers to install: kept so the app can show its own "Install" button
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); (window as unknown as { installPrompt?: Event }).installPrompt = e; window.dispatchEvent(new Event('installable')) })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
