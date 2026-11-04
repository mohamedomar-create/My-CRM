// Scanning with the phone or laptop camera. Browsers that read barcodes themselves (Chrome on Android and computers)
// do it natively; others (iPhone) use a WebAssembly reader served by the app itself (no outside service), loaded only
// when the camera is first opened. A USB or Bluetooth scanner needs none of this: it types the code and presses Enter.
import { useEffect, useRef, useState } from 'react'
import { ScanLine, X } from 'lucide-react'
import { tr } from '../lib/i18n'

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code', 'data_matrix']
interface Detector { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

let made: Promise<Detector> | null = null
function detector(): Promise<Detector> {
  made ??= (async () => {
    const Native = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats: () => Promise<string[]> } }).BarcodeDetector
    if (Native) {
      const can = await Native.getSupportedFormats().catch(() => [] as string[])
      const formats = FORMATS.filter((f) => can.includes(f))
      if (formats.length) return new Native({ formats })
    }
    const [{ BarcodeDetector, setZXingModuleOverrides }, wasm] = await Promise.all([import('barcode-detector/ponyfill'), import('zxing-wasm/reader/zxing_reader.wasm?url')])
    setZXingModuleOverrides({ locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm.default : prefix + path) })
    return new BarcodeDetector({ formats: FORMATS as never }) as unknown as Detector
  })()
  made.catch(() => { made = null })
  return made
}

/** A button that opens the camera and hands over each code it reads (one, or one after another for a count). */
export function ScanButton({ onCode, continuous = false, small = false }: { onCode: (code: string) => void; continuous?: boolean; small?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={small ? 'ghost small' : 'secondary'} onClick={() => setOpen(true)} title={tr('Scan with the camera')}><ScanLine size={small ? 14 : 16} /> {tr('Scan')}</button>
      {open && <ScanDialog continuous={continuous} onCode={(c) => { onCode(c); if (!continuous) setOpen(false) }} onClose={() => setOpen(false)} />}
    </>
  )
}

function ScanDialog({ onCode, onClose, continuous }: { onCode: (code: string) => void; onClose: () => void; continuous: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [last, setLast] = useState('')
  const [typed, setTyped] = useState('')
  const handler = useRef(onCode)
  useEffect(() => { handler.current = onCode }, [onCode])
  useEffect(() => {
    let stream: MediaStream | undefined
    let stop = false
    let seen = { code: '', at: 0 }
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('none')
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stop) return
        const v = video.current!
        v.srcObject = stream
        await v.play()
        const d = await detector()
        while (!stop) {
          const found = v.readyState >= 2 ? await d.detect(v).catch(() => []) : []
          const code = found[0]?.rawValue?.trim()
          // the same code is read many times a second: hand it over once (again after 2 seconds, for a count)
          if (code && (code !== seen.code || Date.now() - seen.at > 2000)) {
            seen = { code, at: Date.now() }
            navigator.vibrate?.(60)
            setLast(code)
            handler.current(code)
          }
          await new Promise((r) => setTimeout(r, 200))
        }
      } catch (e) {
        setError((e as Error).name === 'NotAllowedError' ? tr('The camera wasn’t allowed. Allow it in the browser, or type the code below.') : tr('No camera can be used here. Type the code below, or use a USB scanner.'))
      }
    })()
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()) }
  }, [])
  return (
    <>
    <div className="overlay" onClick={onClose} />
    <div className="modal" role="dialog" aria-modal="true" aria-label={tr('Scan a barcode')} onClick={onClose}>
      <div className="card stack" style={{ gap: 10, maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2 style={{ margin: 0 }}><ScanLine size={17} /> {tr('Scan a barcode')}</h2><button className="ghost icon" aria-label={tr('Close')} onClick={onClose}><X size={16} /></button></div>
        {!error && <video ref={video} className="scan-video" muted playsInline />}
        {error && <p className="small" style={{ margin: 0 }}>{error}</p>}
        {last && <p className="small" style={{ margin: 0 }}>{continuous ? tr('Read: {c}. Keep scanning, or close when done.', { c: last }) : tr('Read: {c}', { c: last })}</p>}
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { onCode(typed.trim()); setTyped('') } }}>
          <input aria-label={tr('Or type the code')} placeholder={tr('Or type the code')} value={typed} onChange={(e) => setTyped(e.target.value)} />
          <button className="small">{tr('Add')}</button>
        </form>
      </div>
    </div>
    </>
  )
}
