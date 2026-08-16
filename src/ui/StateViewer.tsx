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
  onSaveChronicle: (next: Chronicle) => void
  onClearPlot: () => void
  onClearMemory: () => void
  onClearOoc: () => void
  onClearChronicle: () => void
}

type Tab = 'memory' | 'state' | 'plot' | 'ooc' | 'chronicle'

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
  onSaveChronicle,
  onClearPlot,
  onClearMemory,
  onClearOoc,
  onClearChronicle,
}: StateViewerProps) {
  const [tab, setTab] = useState<Tab>(() =>
    context.includeMemory
      ? 'memory'
      : context.includeWorldState
        ? 'state'
        : context.includePlotOutline
          ? 'plot'
          : context.includeOoc
            ? 'ooc'
            : 'chronicle',
  )
  const [draft, setDraft] = useState(() => JSON.stringify(state, null, 2))
  const [parseError, setParseError] = useState<string | null>(null)
  const [plotDraft, setPlotDraft] = useState(() => plotToDraft(plot))
  const [plotError, setPlotError] = useState<string | null>(null)
  const [oocDraft, setOocDraft] = useState(() => plotToDraft(ooc))
  const [oocError, setOocError] = useState<string | null>(null)
  const [memoryDraft, setMemoryDraft] = useState(() => JSON.stringify(memory, null, 2))
  const [memoryError, setMemoryError] = useState<string | null>(null)
  // Chronicle entry edits, keyed by entry id; an entry not in the map is
  // unedited. Clearing an entry's text deletes it on save.
  const [chronicleDraft, setChronicleDraft] = useState<Record<string, string>>({})

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
  const [prevChronicle, setPrevChronicle] = useState(chronicle)
  if (prevChronicle !== chronicle) {
    setPrevChronicle(chronicle)
    setChronicleDraft({})
  }

  const currentJson = JSON.stringify(state, null, 2)
  const currentMemoryJson = JSON.stringify(memory, null, 2)
  const stateDirty = draft !== currentJson
  const plotDirty = plotDraft !== plotToDraft(plot)
  const oocDirty = oocDraft !== plotToDraft(ooc)
  const memoryDirty = memoryDraft !== currentMemoryJson
  const entryText = (id: string, original: string) => chronicleDraft[id] ?? original
  const chronicleDirty = chronicle.some((level) =>
    level.some((e) => entryText(e.id, e.text) !== e.text),
  )
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

  // Rebuild the chronicle with edited texts; entries cleared to empty are
  // dropped. Metadata (id, turnsCovered, createdAt) is preserved.
  function buildEditedChronicle(): Chronicle {
    return chronicle.map((level) =>
      level
        .map((e) => ({ ...e, text: entryText(e.id, e.text).trim() }))
        .filter((e) => e.text.length > 0),
    )
  }

  const wantState = context.includeWorldState && stateDirty
  const wantPlot = context.includePlotOutline && plotDirty
  const wantOoc = context.includeOoc && oocDirty
  const wantMemory = context.includeMemory && memoryDirty
  const anyDirty = wantState || wantPlot || wantOoc || wantMemory || chronicleDirty

  function handleSaveChanges() {
    const nextState = wantState ? validateState() : undefined
    const nextPlot = wantPlot ? validatePlot() : undefined
    const nextOoc = wantOoc ? validateOoc() : undefined
    const nextMemory = wantMemory ? validateMemory() : undefined
    // On validation failure, jump to the first failing tab so the inline
    // error is visible even if the user edited it on another tab.
    const firstInvalid: Tab | null =
      wantMemory && nextMemory === null
        ? 'memory'
        : wantState && nextState === null
          ? 'state'
          : wantPlot && nextPlot === null
            ? 'plot'
            : wantOoc && nextOoc === null
              ? 'ooc'
              : null
    if (firstInvalid) {
      setTab(firstInvalid)
      return
    }
    if (nextState !== undefined && nextState !== null) onSaveState(nextState)
    if (nextPlot !== undefined && nextPlot !== null) onSavePlot(nextPlot)
    if (nextOoc !== undefined && nextOoc !== null) onSaveOoc(nextOoc)
    if (nextMemory !== undefined && nextMemory !== null) onSaveMemory(nextMemory)
    if (chronicleDirty) onSaveChronicle(buildEditedChronicle())
  }

  const tabs: { id: Tab; label: string; dirty: boolean }[] = [
    ...(context.includeMemory
      ? [{ id: 'memory' as Tab, label: `Memory (${memoryEntries})`, dirty: memoryDirty }]
      : []),
    ...(context.includeWorldState
      ? [{ id: 'state' as Tab, label: 'Live state', dirty: stateDirty }]
      : []),
    ...(context.includePlotOutline
      ? [{ id: 'plot' as Tab, label: `Plot (${plot.length})`, dirty: plotDirty }]
      : []),
    ...(context.includeOoc
      ? [{ id: 'ooc' as Tab, label: `OOC (${ooc.length})`, dirty: oocDirty }]
      : []),
    { id: 'chronicle' as Tab, label: `Chronicle (${totalEntries})`, dirty: chronicleDirty },
  ]

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <div className="ctx-head-block">
          <div className="modal-header">
            <h2>Engine state</h2>
            <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
          </div>
          <div className="ctx-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={`ctx-tab ${tab === t.id ? 'active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.dirty ? ' •' : ''}
              </button>
            ))}
          </div>
        </div>

        {busy && (
          <p className="hint">
            Generation is continuing in the background. State data is view-only until it finishes or is cancelled.
          </p>
        )}

        {tab === 'memory' && context.includeMemory && (
          <>
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
              className="state-json state-json-editor tab-editor"
              spellCheck={false}
              value={memoryDraft}
              onChange={(e) => setMemoryDraft(e.target.value)}
              readOnly={busy}
              placeholder="(no memory yet — call update_memory or paste JSON here)"
            />
            {memoryError && <p className="error-text">{memoryError}</p>}
          </>
        )}

        {tab === 'state' && context.includeWorldState && (
          <>
            <p className="hint">
              The DM maintains this JSON via the <code>update_state</code> tool — the{' '}
              <strong>current scene only</strong>. Player's immediate position, what NPCs
              are present right now, the active stimulus. On scene change, stale keys are
              deleted.
            </p>
            <textarea
              className="state-json state-json-editor tab-editor"
              spellCheck={false}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              readOnly={busy}
            />
            {parseError && <p className="error-text">{parseError}</p>}
          </>
        )}

        {tab === 'plot' && context.includePlotOutline && (
          <>
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
              className="state-json state-json-editor tab-editor"
              spellCheck={false}
              value={plotDraft}
              onChange={(e) => setPlotDraft(e.target.value)}
              readOnly={busy}
              placeholder="(no future plot plan yet — one entry per line)"
            />
            {plotError && <p className="error-text">{plotError}</p>}
          </>
        )}

        {tab === 'ooc' && context.includeOoc && (
          <>
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
              className="state-json state-json-editor tab-editor"
              spellCheck={false}
              value={oocDraft}
              onChange={(e) => setOocDraft(e.target.value)}
              readOnly={busy}
              placeholder="(no standing OOC instructions — one entry per line)"
            />
            {oocError && <p className="error-text">{oocError}</p>}
          </>
        )}

        {tab === 'chronicle' && (
          <>
            <p className="hint">
              Auto-generated levels of compaction. When the live tail reaches{' '}
              {context.compactionThreshold} turns, the oldest {context.compactionBatch} are
              folded into one chronicle entry of roughly 1/{context.compactionBatch} the
              combined input length. When a level reaches {context.compactionThreshold}{' '}
              entries, the oldest {context.compactionBatch} are promoted into one entry at
              the next level up, recursively. Entries shown oldest-first; newest at the
              bottom. Entries are editable — clear an entry&apos;s text to delete it on save.
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
                              {entryText(e.id, e.text).length.toLocaleString()} chars
                              {entryText(e.id, e.text) !== e.text && ' · edited'}
                            </div>
                            <textarea
                              className="state-json state-json-editor chronicle-entry-edit"
                              spellCheck={false}
                              value={entryText(e.id, e.text)}
                              onChange={(ev) =>
                                setChronicleDraft((d) => ({ ...d, [e.id]: ev.target.value }))
                              }
                              readOnly={busy}
                            />
                          </div>
                        ))}
                      </div>
                    )
                  })}
              </div>
            )}
          </>
        )}

        <div className="modal-actions pinned">
          {tab === 'memory' && (
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
          {tab === 'state' && (
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
          {tab === 'plot' && (
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
          {tab === 'ooc' && (
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
          {tab === 'chronicle' && (
            <button
              className="ghost"
              onClick={() => {
                if (totalEntries > 0 && confirm('Clear the chronicle and reset compaction cutoff?')) onClearChronicle()
              }}
              disabled={busy || totalEntries === 0}
            >
              Clear chronicle
            </button>
          )}
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
