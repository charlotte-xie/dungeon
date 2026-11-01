import { useEffect } from 'react'

// Tells the tab bar whether a tab holds unsaved edits, so leaving it can ask
// first. A tab that closes has nothing left to lose.
export function useReportDirty(dirty: boolean, onDirtyChange: (dirty: boolean) => void) {
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
}
