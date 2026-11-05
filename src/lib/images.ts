// Product photos, made small in the browser before they leave it: any picture the browser can open (JPG, PNG, WebP,
// GIF, AVIF, BMP, SVG; HEIC where the phone's browser reads it) becomes one WebP of at most 800 px on its longer side
// and 300 KB, usually 20 to 80 KB. Only that file is uploaded, to Storage; the product keeps its path. Browsers that
// can't write WebP send a JPEG of the same size instead.
import { EngineError } from './engine'

export const PHOTO = { side: 800, maxBytes: 300 * 1024, quality: 0.82, lowest: 0.45 }

/** The size that fits inside a square of `max`, never larger than the picture itself. */
export function fitInside(w: number, h: number, max: number) {
  const k = Math.min(1, max / Math.max(w, h, 1))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

/** The qualities tried, best first, until the file is small enough. */
export function qualitySteps(start = PHOTO.quality, lowest = PHOTO.lowest) {
  const out: number[] = []
  for (let q = start; q >= lowest - 1e-9; q -= 0.12) out.push(Math.round(q * 100) / 100)
  return out
}

async function open(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { img: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() }
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await img.decode()
      return { img, w: img.naturalWidth || 800, h: img.naturalHeight || 800, done: () => URL.revokeObjectURL(url) }
    } catch {
      URL.revokeObjectURL(url)
      throw new EngineError('This picture can’t be opened here. Try a JPG, PNG or WebP (a phone’s HEIC photo can be shared as JPG first).')
    }
  }
}

const encode = (canvas: HTMLCanvasElement, type: string, q: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q))

/** Any picture in, one small WebP (or JPEG) out. */
export async function toSmallPhoto(file: Blob): Promise<{ blob: Blob; ext: 'webp' | 'jpg'; width: number; height: number }> {
  if (file.size > 40 * 1024 * 1024) throw new EngineError('This picture is larger than 40 MB: choose a smaller one')
  const src = await open(file)
  try {
    let side = PHOTO.side
    for (let round = 0; round < 3; round++) {
      const { w, h } = fitInside(src.w, src.h, side)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const c = canvas.getContext('2d')
      if (!c) throw new EngineError('This browser can’t prepare pictures')
      c.imageSmoothingQuality = 'high'
      c.drawImage(src.img, 0, 0, w, h)
      let webp = true
      for (const q of qualitySteps()) {
        let blob = webp ? await encode(canvas, 'image/webp', q) : null
        if (!blob || blob.type !== 'image/webp') {
          webp = false
          // JPEG has no transparency: put the picture on white first
          c.globalCompositeOperation = 'destination-over'
          c.fillStyle = '#fff'
          c.fillRect(0, 0, w, h)
          c.globalCompositeOperation = 'source-over'
          blob = await encode(canvas, 'image/jpeg', q)
        }
        if (blob && blob.size <= PHOTO.maxBytes) return { blob, ext: webp ? 'webp' : 'jpg', width: w, height: h }
      }
      side = Math.round(side * 0.75)
    }
    throw new EngineError('This picture couldn’t be made small enough. Try another one.')
  } finally {
    src.done()
  }
}
