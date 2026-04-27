import { useState } from 'react'
import { ADVENTURE_SLOTS } from '../engine/config'
import type { AdventureSlots, SlotKey } from '../engine/types'

interface NewAdventurePromptProps {
  slots: AdventureSlots
  inProgress: boolean
  onCancel: () => void
  onBegin: (slots: AdventureSlots) => void
}

export function NewAdventurePrompt({
  slots,
  inProgress,
  onCancel,
  onBegin,
}: NewAdventurePromptProps) {
  const [drafts, setDrafts] = useState<AdventureSlots>(() => ({ ...slots }))
  const scenarioReady = (drafts.scenario ?? '').trim().length > 0

  function setSlotField(key: SlotKey, value: string) {
    setDrafts((d) => ({ ...d, [key]: value }))
  }

  function begin() {
    const trimmed = {} as AdventureSlots
    for (const def of ADVENTURE_SLOTS) trimmed[def.key] = (drafts[def.key] ?? '').trim()
    onBegin(trimmed)
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>New adventure</h2>
          <button className="modal-close" aria-label="Close" onClick={onCancel}>×</button>
        </div>
        <p className="hint">
          {inProgress
            ? 'This will end the current adventure and start a fresh one. The DM will narrate the opening from the brief below.'
            : 'The DM will narrate the opening from the brief below.'}
        </p>
        {ADVENTURE_SLOTS.map((def, i) => (
          <label key={def.key}>
            <span>{def.label}</span>
            <textarea
              value={drafts[def.key] ?? ''}
              onChange={(e) => setSlotField(def.key, e.target.value)}
              rows={def.rows}
              placeholder={def.placeholder}
              autoFocus={i === 0}
            />
            <small className="hint">{def.hint}</small>
          </label>
        ))}
        <div className="modal-actions">
          <span className="spacer" />
          <button className="ghost" onClick={onCancel}>Cancel</button>
          <button onClick={begin} disabled={!scenarioReady}>
            Begin Adventure
          </button>
        </div>
      </div>
    </div>
  )
}
