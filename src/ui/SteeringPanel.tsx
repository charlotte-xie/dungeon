import { useState } from 'react'
import { prepareSteering, type SteeringScope } from '../engine/steering'
import { MAX_OOC_ITEM_CHARS } from '../engine/tools'

interface SteeringPanelProps {
  input: string
  preferences: string[]
  enabled: boolean
  busy: boolean
  onClose: () => void
  onApply: (next: { input: string; preferences: string[] }) => void
}

const SUGGESTIONS = [
  'Move faster; skip the arrangements.',
  'Focus on the relationships.',
  'Surprise me.',
  'Keep this scene quiet.',
]

export function SteeringPanel({ input, preferences, enabled, busy, onClose, onApply }: SteeringPanelProps) {
  const [guidance, setGuidance] = useState('')
  const [scope, setScope] = useState<SteeringScope>('once')
  const [draftPreferences, setDraftPreferences] = useState([...preferences])
  const [error, setError] = useState<string | null>(null)

  function apply() {
    if (busy) return
    try {
      onApply(prepareSteering(input, guidance, scope, draftPreferences))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="steering-title">
        <div className="modal-header">
          <h2 id="steering-title">Steer the story</h2>
          <button className="modal-close" aria-label="Close steering" onClick={onClose}>×</button>
        </div>
        <p className="hint">
          Shape the pace, tone, or direction without speaking as your character.
          The story can take the lead; you can change course whenever you like.
        </p>
        <label>
          <span>Your direction</span>
          <textarea
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder="More of Mara's story. Drop the conspiracy. Skip ahead to the dinner…"
            rows={3}
            maxLength={scope === 'standing' ? MAX_OOC_ITEM_CHARS : undefined}
            disabled={busy}
          />
        </label>
        <div className="steering-suggestions">
          {SUGGESTIONS.map((text) => (
            <button key={text} type="button" className="ghost" disabled={busy} onClick={() => setGuidance(text)}>
              {text}
            </button>
          ))}
        </div>
        <label>
          <span>Apply this direction</span>
          <select value={scope} disabled={busy} onChange={(e) => setScope(e.target.value as SteeringScope)}>
            <option value="once">Next reply only</option>
            <option value="standing" disabled={!enabled}>Until I change it</option>
          </select>
        </label>
        <p className="hint">
          {scope === 'once'
            ? 'Adds guidance to your action box. Edit or add your action, then press Act when ready. No reply is generated yet.'
            : 'Saves a preference for this adventure, starting with the next reply. No reply is generated yet.'}
        </p>
        <h3 className="saves-subhead">Standing preferences</h3>
        {!enabled && <p className="hint">Standing preferences are paused. Enable “Include OOC instructions” in Settings to use them.</p>}
        {!draftPreferences.length && <p className="hint">No standing preferences yet.</p>}
        {draftPreferences.map((entry, index) => (
          <div key={index} className="steering-preference">
            <textarea
              aria-label={`Standing preference ${index + 1}`}
              value={entry}
              rows={2}
              maxLength={MAX_OOC_ITEM_CHARS}
              disabled={busy}
              onChange={(e) => setDraftPreferences((current) => current.map((v, i) => i === index ? e.target.value : v))}
            />
            <button
              type="button" className="ghost" disabled={busy}
              aria-label={`Remove preference ${index + 1}`}
              onClick={() => setDraftPreferences((current) => current.filter((_, i) => i !== index))}
            >Remove</button>
          </div>
        ))}
        {draftPreferences.length > 0 && (
          <button type="button" className="ghost" disabled={busy} onClick={() => setDraftPreferences([])}>
            Clear all preferences
          </button>
        )}
        <p className="hint">Edits and removals take effect when you save. Private story plans are not shown here.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <span className="spacer" />
          <button disabled={busy} onClick={apply}>
            {scope === 'once' && guidance.trim() ? 'Add to next turn & save' : 'Save preferences'}
          </button>
        </div>
      </div>
    </div>
  )
}
