import { useEffect, useRef, useState } from 'react'
import {
  ADVENTURE_SLOTS,
  DEFAULT_BASE_URL,
  DEFAULT_CONTEXT,
  DEFAULT_MODEL,
  DEFAULT_REVISER_MODEL,
  DEFAULT_SAMPLING,
  LMSTUDIO_BASE_URL,
  MODEL_OPTIONS,
  XAI_BASE_URL,
} from '../engine/config'
import { listModels } from '../engine/model/client'
import type {
  AdventureSlots,
  ContextConfig,
  SamplingParams,
  SlotKey,
} from '../engine/types'

interface SettingsPanelProps {
  model: string
  apiKey: string
  baseUrl: string
  slots: AdventureSlots
  sampling: SamplingParams
  context: ContextConfig
  showTrace: boolean
  onClose: () => void
  onSave: (
    model: string,
    apiKey: string,
    baseUrl: string,
    slots: AdventureSlots,
    sampling: SamplingParams,
    context: ContextConfig,
    showTrace: boolean,
  ) => void
}

export function SettingsPanel({
  model,
  apiKey,
  baseUrl,
  slots,
  sampling,
  context,
  showTrace,
  onClose,
  onSave,
}: SettingsPanelProps) {
  const [draftModel, setDraftModel] = useState(model)
  const [draftApiKey, setDraftApiKey] = useState(apiKey)
  const [draftBaseUrl, setDraftBaseUrl] = useState(baseUrl || DEFAULT_BASE_URL)
  const [draftSlots, setDraftSlots] = useState<AdventureSlots>(() => ({ ...slots }))
  const [draftSampling, setDraftSampling] = useState<SamplingParams>(sampling)
  const [draftContext, setDraftContext] = useState<ContextConfig>(context)
  const [draftShowTrace, setDraftShowTrace] = useState<boolean>(showTrace)
  const [detectedModels, setDetectedModels] = useState<string[] | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)
  const detectControllerRef = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      detectControllerRef.current?.abort()
      detectControllerRef.current = null
    },
    [],
  )

  function resetDetection() {
    detectControllerRef.current?.abort()
    detectControllerRef.current = null
    setDetecting(false)
    setDetectedModels(null)
    setDetectError(null)
  }

  async function detectModels() {
    detectControllerRef.current?.abort()
    const controller = new AbortController()
    detectControllerRef.current = controller
    setDetecting(true)
    setDetectError(null)
    try {
      const ids = await listModels(
        draftBaseUrl.trim() || DEFAULT_BASE_URL,
        draftApiKey.trim(),
        controller.signal,
      )
      if (detectControllerRef.current !== controller) return
      setDetectedModels(ids)
      if (ids.length === 0) setDetectError('Endpoint reachable but reported no models.')
    } catch (err) {
      if (controller.signal.aborted || detectControllerRef.current !== controller) return
      setDetectedModels(null)
      setDetectError(err instanceof Error ? err.message : String(err))
    } finally {
      if (detectControllerRef.current === controller) {
        detectControllerRef.current = null
        setDetecting(false)
      }
    }
  }

  const modelChoices: readonly string[] =
    detectedModels && detectedModels.length > 0 ? detectedModels : MODEL_OPTIONS

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
      draftModel.trim(),
      draftApiKey.trim(),
      draftBaseUrl.trim() || DEFAULT_BASE_URL,
      trimmed,
      draftSampling,
      draftContext,
      draftShowTrace,
    )
    onClose()
  }

  function resetDefaults() {
    resetDetection()
    setDraftModel(DEFAULT_MODEL)
    setDraftBaseUrl(DEFAULT_BASE_URL)
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
        <label
          title={`OpenAI-compatible chat completions endpoint. Default: ${DEFAULT_BASE_URL} (xAI). For LM Studio, click the LM Studio button — make sure the local server is running on the same port. Any other server that exposes /chat/completions in OpenAI shape works too.`}
        >
          <span>API base URL</span>
          <div className="model-picker">
            <input
              type="text"
              value={draftBaseUrl}
              onChange={(e) => {
                resetDetection()
                setDraftBaseUrl(e.target.value)
              }}
              placeholder={DEFAULT_BASE_URL}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="ghost"
              onClick={() => {
                resetDetection()
                setDraftBaseUrl(XAI_BASE_URL)
              }}
              title="Use the default xAI API endpoint"
            >
              xAI
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                resetDetection()
                setDraftBaseUrl(LMSTUDIO_BASE_URL)
              }}
              title="Use LM Studio's default local server URL (port 1234)"
            >
              LM Studio
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void detectModels()}
              disabled={detecting}
              title="Query <baseUrl>/models and populate the model pickers below with the exact identifiers the server reports."
            >
              {detecting ? 'Detecting…' : 'Detect models'}
            </button>
          </div>
          {detectedModels && detectedModels.length > 0 && (
            <p className="hint">
              Detected {detectedModels.length} model{detectedModels.length === 1 ? '' : 's'}:
              the pickers below now show what this endpoint is actually serving.
            </p>
          )}
          {detectError && (
            <p className="error-text">
              Detect failed: {detectError}
            </p>
          )}
        </label>
        <label title="Stored in this browser's localStorage and sent directly to the configured endpoint. Leave blank when the endpoint does not require authentication.">
          <span>API key (optional if endpoint permits)</span>
          <input
            type="password"
            value={draftApiKey}
            onChange={(e) => {
              resetDetection()
              setDraftApiKey(e.target.value)
            }}
            placeholder="provider API key"
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <label
          title={`Pick a preset on the left or type any model id on the right. Sent to /chat/completions. Default: ${DEFAULT_MODEL}. Click "Detect models" above to populate this list from your endpoint. Applies on the next turn.`}
        >
          <span>Model</span>
          <div className="model-picker">
            <select
              value={modelChoices.includes(draftModel) ? draftModel : ''}
              onChange={(e) => {
                if (e.target.value) setDraftModel(e.target.value)
              }}
            >
              <option value="">— pick a preset —</option>
              {modelChoices.map((m) => (
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
        </label>
        <label
          title={`Model id used for the optional reviser pass. A small, fast instruction-following model is usually sufficient. Default: ${DEFAULT_REVISER_MODEL}.`}
        >
          <span>Reviser model</span>
          <div className="model-picker">
            <select
              value={modelChoices.includes(draftContext.reviserModel) ? draftContext.reviserModel : ''}
              onChange={(e) => {
                if (e.target.value) setContextField('reviserModel', e.target.value)
              }}
              disabled={!draftContext.useReviser}
            >
              <option value="">— pick a preset —</option>
              {modelChoices.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              type="text"
              value={draftContext.reviserModel}
              onChange={(e) => setContextField('reviserModel', e.target.value)}
              placeholder={DEFAULT_REVISER_MODEL}
              spellCheck={false}
              disabled={!draftContext.useReviser}
            />
          </div>
        </label>
        {ADVENTURE_SLOTS.map((def) => (
          <label key={def.key} title={def.hint}>
            <span>{def.label}</span>
            <textarea
              value={draftSlots[def.key] ?? ''}
              onChange={(e) => setSlotField(def.key, e.target.value)}
              rows={def.rows}
              placeholder={def.placeholder}
            />
          </label>
        ))}

        <div className="sampling-grid">
          <label
            className="sampling-field"
            title={`Higher = more varied prose and rhythm. Default ${DEFAULT_SAMPLING.temperature}. If a model rejects this setting, the adapter retries without it and remembers that capability for the session.`}
          >
            <span>Temperature</span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={draftSampling.temperature}
              onChange={(e) => setSamplingField('temperature', Number(e.target.value))}
            />
          </label>
        </div>

        <div className="sampling-grid">
          <label
            className="sampling-field"
            title={`When the live tail (turns past the cutoff) reaches this many turns, the oldest M get folded into one chronicle entry. Same threshold applies recursively at every chronicle level. Default ${DEFAULT_CONTEXT.compactionThreshold}.`}
          >
            <span>Compaction threshold (N)</span>
            <input
              type="number"
              min={2}
              step={1}
              value={draftContext.compactionThreshold}
              onChange={(e) => setContextField('compactionThreshold', Number(e.target.value))}
            />
          </label>
          <label
            className="sampling-field"
            title={`How many turns or entries to fold per compaction step. One chronicle entry covers M raw turns; a level-1 entry covers M²; and so on. Default ${DEFAULT_CONTEXT.compactionBatch}.`}
          >
            <span>Compaction batch (M)</span>
            <input
              type="number"
              min={1}
              step={1}
              value={draftContext.compactionBatch}
              onChange={(e) => setContextField('compactionBatch', Number(e.target.value))}
            />
          </label>
          <label
            className="sampling-field"
            title={`When the state JSON exceeds this, a cleanup reminder is appended to the state system message. Default ${DEFAULT_CONTEXT.stateCleanupChars.toLocaleString()}.`}
          >
            <span>State cleanup nudge (chars)</span>
            <input
              type="number"
              min={1000}
              step={500}
              value={draftContext.stateCleanupChars}
              onChange={(e) => setContextField('stateCleanupChars', Number(e.target.value))}
            />
          </label>
        </div>

        <h3 className="saves-subhead">Display</h3>
        <div className="flag-list">
          <label
            className="flag-field"
            title="Display the per-turn trace toggle and reasoning / tool-call boxes under each DM reply. Turn off to hide them entirely. Default on."
          >
            <input
              type="checkbox"
              checked={draftShowTrace}
              onChange={(e) => setDraftShowTrace(e.target.checked)}
            />
            <strong>Show trace under DM messages</strong>
          </label>
        </div>

        <h3 className="saves-subhead">Experimental flags</h3>
        <div className="flag-list">
          <label
            className="flag-field"
            title={`When off, only the current player message is sent; earlier player messages are dropped (their content already lives in the DM narration that followed). Saves tokens but loses the literal wording for reference. Default ${DEFAULT_CONTEXT.includePriorPlayerTurns ? 'on' : 'off'}.`}
          >
            <input
              type="checkbox"
              checked={draftContext.includePriorPlayerTurns}
              onChange={(e) => setContextField('includePriorPlayerTurns', e.target.checked)}
            />
            <strong>Include prior player turns in context</strong>
          </label>
          <label
            className="flag-field"
            title={`When on (default), the turn reminder is sent as a trailing system message after the player's input — clean separation, treated as just-in-time guidance. When off, the reminder is sent as an extra user message wrapped in (OOC: …); the dm-system prompt treats parens-wrapped player text as out-of-character directives, which can give the reminder more behavioral weight at the cost of breaking strict user/assistant alternation. Flip this off if the model under-weights the checklist as a system message. Default ${DEFAULT_CONTEXT.reminderAsSystem ? 'on' : 'off'}.`}
          >
            <input
              type="checkbox"
              checked={draftContext.reminderAsSystem}
              onChange={(e) => setContextField('reminderAsSystem', e.target.checked)}
            />
            <strong>Send turn reminder as system message</strong>
          </label>
          <label
            className="flag-field"
            title={`When off, the long-term-memory system message is dropped AND the update_memory tool is not advertised — the model has no persistent record of NPCs, locations, plot themes, or key past events. Default ${DEFAULT_CONTEXT.includeMemory ? 'on' : 'off'}.`}
          >
            <input
              type="checkbox"
              checked={draftContext.includeMemory}
              onChange={(e) => setContextField('includeMemory', e.target.checked)}
            />
            <strong>Include long-term memory</strong>
          </label>
          <label
            className="flag-field"
            title={`When off, the live-state system message is dropped AND the update_state tool is not advertised — the model has no record of the current scene. Useful for comparing prose quality with/without structured grounding. Default ${DEFAULT_CONTEXT.includeWorldState ? 'on' : 'off'}.`}
          >
            <input
              type="checkbox"
              checked={draftContext.includeWorldState}
              onChange={(e) => setContextField('includeWorldState', e.target.checked)}
            />
            <strong>Include live state</strong>
          </label>
          <label
            className="flag-field"
            title={`When off, the future-plot-plan system message is dropped AND the future_plot_plan tool is not advertised — the model steers without a running plan. Default ${DEFAULT_CONTEXT.includePlotOutline ? 'on' : 'off'}.`}
          >
            <input
              type="checkbox"
              checked={draftContext.includePlotOutline}
              onChange={(e) => setContextField('includePlotOutline', e.target.checked)}
            />
            <strong>Include future plot plan</strong>
          </label>
          <label
            className="flag-field"
            title={`When on, each live-history turn's tool calls (update_state / future_plot_plan / update_memory) and their results are replayed into the transcript so recent turns demonstrate the narrate-and-call cadence; reasoning is not replayed. Helps the model keep making updates as context grows. Only affects the live tail — chronicle/compacted turns are unaffected. Default ${DEFAULT_CONTEXT.includeToolCallHistory ? 'on' : 'off'}.`}
          >
            <input
              type="checkbox"
              checked={draftContext.includeToolCallHistory}
              onChange={(e) => setContextField('includeToolCallHistory', e.target.checked)}
            />
            <strong>Replay tool calls in history</strong>
          </label>
          <label
            className="flag-field"
            title={`When on, the DM is told the player is a consenting adult and may include dark, mature, or NSFW themes if they fit the story. When off, the DM is told to avoid NSFW descriptions or plot developments. Default ${DEFAULT_CONTEXT.nsfw ? 'on' : 'off'}.`}
          >
            <input
              type="checkbox"
              checked={draftContext.nsfw}
              onChange={(e) => setContextField('nsfw', e.target.checked)}
            />
            <strong>Allow NSFW / mature themes</strong>
          </label>
          <label
            className="flag-field"
            title={`When on, a reviser pass runs after the narrator: the model picked above (Reviser model) takes the narrator's draft and polishes it into clean English. The revised text is shown to the player; the original draft is kept in the trace. Adds one extra request per turn. Default ${DEFAULT_CONTEXT.useReviser ? 'on' : 'off'}.`}
          >
            <input
              type="checkbox"
              checked={draftContext.useReviser}
              onChange={(e) => setContextField('useReviser', e.target.checked)}
            />
            <strong>Run reviser after narrator</strong>
          </label>
        </div>

        <p className="hint">
          Saving persists to this browser. Sampling and flags take effect on the next
          turn. Click <em>New Adventure</em> in the header to restart — the DM
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
