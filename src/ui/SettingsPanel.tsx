import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  DEFAULT_BASE_URL,
  DEFAULT_CONTEXT,
  DEFAULT_MODEL,
  DEFAULT_REVISER_MODEL,
  DEFAULT_SAMPLING,
  MODEL_OPTIONS,
  PROVIDER_SETUPS,
  reasoningOffConflict,
  type ModelRole,
  type ProviderId,
} from '../engine/config'
import { listModels } from '../engine/model/client'
import type { ReasoningEffort } from '../engine/model/types'
import type { ContextConfig, SamplingParams } from '../engine/types'
import { useReportDirty } from '../hooks/useReportDirty'

const ROLE_NAMES: Record<ModelRole, string> = {
  narrator: 'Narrator',
  plotter: 'Plotter',
  summarizer: 'Summariser',
}

interface SettingsPanelProps {
  model: string
  apiKey: string
  baseUrl: string
  sampling: SamplingParams
  context: ContextConfig
  devMode: boolean
  onSave: (
    model: string,
    apiKey: string,
    baseUrl: string,
    sampling: SamplingParams,
    context: ContextConfig,
    devMode: boolean,
  ) => void
  onDirtyChange: (dirty: boolean) => void
}

function ReasoningSelect({ label, value, onChange }: {
  label: string
  value: ReasoningEffort
  onChange: (value: ReasoningEffort) => void
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as ReasoningEffort)}>
      <option value="default">Provider default (omit setting)</option>
      <option value="none">Off</option>
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
      <option value="xhigh">Extra high</option>
    </select>
  )
}

// One row of the models grid: the role, a preset picker, the model id, and
// whatever goes in the last column.
function ModelRow({ name, value, onChange, choices, emptyChoice, placeholder, title, disabled, children }: {
  name: string
  value: string
  onChange: (value: string) => void
  choices: readonly string[]
  // The blank option, and whether picking it clears the model id.
  emptyChoice: { label: string; clears: boolean }
  placeholder: string
  title?: string
  disabled?: boolean
  children?: ReactNode
}) {
  return (
    <>
      <span className="model-role">{name}</span>
      <select
        aria-label={`${name} model preset`}
        title={title}
        value={choices.includes(value) ? value : ''}
        onChange={(e) => {
          if (e.target.value || emptyChoice.clears) onChange(e.target.value)
        }}
        disabled={disabled}
      >
        <option value="">{emptyChoice.label}</option>
        {choices.map((m) => <option key={m} value={m}>{m}</option>)}
      </select>
      <input
        type="text"
        aria-label={`${name} model ID`}
        title={title}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        disabled={disabled}
      />
      <div className="model-last">{children}</div>
    </>
  )
}

