import { createContext } from 'react'

/** The landing page's look: white (the default) or dark; its screenshots follow it. */
export const LandingLook = createContext<'light' | 'dark'>('light')
