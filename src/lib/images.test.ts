// Product photos are made small before upload: at most 800 px, never enlarged, tried at falling qualities.
import { describe, expect, it } from 'vitest'
import { fitInside, PHOTO, qualitySteps } from './images'

describe('product photos', () => {
  it('fit inside 800 px on the longer side, keeping the shape, never enlarged', () => {
    expect(fitInside(4032, 3024, PHOTO.side)).toEqual({ w: 800, h: 600 })
    expect(fitInside(1080, 1920, PHOTO.side)).toEqual({ w: 450, h: 800 })
    expect(fitInside(300, 200, PHOTO.side)).toEqual({ w: 300, h: 200 })
    expect(fitInside(0, 0, PHOTO.side)).toEqual({ w: 1, h: 1 })
  })
  it('are tried from good quality down to the lowest acceptable', () => {
    const q = qualitySteps()
    expect(q[0]).toBe(PHOTO.quality)
    expect(q.at(-1)!).toBeGreaterThanOrEqual(PHOTO.lowest)
    expect(q).toEqual([...q].sort((a, b) => b - a))
    expect(PHOTO.maxBytes).toBe(300 * 1024)
  })
})
