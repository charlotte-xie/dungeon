import { useState } from 'react'
import { DEFAULT_SYSTEM_PROMPT } from '../prompts'
import {
  ADVENTURE_SLOTS,
  DEFAULT_CONTEXT,
  DEFAULT_MODEL,
  DEFAULT_SAMPLING,
} from '../engine/config'
import type {
  AdventureSlots,
  ContextConfig,
  SamplingParams,
  SlotKey,
} from '../engine/types'

const MODEL_OPTIONS = [
  'grok-4-1-fast-reasoning',
  'grok-4.20-0309-reasoning',
  'grok-4',
  'grok-4-fast',
  'grok-4-fast-reasoning',
  'grok-code-fast',
] as const

interface SettingsPanelProps {
  systemPrompt: string
  model: string
  xaiKey: string
  slots: AdventureSlots
  sampling: SamplingParams
  context: ContextConfig
  onClose: () => void
  onSave: (
    systemPrompt: string,
    model: string,
    xaiKey: string,
    slots: AdventureSlots,
    sampling: SamplingParams,
    context: ContextConfig,
  ) => void
}

export function SettingsPanel({
  systemPrompt,
  model,
  xaiKey,
  slots,
  sampling,
  context,
  onClose,
  onSave,
}: SettingsPanelProps) {
  const [draftSystem, setDraftSystem] = useState(systemPrompt)
  const [draftModel, setDraftModel] = useState(model)
  const [draftXaiKey, setDraftXaiKey] = useState(xaiKey)
  const [draftSlots, setDraftSlots] = useState<AdventureSlots>(() => ({ ...slots }))
  const [draftSampling, setDraftSampling] = useState<SamplingParams>(sampling)
  const [draftContext, setDraftContext] = useState<ContextConfig>(context)

  function setSlotField(key: SlotKey, value: string) {
    setDraftSlots((s) => ({ ...s, [key]: value }))
  }

  function setSamplingField<K extends keyof SamplingParams>(key: K, value: number) {
    setDraftSampling((s) => ({ ...s, [key]: value }))
  }

  function setContextField<K extends keyof ContextConfig>(key: K, value: ContextConfig[K]) {
    setDraftContext((c) => ({ ...c, [key]: value }))
  }

  function save() {
    const trimmed = {} as AdventureSlots
    for (const def of ADVENTURE_SLOTS) trimmed[def.key] = (draftSlots[def.key] ?? '').trim()
    onSave(
      draftSystem.trim(),
      draftModel.trim(),
      draftXaiKey.trim(),
      trimmed,
      draftSampling,
      draftContext,
    )
    onClose()
  }

  function resetDefaults() {
    setDraftSystem(DEFAULT_SYSTEM_PROMPT)
    setDraftModel(DEFAULT_MODEL)
    setDraftSampling({ ...DEFAULT_SAMPLING })
    setDraftContext({ ...DEFAULT_CONTEXT })
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>Settings</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <label>
          <span>xAI API key</span>
          <input
            type="password"
            value={draftXaiKey}
            onChange={(e) => setDraftXaiKey(e.target.value)}
            placeholder="xai-…"
            spellCheck={false}
            autoComplete="off"
          />
          <small className="hint">
            Stored in this browser&apos;s localStorage and sent directly to{' '}
            <code>api.x.ai</code> on each turn. Get one at{' '}
            <a href="https://console.x.ai/" target="_blank" rel="noreferrer">
              console.x.ai
            </a>
            .
          </small>
        </label>
        <label>
          <span>Model</span>
          <div className="model-picker">
            <select
              value={MODEL_OPTIONS.includes(draftModel) ? draftModel : ''}
              onChange={(e) => {
                if (e.target.value) setDraftModel(e.target.value)
              }}
            >
              <option value="">— pick a preset —</option>
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              type="text"
              value={draftModel}
              onChange={(e) => setDraftModel(e.target.value)}
              placeholder={DEFAULT_MODEL}
              spellCheck={false}
            />
          </div>
          <small className="hint">
            Pick a preset on the left or type any xAI model id on the right. Sent to{' '}
            <code>/chat/completions</code>. Default: <code>{DEFAULT_MODEL}</code>.
            Applies on the next turn — reasoning variants skip temperature/penalty.
          </small>
        </label>
        <label>
          <span>System prompt</span>
          <textarea
            value={draftSystem}
            onChange={(e) => setDraftSystem(e.target.value)}
            rows={10}
          />
        </label>
        {ADVENTURE_SLOTS.map((def) => (
          <label key={def.key}>
            <span>{def.label}</span>
            <textarea
              value={draftSlots[def.key] ?? ''}
              onChange={(e) => setSlotField(def.key, e.target.value)}
              rows={def.rows}
              placeholder={def.placeholder}
            />
            <small className="hint">{def.hint}</small>
          </label>
        ))}

        <div className="sampling-grid">
          <label className="sampling-field">
            <span>Temperature</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={draftSampling.temperature}
              onChange={(e) => setSamplingField('temperature', Number(e.target.value))}
            />
            <small>Higher = more varied prose and rhythm. Default {DEFAULT_SAMPLING.temperature}. Ignored on reasoning models.</small>
          </label>
          <label className="sampling-field">
            <span>Frequency penalty</span>
            <input
              type="number"
              min={-2}
              max={2}
              step={0.05}
              value={draftSampling.frequencyPenalty}
              onChange={(e) => setSamplingField('frequencyPenalty', Number(e.target.value))}
            />
            <small>Discourages repeated phrases and sentence shapes. Default {DEFAULT_SAMPLING.frequencyPenalty}.</small>
          </label>
          <label className="sampling-field">
            <span>Presence penalty</span>
            <input
              type="number"
              min={-2}
              max={2}
              step={0.05}
              value={draftSampling.presencePenalty}
              onChange={(e) => setSamplingField('presencePenalty', Number(e.target.value))}
            />
            <small>Pushes toward new topics / fresh turns. Default {DEFAULT_SAMPLING.presencePenalty}.</small>
          </label>
        </div>

        <div className="sampling-grid">
          <label className="sampling-field">
            <span>Compaction threshold (N)</span>
            <input
              type="number"
              min={2}
              step={1}
              value={draftContext.compactionThreshold}
              onChange={(e) => setContextField('compactionThreshold', Number(e.target.value))}
            />
            <small>
              When the live tail (turns past the cutoff) reaches this many turns,
              the oldest <em>M</em> get folded into one chronicle entry. Same threshold
              applies recursively at every chronicle level. Default{' '}
              {DEFAULT_CONTEXT.compactionThreshold}.
            </small>
          </label>
          <label className="sampling-field">
            <span>Compaction batch (M)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={draftContext.compactionBatch}
              onChange={(e) => setContextField('compactionBatch', Number(e.target.value))}
            />
            <small>
              How many turns or entries to fold per compaction step. One chronicle
              entry covers <em>M</em> raw turns; a level-1 entry covers <em>M²</em>;
              and so on. Default {DEFAULT_CONTEXT.compactionBatch}.
            </small>
          </label>
          <label className="sampling-field">
            <span>State cleanup nudge (chars)</span>
            <input
              type="number"
              min={1000}
              step={500}
              value={draftContext.stateCleanupChars}
              onChange={(e) => setContextField('stateCleanupChars', Number(e.target.value))}
            />
            <small>
              When the state JSON exceeds this, a cleanup reminder is appended to the
              state system message. Default {DEFAULT_CONTEXT.stateCleanupChars.toLocaleString()}.
            </small>
          </label>
        </div>

        <h3 className="saves-subhead">Experimental flags</h3>
        <div className="flag-list">
          <label className="flag-field">
            <input
              type="checkbox"
              checked={draftContext.includePriorPlayerTurns}
              onChange={(e) => setContextField('includePriorPlayerTurns', e.target.checked)}
            />
            <span>
              <strong>Include prior player turns in context</strong>
              <small>
                When off, only the current player message is sent; earlier player messages
                are dropped (their content already lives in the DM narration that followed).
                Saves tokens but loses the literal wording for reference. Default{' '}
                {DEFAULT_CONTEXT.includePriorPlayerTurns ? 'on' : 'off'}.
              </small>
            </span>
          </label>
          <label className="flag-field">
            <input
              type="checkbox"
              checked={draftContext.appendReminderToUser}
              onChange={(e) => setContextField('appendReminderToUser', e.target.checked)}
            />
            <span>
              <strong>Fold turn reminder into player message</strong>
              <small>
                When on, the turn reminder is folded into the latest player message as an
                OOC suffix so the wire ends with one <code>user</code> turn (standard
                alternation). When off (default), the reminder is sent as a separate
                <code>user</code> message wrapped in <code>(OOC: …)</code> after the
                player's input — the dm-system prompt treats parens-wrapped player text
                as out-of-character directives, so this lands as an in-channel
                instruction rather than mid-conversation system noise. Flip this on if
                the model hallucinates a second player turn or stops mid-OOC. Default{' '}
                {DEFAULT_CONTEXT.appendReminderToUser ? 'on' : 'off'}.
              </small>
            </span>
          </label>
          <label className="flag-field">
            <input
              type="checkbox"
              checked={draftContext.includeWorldState}
              onChange={(e) => setContextField('includeWorldState', e.target.checked)}
            />
            <span>
              <strong>Include world state</strong>
              <small>
                When off, the world-state system message is dropped AND the{' '}
                <code>update_state</code> tool is not advertised — the model can't read or
                write state. Useful for comparing prose quality with/without structured
                grounding. Default {DEFAULT_CONTEXT.includeWorldState ? 'on' : 'off'}.
              </small>
            </span>
          </label>
          <label className="flag-field">
            <input
              type="checkbox"
              checked={draftContext.includePlotOutline}
              onChange={(e) => setContextField('includePlotOutline', e.target.checked)}
            />
            <span>
              <strong>Include plot outline</strong>
              <small>
                When off, the plot-outline system message is dropped AND the{' '}
                <code>plot_update</code> tool is not advertised — the model steers without
                a running outline. Default{' '}
                {DEFAULT_CONTEXT.includePlotOutline ? 'on' : 'off'}.
              </small>
            </span>
          </label>
          <label className="flag-field">
            <input
              type="checkbox"
              checked={draftContext.nsfw}
              onChange={(e) => setContextField('nsfw', e.target.checked)}
            />
            <span>
              <strong>Allow NSFW / mature themes</strong>
              <small>
                When on, the DM is told the player is a consenting adult and may include
                dark, mature, or NSFW themes if they fit the story. When off, the DM is
                told to avoid NSFW descriptions or plot developments. Default{' '}
                {DEFAULT_CONTEXT.nsfw ? 'on' : 'off'}.
              </small>
            </span>
          </label>
          <label className="flag-field">
            <input
              type="checkbox"
              checked={draftContext.usePlanner}
              onChange={(e) => setContextField('usePlanner', e.target.checked)}
            />
            <span>
              <strong>Run planner before narrator</strong>
              <small>
                When on, a planner pass runs before the narrator each turn: it reads the
                chronicle, recent turns, and current state, then writes a director's-note
                instruction (visible in the trace) and handles all{' '}
                <code>update_state</code> / <code>plot_update</code> calls. The
                instruction is then injected into the narrator's prompt as a labeled{' '}
                <code>PLANNER INPUT</code> system message, and the narrator's mutation
                tools are suppressed (planner already covered them). Roughly doubles
                tokens and latency per turn. Default{' '}
                {DEFAULT_CONTEXT.usePlanner ? 'on' : 'off'}.
              </small>
            </span>
          </label>
        </div>

        <p className="hint">
          Saving persists to this browser. The system prompt and sampling take effect on
          the next turn. Click <em>New Adventure</em> in the header to restart — the DM
          will generate a fresh opening from the brief above.
        </p>
        <div className="modal-actions">
          <button className="ghost" onClick={resetDefaults}>
            Reset to defaults
          </button>
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button onClick={save}>Save</button>
        </div>
      </div>
    </div>
  )
}