export function SettingsPanel({
  model,
  apiKey,
  baseUrl,
  sampling,
  context,
  devMode,
  onSave,
  onDirtyChange,
}: SettingsPanelProps) {
  const [draftModel, setDraftModel] = useState(model)
  const [draftApiKey, setDraftApiKey] = useState(apiKey)
  const [draftBaseUrl, setDraftBaseUrl] = useState(baseUrl || DEFAULT_BASE_URL)
  const [draftSampling, setDraftSampling] = useState<SamplingParams>(sampling)
  const [draftContext, setDraftContext] = useState<ContextConfig>(context)
  const [draftDevMode, setDraftDevMode] = useState<boolean>(devMode)
  const [detectedModels, setDetectedModels] = useState<string[] | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
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

  function setSamplingField<K extends keyof SamplingParams>(key: K, value: number) {
    setDraftSampling((s) => ({ ...s, [key]: value }))
  }

  function setContextField<K extends keyof ContextConfig>(key: K, value: ContextConfig[K]) {
    setDraftContext((c) => ({ ...c, [key]: value }))
  }

  const dirty =
    draftModel !== model ||
    draftApiKey !== apiKey ||
    draftBaseUrl !== (baseUrl || DEFAULT_BASE_URL) ||
    JSON.stringify(draftSampling) !== JSON.stringify(sampling) ||
    JSON.stringify(draftContext) !== JSON.stringify(context) ||
    draftDevMode !== devMode
  useReportDirty(dirty, onDirtyChange)

  function save() {
    const nextContext: ContextConfig = {
      ...draftContext,
      plotterModel: draftContext.plotterModel.trim(),
      summarizerModel: draftContext.summarizerModel.trim(),
    }
    const conflict = reasoningOffConflict(draftModel, nextContext)
    if (conflict) {
      setSettingsError(`${ROLE_NAMES[conflict]}: Grok 4.7 requires reasoning. Choose Low or higher.`)
      return
    }
    const nextModel = draftModel.trim()
    const nextApiKey = draftApiKey.trim()
    const nextBaseUrl = draftBaseUrl.trim() || DEFAULT_BASE_URL
    onSave(nextModel, nextApiKey, nextBaseUrl, draftSampling, nextContext, draftDevMode)
    // The drafts become what was saved, so the tab is no longer dirty.
    setDraftModel(nextModel)
    setDraftApiKey(nextApiKey)
    setDraftBaseUrl(nextBaseUrl)
    setDraftContext(nextContext)
    setSettingsError(null)
  }

  function revert() {
    resetDetection()
    setDraftModel(model)
    setDraftApiKey(apiKey)
    setDraftBaseUrl(baseUrl || DEFAULT_BASE_URL)
    setDraftSampling(sampling)
    setDraftContext(context)
    setDraftDevMode(devMode)
    setSettingsError(null)
  }

  function resetDefaults() {
    resetDetection()
    setDraftModel(DEFAULT_MODEL)
    setDraftBaseUrl(DEFAULT_BASE_URL)
    setDraftSampling({ ...DEFAULT_SAMPLING })
    setDraftContext({ ...DEFAULT_CONTEXT })
    setSettingsError(null)
  }

  function applyProvider(id: ProviderId) {
    const setup = PROVIDER_SETUPS[id]
    resetDetection()
    setSettingsError(null)
    setDraftBaseUrl(setup.baseUrl)
    if (setup.model) setDraftModel(setup.model)
    setDraftContext((c) => ({ ...c, ...setup.context }))
  }

  return (
    <section className="page" aria-label="Settings">
      <div className="page-main">
        <fieldset className="settings-section">
          <legend>Connection</legend>
          <div className="settings-fields">
            <label
              className="span-all"
              title={`OpenAI-compatible chat completions endpoint. Default: ${DEFAULT_BASE_URL} (xAI). Mistral's La Plateforme works via the Mistral button (needs a Mistral API key; the button also switches to Chat Completions). For LM Studio, click the LM Studio button — make sure the local server is running on the same port. Any other server that exposes /chat/completions in OpenAI shape works too.`}
            >
              <span>API base URL</span>
              <div className="url-row">
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
                  onClick={() => applyProvider('xai')}
                  title="Use the default xAI API endpoint with the Grok preset: Grok 4.3 for every role (narrator with reasoning off, plotter and summariser at low), Responses protocol"
                >
                  xAI
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => applyProvider('mistral')}
                  title="Use Mistral's La Plateforme API endpoint (requires a Mistral API key). Switches to Chat Completions, and the plotter and summariser follow the narrator model; pick a Mistral model below."
                >
                  Mistral
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => applyProvider('lmstudio')}
                  title="Use LM Studio's default local server URL (port 1234). Switches to Chat Completions, and the plotter and summariser follow the narrator model; use Detect models to pick the loaded model."
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
            <label
              title={`Which OpenAI-compatible wire protocol to use for all model calls. Chat Completions (/chat/completions) works on every provider, including Mistral, LM Studio, and llama.cpp — Mistral supports only this one. Responses (/responses) is the newer format xAI and OpenAI recommend (xAI has deprecated Chat Completions) and is also supported by Ollama and vLLM; used statelessly, so behaviour is otherwise identical. Default ${DEFAULT_CONTEXT.apiProtocol === 'responses' ? 'Responses' : 'Chat Completions'}.`}
            >
              <span>API protocol</span>
              <select
                value={draftContext.apiProtocol}
                onChange={(e) =>
                  setContextField('apiProtocol', e.target.value as ContextConfig['apiProtocol'])
                }
              >
                <option value="chat-completions">Chat Completions (universal)</option>
                <option value="responses">Responses (xAI, OpenAI, Ollama, vLLM)</option>
              </select>
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
          </div>
        </fieldset>

        <fieldset className="settings-section">
          <legend>Models</legend>
          <div className="model-grid">
            <span className="model-head" aria-hidden="true" />
            <span className="model-head" aria-hidden="true">Preset</span>
            <span className="model-head" aria-hidden="true">Model ID</span>
            <span className="model-head" aria-hidden="true">Reasoning</span>
            <ModelRow
              name="Narrator"
              value={draftModel}
              onChange={setDraftModel}
              choices={modelChoices}
              emptyChoice={{ label: '— pick a preset —', clears: false }}
              placeholder={DEFAULT_MODEL}
              title={`Pick a preset or type any model id. Default: ${DEFAULT_MODEL}. Click "Detect models" above to populate the presets from your endpoint. Applies on the next turn.`}
            >
              <ReasoningSelect
                label="Narrator reasoning"
                value={draftContext.narratorReasoning}
                onChange={(value) => setContextField('narratorReasoning', value)}
              />
            </ModelRow>
            {(['plotter', 'summarizer'] as const).map((role) => {
              const modelKey = `${role}Model` as const
              const reasoningKey = `${role}Reasoning` as const
              return (
                <ModelRow
                  key={role}
                  name={ROLE_NAMES[role]}
                  value={draftContext[modelKey]}
                  onChange={(value) => setContextField(modelKey, value)}
                  choices={modelChoices}
                  emptyChoice={{ label: 'Use narrator model / custom', clears: true }}
                  placeholder="Use narrator model"
                >
                  <ReasoningSelect
                    label={`${ROLE_NAMES[role]} reasoning`}
                    value={draftContext[reasoningKey]}
                    onChange={(value) => setContextField(reasoningKey, value)}
                  />
                </ModelRow>
              )
            })}
            {draftDevMode && (
              <ModelRow
                name="Reviser"
                value={draftContext.reviserModel}
                onChange={(value) => setContextField('reviserModel', value)}
                choices={modelChoices}
                emptyChoice={{ label: '— pick a preset —', clears: false }}
                placeholder={DEFAULT_REVISER_MODEL}
                title={`Model id used for the optional reviser pass. A small, fast instruction-following model is usually sufficient. Default: ${DEFAULT_REVISER_MODEL}.`}
                disabled={!draftContext.useReviser}
              >
                <label
                  className="flag-field"
                  title={`When on, a reviser pass runs after the narrator: the reviser model takes the narrator's draft and polishes it into clean English. The revised text is shown to the player; the original draft is kept in the trace. Adds one extra request per turn. Default ${DEFAULT_CONTEXT.useReviser ? 'on' : 'off'}.`}
                >
                  <input
                    type="checkbox"
                    checked={draftContext.useReviser}
                    onChange={(e) => setContextField('useReviser', e.target.checked)}
                  />
                  <strong>Run after narrator</strong>
                </label>
              </ModelRow>
            )}
          </div>
          <p className="hint">
            Leave a plotter or summariser model blank to use the narrator model. The xAI button
            above applies the Grok preset: narrator 4.3 off, plotter 4.3 low, summariser 4.3 low;
            Responses API, reviser off. Keeps your adventure and API key. For other providers,
            choose a supported reasoning level or Provider default. Grok 4.7 requires reasoning;
            choose Low or higher.
          </p>
        </fieldset>

        <fieldset className="settings-section">
          <legend>Story</legend>
          <div className="settings-fields">
            <label
              className="span-all"
              title="Standing out-of-character instructions every new adventure starts with, one per line. The DM keeps them, and any you give in play, in the adventure's OOC list."
            >
              <span>Default OOC instructions</span>
              <textarea
                value={draftContext.defaultOoc}
                onChange={(e) => setContextField('defaultOoc', e.target.value)}
                rows={3}
                placeholder="e.g. Keep any gore off-screen."
                disabled={!draftContext.includeOoc}
              />
            </label>
            <label
              className="flag-field span-all"
              title={`When on, the DM is told the player is a consenting adult and may include dark, mature, or NSFW themes if they fit the story. When off, the DM is told to avoid NSFW descriptions or plot developments. Default ${DEFAULT_CONTEXT.nsfw ? 'on' : 'off'}.`}
            >
              <input
                type="checkbox"
                checked={draftContext.nsfw}
                onChange={(e) => setContextField('nsfw', e.target.checked)}
              />
              <strong>Allow NSFW / mature themes</strong>
            </label>
          </div>
        </fieldset>

        <fieldset className="settings-section">
          <legend>Developer</legend>
          <label
            className="flag-field"
            title="Shows the State and Context tabs, the trace and error details beside each reply, and the technical settings. Remembered in this browser. Default off."
          >
            <input
              type="checkbox"
              checked={draftDevMode}
              onChange={(e) => setDraftDevMode(e.target.checked)}
            />
            <strong>Developer mode</strong>
          </label>
          {draftDevMode && (
            <>
              <div className="tuning-grid">
                <label
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
                <label
                  title={`High watermark: when the live tail (turns past the cutoff) reaches this many turns, one compaction event drains it down to the floor. Rarer events preserve the provider's context cache. Also the per-level promotion threshold. Default ${DEFAULT_CONTEXT.compactionThreshold}.`}
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
                  title={`Low watermark: a compaction event folds turns until this many remain live, so events recur every (threshold − floor) turns and the chronicle stays frozen in between. Clamped to at most threshold − batch. Default ${DEFAULT_CONTEXT.compactionFloor}.`}
                >
                  <span>Compaction floor</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={draftContext.compactionFloor}
                    onChange={(e) => setContextField('compactionFloor', Number(e.target.value))}
                  />
                </label>
                <label
                  title={`How many turns or entries to fold per chronicle entry (sub-batch size within a drain event). One chronicle entry covers M raw turns; a level-1 entry covers M²; and so on. Default ${DEFAULT_CONTEXT.compactionBatch}.`}
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

              <h4 className="settings-subhead">Experimental flags</h4>
              <div className="flag-grid">
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
                  title={`When off, the memory tools are not offered — the model has no persistent record of NPCs, locations, plot themes, or key past events. Default ${DEFAULT_CONTEXT.includeMemory ? 'on' : 'off'}.`}
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
                  title={`When off, the live-state tools are not offered — the model has no record of the current scene. Useful for comparing prose quality with/without structured grounding. Default ${DEFAULT_CONTEXT.includeWorldState ? 'on' : 'off'}.`}
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
                  title={`When off, the update_arcs and steer tools are not offered — the narrator writes without arcs or a steer. Default ${DEFAULT_CONTEXT.includePlotOutline ? 'on' : 'off'}.`}
                >
                  <input
                    type="checkbox"
                    checked={draftContext.includePlotOutline}
                    onChange={(e) => setContextField('includePlotOutline', e.target.checked)}
                  />
                  <strong>Include story arcs</strong>
                </label>
                <label
                  className="flag-field"
                  title={`When off, the OOC-instruction tools are not offered — standing player directives only apply while their message remains in the live transcript. Default ${DEFAULT_CONTEXT.includeOoc ? 'on' : 'off'}.`}
                >
                  <input
                    type="checkbox"
                    checked={draftContext.includeOoc}
                    onChange={(e) => setContextField('includeOoc', e.target.checked)}
                  />
                  <strong>Include OOC instructions</strong>
                </label>
              </div>
            </>
          )}
        </fieldset>

        <p className="hint">
          Saving keeps these settings in this browser. They take effect on the next turn.
        </p>
        {settingsError && <p className="error-text" role="alert">{settingsError}</p>}
      </div>
      <footer className="page-actions">
        <button className="ghost" onClick={resetDefaults}>
          Reset to defaults
        </button>
        <span className="spacer" />
        <button className="ghost" onClick={revert} disabled={!dirty}>
          Revert
        </button>
        <button onClick={save} disabled={!dirty}>Save</button>
      </footer>
    </section>
  )
}
