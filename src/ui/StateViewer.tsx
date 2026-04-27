import { useState } from 'react'
import { MAX_PLOT_ITEMS, MAX_PLOT_ITEM_CHARS } from '../engine/tools'
import type { Chronicle, ContextConfig, WorldState } from '../engine/types'

interface StateViewerProps {
  state: WorldState
  plot: string[]
  chronicle: Chronicle
  context: ContextConfig
  onClose: () => void
  onResetState: () => void
  onSaveState: (next: WorldState) => void
  onSavePlot: (next: string[]) => void
  onClearPlot: () => void
  onClearChronicle: () => void
}

function plotToDraft(plot: string[]): string {
  return plot.join('\n')
}

function parsePlotDraft(draft: string): string[] {
  return draft
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length > 0)
}

export function StateViewer({
  state,
  plot,
  chronicle,
  context,
  onClose,
  onResetState,
  onSaveState,
  onSavePlot,
  onClearPlot,
  onClearChronicle,
}: StateViewerProps) {
  const [draft, setDraft] = useState(() => JSON.stringify(state, null, 2))
  const [parseError, setParseError] = useState<string | null>(null)
  const [plotDraft, setPlotDraft] = useState(() => plotToDraft(plot))
  const [plotError, setPlotError] = useState<string | null>(null)

  // Reset local drafts when the parent's prop changes (e.g. after a turn that
  // mutated state/plot). Adjusting state during render — a documented React
  // pattern — instead of useEffect avoids cascading-render lints.
  const [prevState, setPrevState] = useState(state)
  if (prevState !== state) {
    setPrevState(state)
    setDraft(JSON.stringify(state, null, 2))
    setParseError(null)
  }
  const [prevPlot, setPrevPlot] = useState(plot)
  if (prevPlot !== plot) {
    setPrevPlot(plot)
    setPlotDraft(plotToDraft(plot))
    setPlotError(null)
  }

  const currentJson = JSON.stringify(state, null, 2)
  const stateDirty = draft !== currentJson
  const plotDirty = plotDraft !== plotToDraft(plot)

  const totalEntries = chronicle.reduce((n, level) => n + level.length, 0)
  const totalChars = chronicle.reduce(
    (n, level) => n + level.reduce((m, e) => m + e.text.length, 0),
    0,
  )

  function handleSave() {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('State must be a JSON object (e.g. { "scene": {...} }).')
      return
    }
    setParseError(null)
    onSaveState(parsed as WorldState)
  }

  function handleSavePlot() {
    const parsed = parsePlotDraft(plotDraft)
    if (parsed.length > MAX_PLOT_ITEMS) {
      setPlotError(`Too many bullets (${parsed.length}, max ${MAX_PLOT_ITEMS}).`)
      return
    }
    const tooLong = parsed.find((s) => s.length > MAX_PLOT_ITEM_CHARS)
    if (tooLong) {
      setPlotError(`A bullet is too long (${tooLong.length} chars, max ${MAX_PLOT_ITEM_CHARS}).`)
      return
    }
    setPlotError(null)
    onSavePlot(parsed)
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>World State</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="hint">
          The DM maintains this JSON via an <code>update_state</code> tool after each turn.
          It's sent to the model as a system message after the conversation history. Edit
          below and click <em>Save state</em> to override.
        </p>
        <textarea
          className="state-json state-json-editor"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {parseError && <p className="error-text">{parseError}</p>}

        <h2>Plot outline</h2>
        <p className="hint">
          The DM maintains this bullet list via a <code>plot_update</code> tool — a short
          private notebook of directions the story is aiming at. One bullet per line;
          leading <code>-</code> or <code>*</code> is stripped on save. Max {MAX_PLOT_ITEMS}{' '}
          bullets, each up to {MAX_PLOT_ITEM_CHARS} chars. Current: {plot.length} bullet
          {plot.length === 1 ? '' : 's'}.
        </p>
        <textarea
          className="state-json state-json-editor"
          spellCheck={false}
          value={plotDraft}
          onChange={(e) => setPlotDraft(e.target.value)}
          placeholder="(no plot outline yet — one bullet per line)"
        />
        {plotError && <p className="error-text">{plotError}</p>}

        <h2>Chronicle</h2>
        <p className="hint">
          Auto-generated levels of compaction. When the live tail reaches{' '}
          {context.compactionThreshold} turns, the oldest {context.compactionBatch} are
          folded into one chronicle entry of roughly 1/{context.compactionBatch} the
          combined input length. When a level reaches {context.compactionThreshold}{' '}
          entries, the oldest {context.compactionBatch} are promoted into one entry at
          the next level up, recursively. Entries shown oldest-first; newest at the bottom.
          {' '}Current: {totalEntries} entr{totalEntries === 1 ? 'y' : 'ies'} across{' '}
          {chronicle.length} level{chronicle.length === 1 ? '' : 's'} ({totalChars.toLocaleString()} chars).
        </p>
        {totalEntries === 0 ? (
          <p className="hint"><em>(empty — no compaction has happened yet)</em></p>
        ) : (
          <div className="chronicle-levels">
            {[...chronicle]
              .map((entries, level) => ({ entries, level }))
              .reverse()
              .map(({ entries, level }) => {
                if (entries.length === 0) return null
                const isTop = level === chronicle.length - 1
                return (
                  <div key={level} className="chronicle-level">
                    <h3 className="chronicle-level-head">
                      {isTop ? 'Top level' : 'More recent'}
                      <span className="chronicle-level-meta">
                        {' '}
                        — level {level}, {entries.length} entr
                        {entries.length === 1 ? 'y' : 'ies'}
                      </span>
                    </h3>
                    {entries.map((e) => (
                      <div key={e.id} className="chronicle-entry">
                        <div className="chronicle-entry-meta">
                          covers {e.turnsCovered} turn{e.turnsCovered === 1 ? '' : 's'} ·{' '}
                          {e.text.length.toLocaleString()} chars
                        </div>
                        <p className="chronicle-entry-text">{e.text}</p>
                      </div>
                    ))}
                  </div>
                )
              })}
          </div>
        )}

        <div className="modal-actions">
          <button
            className="ghost"
            onClick={() => {
              if (confirm('Reset world state to empty defaults?')) onResetState()
            }}
          >
            Reset state
          </button>
          <button
            className="ghost"
            onClick={() => {
              if (plot.length && confirm('Clear the plot outline?')) onClearPlot()
            }}
            disabled={plot.length === 0}
          >
            Clear plot
          </button>
          <button
            className="ghost"
            onClick={() => {
              if (totalEntries > 0 && confirm('Clear the chronicle and reset compaction cutoff?')) onClearChronicle()
            }}
            disabled={totalEntries === 0}
          >
            Clear chronicle
          </button>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
          <button onClick={handleSave} disabled={!stateDirty}>
            Save state
          </button>
          <button onClick={handleSavePlot} disabled={!plotDirty}>
            Save plot
          </button>
        </div>
      </div>
    </div>
  )
}
