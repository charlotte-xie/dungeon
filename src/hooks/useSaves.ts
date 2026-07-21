import { useRef, useState } from 'react'
import {
  isSavedGameLike,
  loadStoredSaves,
  makeSaveId,
  normalizeSavedGame,
  persistSaves,
} from '../engine/persistence'
import {
  SAVE_FILE_MARKER,
  type SaveFile,
  type SaveFileV1,
  type SaveFileV2,
  type SavedGame,
  type SavedGameV1,
  type SavedGameV2,
} from '../engine/types'
import type { GameData } from './useGameController'

// Save-slot management: the list itself plus create/overwrite/load/delete and
// file import/export. Talks to the game controller through captureGame (deep
// copy of the current adventure) and restoreGame (replace it).
export function useSaves(game: {
  captureGame: () => GameData
  restoreGame: (save: SavedGame) => void
  hasProgress: boolean
}) {
  const [saves, setSaves] = useState<SavedGame[]>(() => loadStoredSaves())
  const savesRef = useRef(saves)

  function commitSaves(next: SavedGame[]) {
    savesRef.current = next
    setSaves(next)
    persistSaves(next)
  }

  function saveCurrentGame(name: string) {
    const entry: SavedGame = {
      id: makeSaveId(),
      name: name.trim() || 'Untitled save',
      savedAt: Date.now(),
      ...game.captureGame(),
    }
    commitSaves([entry, ...savesRef.current])
  }

  function overwriteSavedGame(id: string) {
    const current = savesRef.current
    const target = current.find((s) => s.id === id)
    if (!target) return
    if (!confirm(`Overwrite "${target.name}" with the current adventure? This cannot be undone.`)) {
      return
    }
    const updated: SavedGame = {
      ...target,
      savedAt: Date.now(),
      ...game.captureGame(),
    }
    commitSaves(current.map((s) => (s.id === id ? updated : s)))
  }

  // Returns true if the save was loaded (false when missing or the user
  // declined the confirm), so the caller can close the panel only on success.
  function loadSavedGame(id: string): boolean {
    const target = savesRef.current.find((s) => s.id === id)
    if (!target) return false
    if (
      game.hasProgress &&
      !confirm('Load this save? Your current adventure will be replaced.')
    ) {
      return false
    }
    game.restoreGame(target)
    return true
  }

  function deleteSavedGame(id: string) {
    const current = savesRef.current
    const target = current.find((s) => s.id === id)
    if (!target) return
    if (!confirm(`Delete "${target.name}"? This cannot be undone.`)) return
    commitSaves(current.filter((s) => s.id !== id))
  }

  function exportSavedGame(id: string) {
    const target = savesRef.current.find((s) => s.id === id)
    if (!target) return
    const payload: SaveFile = { marker: SAVE_FILE_MARKER, version: 3, save: target }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const slug = target.name.replace(/[^a-z0-9-_]+/gi, '_').slice(0, 40) || 'save'
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}.dm-save.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function importSavedGame(file: File) {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as unknown
      let raw: SavedGame | SavedGameV1 | SavedGameV2 | null = null
      if (
        parsed &&
        typeof parsed === 'object' &&
        (parsed as { marker?: unknown }).marker === SAVE_FILE_MARKER &&
        isSavedGameLike((parsed as { save?: unknown }).save)
      ) {
        raw = (parsed as SaveFile | SaveFileV1 | SaveFileV2).save
      } else if (isSavedGameLike(parsed)) {
        raw = parsed
      }
      if (!raw) {
        alert('That file is not a valid Dungeon Master save.')
        return
      }
      const normalized = normalizeSavedGame(raw)
      const entry: SavedGame = { ...normalized, id: makeSaveId(), savedAt: Date.now() }
      commitSaves([entry, ...savesRef.current])
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return {
    saves,
    saveCurrentGame,
    overwriteSavedGame,
    loadSavedGame,
    deleteSavedGame,
    exportSavedGame,
    importSavedGame,
  }
}
