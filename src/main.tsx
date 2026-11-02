import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { init } from './lib/store'
import { applyTheme } from './lib/theme'
import { reloadForUpdate } from './lib/update'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/cairo/400.css'
import '@fontsource/cairo/600.css'
import '@fontsource/cairo/700.css'
import '@fontsource/cairo/800.css'
import './styles.css'

applyTheme()
// A file a screen needs has gone because a new version went live: reload once to get it.
window.addEventListener('vite:preloadError', (e) => { if (reloadForUpdate()) e.preventDefault() })
void init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
