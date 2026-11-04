import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** Writes precache.json: every file of the build, so the service worker can keep them all for offline use. */
function precache(): Plugin {
  return {
    name: 'precache-list',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => `/${f}`)
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), precache()],
})
