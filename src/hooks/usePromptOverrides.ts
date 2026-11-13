import { useState } from 'react'
import { persistPromptOverrides } from '../engine/persistence'
import { promptOverrides, setPromptOverrides, type PromptFile } from '../prompts'

// The player's edits to the prompt files: each applies from the next request
// and is kept in this browser. Resetting a file drops its edit.
export function usePromptOverrides() {
  const [edits, setEdits] = useState(promptOverrides)

  function apply(next: Record<string, string>) {
    setPromptOverrides(next)
    const kept = promptOverrides()
    persistPromptOverrides(kept)
    setEdits(kept)
  }

  return {
    edits,
    save: (file: PromptFile, text: string) => apply({ ...edits, [file]: text }),
    reset: (file: PromptFile) => apply(Object.fromEntries(Object.entries(edits).filter(([name]) => name !== file))),
    resetAll: () => apply({}),
  }
}
