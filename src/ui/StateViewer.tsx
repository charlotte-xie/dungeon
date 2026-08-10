import { useState } from 'react'
import {
  MAX_OOC_ITEMS,
  MAX_OOC_ITEM_CHARS,
  MAX_PLOT_ITEMS,
  MAX_PLOT_ITEM_CHARS,
} from '../engine/tools'
import type { Chronicle, ContextConfig, Memory, WorldState } from '../engine/types'

interface StateViewerProps {
  state: WorldState
  plot: string[]
  memory: Memory
  ooc: string[]
  chronicle: Chronicle
  context: ContextConfig
  busy: boolean
  onClose: () => void
  onResetState: () => void
  onSaveState: (next: WorldState) => void
  onSavePlot: (next: string[]) => void
  onSaveMemory: (next: Memory) => void
  onSaveOoc: (next: string[]) => void
  onClearPlot: () => void
  onClearMemory: () => void
  onClearOoc: () => void
  onClearChronicle: () => void
}

function plotToDraft(plot: string[]): string {
  return plot.map((p, i) => `${i + 1}. ${p}`).join('\n')
}

function parsePlotDraft(draft: string): string[] {
  return draft
    .split('\n')
    .map((line) =>
      line
        // Strip any line-leading list prefix: an arbitrary positive integer
        // followed by ., ), :, or ] (so re-ordered/non-sequential numbering
        // survives a round-trip), or a -, *, or • bullet.
        .replace(/^\s*(?:\d+[.):\]]\s+|[-*•]\s+)/, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
}

