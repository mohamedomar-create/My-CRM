// A product's photo: chosen in any picture format, made small in the browser (a WebP of at most 800 px), kept in
// Storage under the company's folder; the product holds only the path. Shown on the product, in the list and at the
// shop counter, from a signed link that lasts an hour.
import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Package, RefreshCw, Trash2 } from 'lucide-react'
import type { Rec } from '../lib/types'
import { can } from '../lib/engine'
import { productPhotoUrl, productPhotoUrlNow, removeProductPhotoFile, uploadProductPhoto } from '../lib/store'
import { msg, tr } from '../lib/i18n'
import { showToast, useApp } from './useApp'

/** The photo's link, fetched together with every other photo on the screen. */
function usePhotoUrl(path: string | undefined) {
  const [got, setGot] = useState<{ path: string; url: string | null } | null>(() => (path ? { path, url: productPhotoUrlNow(path) } : null))
  useEffect(() => {
    let live = true
    if (path) void productPhotoUrl(path).then((url) => { if (live) setGot({ path, url }) })
    return () => { live = false }
  }, [path])
  return path && got?.path === path ? got.url : null
}

/** A small square photo (or a quiet placeholder) for lists and the shop counter. */
export function PhotoThumb({ path, size = 36, alt = '' }: { path?: string; size?: number; alt?: string }) {
  const url = usePhotoUrl(path)
  const [broken, setBroken] = useState('')
  return (
    <span className="photo-thumb" style={{ width: size, height: size }} aria-hidden={alt ? undefined : true}>
      {url && broken !== url ? <img src={url} alt={alt} loading="lazy" decoding="async" width={size} height={size} onError={() => setBroken(url)} /> : <Package size={Math.round(size * 0.45)} />}
    </span>
  )
}

/** The photo on the product's own page: add, change or remove it (by click or by dropping a picture on it). */
export function ProductPhotoCard({ rec }: { rec: Rec }) {
  const { ws, schema, user, act } = useApp()
  const link = usePhotoUrl(rec.image)
  const [broken, setBroken] = useState('')
  const url = link && broken !== link ? link : null
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [saved, setSaved] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const editable = can({ schema, user }, rec.module, 'edit')

  async function put(file: File | undefined) {
    if (!file || busy) return
    if (file.type && !file.type.startsWith('image/')) return showToast({ kind: 'error', text: tr('Choose a picture (JPG, PNG, WebP, GIF…)') })
    setBusy(true)
    setSaved('')
    const old = rec.image
    try {
      const up = await uploadProductPhoto(ws.id, rec.id, file)
      if (act('product.image', { id: rec.id, path: up.path }, old ? tr('Photo changed') : tr('Photo added')) === undefined) {
        await removeProductPhotoFile(up.path)
      } else {
        if (old) void removeProductPhotoFile(old)
        setSaved(tr('Kept as a small picture: {w} × {h} px, {kb} KB', { w: up.width, h: up.height, kb: Math.max(1, Math.round(up.bytes / 1024)) }))
      }
    } catch (e) {
      showToast({ kind: 'error', text: msg((e as Error).message) })
    }
    setBusy(false)
  }

  function remove() {
    const old = rec.image
    if (act('product.image', { id: rec.id, path: null }, tr('Photo removed')) !== undefined) void removeProductPhotoFile(old)
    setSaved('')
  }

  return (
    <div className="card stack photo-card">
      <div
        className={`photo-drop${over ? ' over' : ''}${url ? ' has' : ''}`}
        onDragOver={(e) => { if (editable) { e.preventDefault(); setOver(true) } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (editable) void put(e.dataTransfer.files?.[0]) }}
      >
        {url ? <img src={url} alt={tr('Photo of the product')} decoding="async" onError={() => setBroken(url)} /> : (
          <div className="photo-empty">
            <ImagePlus size={28} aria-hidden />
            <span className="small muted">{editable ? tr('Add a photo: choose or drop any picture') : tr('No photo yet')}</span>
          </div>
        )}
        {busy && <div className="photo-busy">{tr('Making it small…')}</div>}
      </div>
      {editable && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className={rec.image ? 'secondary small' : 'small'} disabled={busy} onClick={() => input.current?.click()}>
            {rec.image ? <><RefreshCw size={14} /> {tr('Change photo')}</> : <><ImagePlus size={14} /> {tr('Add a photo')}</>}
          </button>
          {rec.image && <button type="button" className="ghost small" disabled={busy} onClick={remove}><Trash2 size={14} /> {tr('Remove')}</button>}
          <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { void put(e.target.files?.[0]); e.target.value = '' }} />
        </div>
      )}
      <span className="tiny muted">{saved || tr('Any picture works; it is saved as a small, sharp copy so the company’s data stays light.')}</span>
    </div>
  )
}
