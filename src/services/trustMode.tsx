import { createContext, useContext } from 'react'
import type { TrustMode } from '../services/storage'

// Trust mode wraps the app and lets components decide how much detail to
// surface. 'detailed' is the existing exhaustive UI; 'simple' renders a
// stripped-down version with status badges and top-line summaries only.
//
// Components consume the mode via useTrustMode(); they decide what
// "simple" means for their content (often: hide rule prose, hide source
// dates, collapse multi-paragraph notes).

interface TrustModeContextValue {
  mode: TrustMode
  setMode: (mode: TrustMode) => void
}

export const TrustModeContext = createContext<TrustModeContextValue>({
  mode: 'detailed',
  setMode: () => {
    // no-op default; replaced by provider in App
  },
})

export function useTrustMode(): TrustModeContextValue {
  return useContext(TrustModeContext)
}

export function isSimple(mode: TrustMode): boolean {
  return mode === 'simple'
}
