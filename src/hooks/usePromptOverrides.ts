import { useState } from 'react'
import { persistPromptOverrides } from '../engine/persistence'
import { promptOverrides, setPromptOverrides, type PromptFile } from '../prompts'

// Puts these edits to the prompt files in place of any before, from the next
// request, and keeps them in this browser. Returns the edits kept.
export function applyPromptOverrides(next: Readonly<Record<string, string>>): Record<string, string> {
  setPromptOverrides(next)
  const kept = promptOverrides()
  persistPromptOverrides(kept)
  return kept
}

// The player's edits to the prompt files, for the Prompts tab. Resetting a
// file drops its edit.
export function usePromptOverrides() {
  const [edits, setEdits] = useState(promptOverrides)
  const apply = (next: Record<string, string>) => setEdits(applyPromptOverrides(next))

  return {
    edits,
    save: (file: PromptFile, text: string) => apply({ ...edits, [file]: text }),
    reset: (file: PromptFile) => apply(Object.fromEntries(Object.entries(edits).filter(([name]) => name !== file))),
    resetAll: () => apply({}),
  }
}