export function StateViewer({
  state,
  plot,
  memory,
  ooc,
  chronicle,
  context,
  busy,
  onClose,
  onResetState,
  onSaveState,
  onSavePlot,
  onSaveMemory,
  onSaveOoc,
  onClearPlot,
  onClearMemory,
  onClearOoc,
  onClearChronicle,
}: StateViewerProps) {
  const [draft, setDraft] = useState(() => JSON.stringify(state, null, 2))
  const [parseError, setParseError] = useState<string | null>(null)
  const [plotDraft, setPlotDraft] = useState(() => plotToDraft(plot))
  const [plotError, setPlotError] = useState<string | null>(null)
  const [oocDraft, setOocDraft] = useState(() => plotToDraft(ooc))
  const [oocError, setOocError] = useState<string | null>(null)
  const [memoryDraft, setMemoryDraft] = useState(() => JSON.stringify(memory, null, 2))
  const [memoryError, setMemoryError] = useState<string | null>(null)

  // Reset local drafts when the parent's prop changes (e.g. after a turn that
  // mutated state/plot/memory). Adjusting state during render — a documented
  // React pattern — instead of useEffect avoids cascading-render lints.
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
  const [prevMemory, setPrevMemory] = useState(memory)
  if (prevMemory !== memory) {
    setPrevMemory(memory)
    setMemoryDraft(JSON.stringify(memory, null, 2))
    setMemoryError(null)
  }
  const [prevOoc, setPrevOoc] = useState(ooc)
  if (prevOoc !== ooc) {
    setPrevOoc(ooc)
    setOocDraft(plotToDraft(ooc))
    setOocError(null)
  }

  const currentJson = JSON.stringify(state, null, 2)
  const currentMemoryJson = JSON.stringify(memory, null, 2)
  const stateDirty = draft !== currentJson
  const plotDirty = plotDraft !== plotToDraft(plot)
  const oocDirty = oocDraft !== plotToDraft(ooc)
  const memoryDirty = memoryDraft !== currentMemoryJson
  const memoryEntries = Object.keys(memory).length

  const totalEntries = chronicle.reduce((n, level) => n + level.length, 0)
  const totalChars = chronicle.reduce(
    (n, level) => n + level.reduce((m, e) => m + e.text.length, 0),
    0,
  )

  // Validators: return the parsed value on success, null on failure (setting
  // the section's inline error either way). Save Changes is atomic — it saves
  // nothing unless every dirty section validates.
  function validateState(): WorldState | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
      return null
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setParseError('State must be a JSON object (e.g. { "scene": {...} }).')
      return null
    }
    setParseError(null)
    return parsed as WorldState
  }

  function validatePlot(): string[] | null {
    const parsed = parsePlotDraft(plotDraft)
    if (parsed.length > MAX_PLOT_ITEMS) {
      setPlotError(`Too many bullets (${parsed.length}, max ${MAX_PLOT_ITEMS}).`)
      return null
    }
    const tooLong = parsed.find((s) => s.length > MAX_PLOT_ITEM_CHARS)
    if (tooLong) {
      setPlotError(`A bullet is too long (${tooLong.length} chars, max ${MAX_PLOT_ITEM_CHARS}).`)
      return null
    }
    setPlotError(null)
    return parsed
  }

  function validateOoc(): string[] | null {
    const parsed = parsePlotDraft(oocDraft)
    if (parsed.length > MAX_OOC_ITEMS) {
      setOocError(`Too many entries (${parsed.length}, max ${MAX_OOC_ITEMS}).`)
      return null
    }
    const tooLong = parsed.find((s) => s.length > MAX_OOC_ITEM_CHARS)
    if (tooLong) {
      setOocError(`An entry is too long (${tooLong.length} chars, max ${MAX_OOC_ITEM_CHARS}).`)
      return null
    }
    setOocError(null)
    return parsed
  }

  function validateMemory(): Memory | null {
    let parsed: unknown
    try {
      parsed = JSON.parse(memoryDraft)
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : String(err))
      return null
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setMemoryError('Memory must be a JSON object mapping slugs to entries.')
      return null
    }
    setMemoryError(null)
    return parsed as Memory
  }

  const wantState = context.includeWorldState && stateDirty
  const wantPlot = context.includePlotOutline && plotDirty
  const wantOoc = context.includeOoc && oocDirty
  const wantMemory = context.includeMemory && memoryDirty
  const anyDirty = wantState || wantPlot || wantOoc || wantMemory

  function handleSaveChanges() {
    const nextState = wantState ? validateState() : undefined
    const nextPlot = wantPlot ? validatePlot() : undefined
    const nextOoc = wantOoc ? validateOoc() : undefined
    const nextMemory = wantMemory ? validateMemory() : undefined
    if (
      (wantState && nextState === null) ||
      (wantPlot && nextPlot === null) ||
      (wantOoc && nextOoc === null) ||
      (wantMemory && nextMemory === null)
    ) {
      return
    }
    if (nextState !== undefined && nextState !== null) onSaveState(nextState)
    if (nextPlot !== undefined && nextPlot !== null) onSavePlot(nextPlot)
    if (nextOoc !== undefined && nextOoc !== null) onSaveOoc(nextOoc)
    if (nextMemory !== undefined && nextMemory !== null) onSaveMemory(nextMemory)
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>Engine state</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>

        {busy && (
          <p className="hint">
            Generation is continuing in the background. State data is view-only until it finishes or is cancelled.
          </p>
        )}

        {context.includeMemory && (
          <>
            <h2>Long-term memory</h2>
            <p className="hint">
              The DM maintains this JSON via the <code>update_memory</code> tool — the
              fact file of <strong>people, places, and things</strong> that persist across
              scenes. Each key is a slug; each value is an object of short string facets
              (<code>is</code>, <code>wants</code>, <code>knows</code>, <code>bond</code>,{' '}
              <code>secret</code>, …). Edits are additive by dotted path, with rename via{' '}
              <code>move</code>. Current: {memoryEntries} entr
              {memoryEntries === 1 ? 'y' : 'ies'}.
            </p>
            <textarea
              className="state-json state-json-editor"
              spellCheck={false}
              value={memoryDraft}
              onChange={(e) => setMemoryDraft(e.target.value)}
              readOnly={busy}
              placeholder="(no memory yet — call update_memory or paste JSON here)"
            />
            {memoryError && <p className="error-text">{memoryError}</p>}
          </>
        )}

        {context.includeWorldState && (
          <>
            <h2>Live state (current scene)</h2>
            <p className="hint">
              The DM maintains this JSON via the <code>update_state</code> tool — the{' '}
              <strong>current scene only</strong>. Player's immediate position, what NPCs
              are present right now, the active stimulus. On scene change, stale keys are
              deleted.
            </p>
            <textarea
              className="state-json state-json-editor"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              readOnly={busy}
            />
            {parseError && <p className="error-text">{parseError}</p>}
          </>
        )}

        {context.includePlotOutline && (
          <>
            <h2>Future plot plan</h2>
            <p className="hint">
              The DM maintains this numbered list via the <code>future_plot_plan</code> tool
              (append/insert/update/delete by 1-indexed position) — a short private notebook
              of plot directions the story is heading in. Keeping it lively is the DM's job.{' '}
              <strong>Future only:</strong> entries should describe what is still ahead of the
              player; past events should be deleted as they play out. One entry per line;
              leading <code>-</code>, <code>*</code>, or{' '}
              <code>1.</code> numbering is stripped on save. Max {MAX_PLOT_ITEMS} entries,
              each up to {MAX_PLOT_ITEM_CHARS} chars. Current: {plot.length} entr
              {plot.length === 1 ? 'y' : 'ies'}.
            </p>
            <textarea
              className="state-json state-json-editor"
              spellCheck={false}
              value={plotDraft}
              onChange={(e) => setPlotDraft(e.target.value)}
              readOnly={busy}
              placeholder="(no future plot plan yet — one entry per line)"
            />
            {plotError && <p className="error-text">{plotError}</p>}
          </>
        )}

        {context.includeOoc && (
          <>
            <h2>OOC instructions</h2>
            <p className="hint">
              The DM maintains this numbered list via the <code>update_ooc</code> tool
              (append/insert/update/delete by 1-indexed position) — the player's{' '}
              <strong>standing out-of-character directives</strong>: style and pacing
              preferences, boundaries, and corrections that should keep applying. Entries
              are deleted when withdrawn, completed, or no longer relevant. One entry per
              line; leading <code>-</code>, <code>*</code>, or <code>1.</code> numbering
              is stripped on save. Max {MAX_OOC_ITEMS} entries, each up to{' '}
              {MAX_OOC_ITEM_CHARS} chars. Current: {ooc.length} entr
              {ooc.length === 1 ? 'y' : 'ies'}.
            </p>
            <textarea
              className="state-json state-json-editor"
              spellCheck={false}
              value={oocDraft}
              onChange={(e) => setOocDraft(e.target.value)}
              readOnly={busy}
              placeholder="(no standing OOC instructions — one entry per line)"
            />
            {oocError && <p className="error-text">{oocError}</p>}
          </>
        )}

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

        <div className="modal-actions pinned">
          {context.includeMemory && (
            <button
              className="ghost"
              onClick={() => {
                if (memoryEntries > 0 && confirm('Clear all long-term memory?')) onClearMemory()
              }}
              disabled={busy || memoryEntries === 0}
            >
              Clear memory
            </button>
          )}
          {context.includeWorldState && (
            <button
              className="ghost"
              onClick={() => {
                if (confirm('Reset live state to empty defaults?')) onResetState()
              }}
              disabled={busy}
            >
              Reset state
            </button>
          )}
          {context.includePlotOutline && (
            <button
              className="ghost"
              onClick={() => {
                if (plot.length && confirm('Clear the future plot plan?')) onClearPlot()
              }}
              disabled={busy || plot.length === 0}
            >
              Clear plan
            </button>
          )}
          {context.includeOoc && (
            <button
              className="ghost"
              onClick={() => {
                if (ooc.length && confirm('Clear all standing OOC instructions?')) onClearOoc()
              }}
              disabled={busy || ooc.length === 0}
            >
              Clear OOC
            </button>
          )}
          <button
            className="ghost"
            onClick={() => {
              if (totalEntries > 0 && confirm('Clear the chronicle and reset compaction cutoff?')) onClearChronicle()
            }}
            disabled={busy || totalEntries === 0}
          >
            Clear chronicle
          </button>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
          <button onClick={handleSaveChanges} disabled={busy || !anyDirty}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  )
}
