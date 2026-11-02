// Whether printed documents show Arabic and English together (2A, ACCO-20), remembered per viewer.
import { useState } from 'react'

const KEY = 'bonyan.printBoth'

function stored() {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

/** Whether documents print in both languages (on unless the viewer turned it off). */
export function usePrintBoth() {
  const [both, setBoth] = useState(stored)
  const change = (on: boolean) => {
    setBoth(on)
    try {
      localStorage.setItem(KEY, on ? '1' : '0')
    } catch {
      /* the choice just isn't remembered */
    }
  }
  return [both, change] as const
}
