import { useRef, useState } from 'react'
import type { SavedGame } from '../engine/types'

interface SavesPanelProps {
  saves: SavedGame[]
  canSave: boolean
  turnCount: number
  onClose: () => void
  onSave: (name: string) => void
  onLoad: (id: string) => void
  onDelete: (id: string) => void
  onExport: (id: string) => void
  onImport: (file: File) => void
}

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts
  const sec = Math.max(0, Math.floor(diffMs / 1000))
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`
  const days = Math.floor(sec / 86400)
  if (days < 14) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

export function SavesPanel({
  saves,
  canSave,
  turnCount,
  onClose,
  onSave,
  onLoad,
  onDelete,
  onExport,
  onImport,
}: SavesPanelProps) {
  const [name, setName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function handleSave() {
    onSave(name)
    setName('')
  }

  function handleImportClick() {
    fileRef.current?.click()
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onImport(file)
    e.target.value = ''
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>Saved games</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <h3 className="saves-subhead">Save current game</h3>
        <p className="hint">
          {canSave
            ? `Snapshot scenario, style, chronicle, state, and all ${turnCount} turn${turnCount === 1 ? '' : 's'} under a short label.`
            : 'Start an adventure first — there is nothing to save yet.'}
        </p>
        <div className="saves-save-row">
          <input
            type="text"
            placeholder="Brief summary — e.g. Before the crypt fight"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) handleSave()
            }}
            disabled={!canSave}
          />
          <button onClick={handleSave} disabled={!canSave}>
            Save current
          </button>
        </div>

        <h3 className="saves-subhead">Saved ({saves.length})</h3>
        {saves.length === 0 ? (
          <p className="hint">No saved games yet.</p>
        ) : (
          <div className="saves-list">
            {saves.map((s) => (
              <div key={s.id} className="saves-item">
                <div className="saves-item-head">
                  <span className="saves-item-name">{s.name}</span>
                  <span className="saves-item-meta">
                    {s.turns.length} turn{s.turns.length === 1 ? '' : 's'} · {formatRelative(s.savedAt)}
                  </span>
                </div>
                <div className="saves-item-actions">
                  <button onClick={() => onLoad(s.id)}>Load</button>
                  <button className="ghost" onClick={() => onExport(s.id)}>Export</button>
                  <button className="ghost" onClick={() => onDelete(s.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={handleImportClick}>
            Import from file…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
