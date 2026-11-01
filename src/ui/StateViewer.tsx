import { useState } from 'react'
import { withoutEntries } from '../engine/chronicle'
import type { Chronicle, ContextConfig, Memory, WorldState } from '../engine/types'
import { useReportDirty } from '../hooks/useReportDirty'
import { InspectScreen } from './InspectScreen'

interface StateViewerProps {
  state: WorldState
  memory: Memory
  chronicle: Chronicle
  // Each chronicle entry's first and last turn, numbered as in the log.
  entryTurns: Map<string, { first: number; last: number }>
  // Whether older turns are being folded in the background.
  compacting: boolean
  context: ContextConfig
  busy: boolean
  canCompact: boolean
  canForceCompact: boolean
  onCompact: () => void
  onForceCompact: () => void
  onRebuildChronicle: () => void
  onResetState: () => void
  onSaveState: (next: WorldState) => void
  onSaveMemory: (next: Memory) => void
  onSaveChronicle: (next: Chronicle) => void
  onClearMemory: () => void
  onClearChronicle: () => void
  onDirtyChange: (dirty: boolean) => void
}

type Tab = 'memory' | 'state' | 'chronicle'

function turnsLabel(turns: { first: number; last: number } | undefined): string {
  if (!turns) return 'turns unknown'
  return turns.first === turns.last ? `turn ${turns.first}` : `turns ${turns.first}–${turns.last}`
}

export function StateViewer({
  state,
  memory,
  chronicle,
  entryTurns,
  compacting,
  context,
  busy,
  canCompact,
  canForceCompact,
  onCompact,
  onForceCompact,
  onRebuildChronicle,
  onResetState,
  onSaveState,
  onSaveMemory,
  onSaveChronicle,
  onClearMemory,
  onClearChronicle,
  onDirtyChange,
}: StateViewerProps) {
  const [tab, setTab] = useState<Tab>(() =>
    context.includeMemory
      ? 'memory'
      : context.includeWorldState
        ? 'state'
        : 'chronicle',
  )
  const [draft, setDraft] = useState(() => JSON.stringify(state, null, 2))
  const [parseError, setParseError] = useState<string | null>(null)
  const [memoryDraft, setMemoryDraft] = useState(() => JSON.stringify(memory, null, 2))
  const [memoryError, setMemoryError] = useState<string | null>(null)
  // Chronicle entry edits, keyed by entry id; an entry not in the map is
  // unedited. Clearing an entry's text deletes it on save.
  const [chronicleDraft, setChronicleDraft] = useState<Record<string, string>>({})

  // Reset local drafts when the parent's prop changes (e.g. after a turn that
  // mutated state or memory). Adjusting state during render — a documented
  // React pattern — instead of useEffect avoids cascading-render lints.
  const [prevState, setPrevState] = useState(state)
  if (prevState !== state) {
    setPrevState(state)
    setDraft(JSON.stringify(state, null, 2))
    setParseError(null)
  }
  const [prevMemory, setPrevMemory] = useState(memory)
  if (prevMemory !== memory) {
    setPrevMemory(memory)
    setMemoryDraft(JSON.stringify(memory, null, 2))
    setMemoryError(null)
  }
  const [prevChronicle, setPrevChronicle] = useState(chronicle)
  if (prevChronicle !== chronicle) {
    setPrevChronicle(chronicle)
    setChronicleDraft({})
  }

  const currentJson = JSON.stringify(state, null, 2)
  const currentMemoryJson = JSON.stringify(memory, null, 2)
  const stateDirty = draft !== currentJson
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
  // dropped, their turns joining a neighbouring entry. Metadata (id, turns,
  // createdAt) is preserved.
  function buildEditedChronicle(): Chronicle {
    const edited = chronicle.map((level) => level.map((e) => ({ ...e, text: entryText(e.id, e.text).trim() })))
    return withoutEntries(edited, new Set(edited.flat().filter((e) => !e.text).map((e) => e.id)))
  }

  const wantState = context.includeWorldState && stateDirty
  const wantMemory = context.includeMemory && memoryDirty
  const anyDirty = wantState || wantMemory || chronicleDirty
  useReportDirty(anyDirty, onDirtyChange)

  function handleSaveChanges() {
    const nextState = wantState ? validateState() : undefined
    const nextMemory = wantMemory ? validateMemory() : undefined
    // On validation failure, jump to the first failing tab so the inline
    // error is visible even if the user edited it on another tab.
    const firstInvalid: Tab | null =
      wantMemory && nextMemory === null
        ? 'memory'
        : wantState && nextState === null
          ? 'state'
          : null
    if (firstInvalid) {
      setTab(firstInvalid)
      return
    }
    if (nextState !== undefined && nextState !== null) onSaveState(nextState)
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
    { id: 'chronicle' as Tab, label: `Chronicle (${totalEntries})`, dirty: chronicleDirty },
  ]

  return (
    <InspectScreen
      title="Engine state"
      sections={tabs}
      selected={tab}
      onSelect={(id) => setTab(id as Tab)}
      actions={
        <>
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
          {tab === 'chronicle' && canCompact && (
            <button
              className="ghost"
              onClick={onCompact}
              disabled={busy || anyDirty}
              title={anyDirty ? 'Save or discard your edits first' : 'Fold older turns into the chronicle now'}
            >
              Compact now
            </button>
          )}
          {tab === 'chronicle' && canForceCompact && (
            <button
              className="ghost"
              onClick={onForceCompact}
              disabled={busy || anyDirty}
              title={
                anyDirty
                  ? 'Save or discard your edits first'
                  : 'Fold every turn but the latest into the chronicle now, whether or not compaction is due'
              }
            >
              Force compact
            </button>
          )}
          {tab === 'chronicle' && totalEntries > 0 && (
            <button
              className="ghost"
              onClick={onRebuildChronicle}
              disabled={busy || anyDirty}
              title={anyDirty ? 'Save or discard your edits first' : 'Write every summary afresh from the turns it covers'}
            >
              Rebuild
            </button>
          )}
          {tab === 'chronicle' && (
            <button
              className="ghost"
              onClick={() => {
                if (totalEntries > 0 && confirm('Clear the chronicle? The model sees every turn in full again.')) onClearChronicle()
              }}
              disabled={busy || totalEntries === 0}
            >
              Clear chronicle
            </button>
          )}
          <span className="spacer" />
          <button onClick={handleSaveChanges} disabled={busy || !anyDirty}>
            Save Changes
          </button>
        </>
      }
    >
      {busy && (
        <p className="hint">
          Generation is continuing in the background. State data is view-only until it finishes or is cancelled.
        </p>
      )}

      {tab === 'memory' && context.includeMemory && (
        <>
          <p className="hint">
            The DM maintains this JSON via the <code>update_memory</code> tool — the
            fact file of <strong>people, places, things and threads</strong> that persist across
            scenes. Each key is a slug (<code>hesta</code>, <code>mill_lane</code>); each value is an object of facets: short values,
            sentences for facts, or maps of either (<code>is</code>, <code>personality</code>,{' '}
            <code>wants</code>, <code>attitude</code>, <code>secrets</code>, …). Edits go by dotted path: <code>set</code> replaces
            the entire value at a path, <code>merge</code> adds keys to an object, and <code>move</code> renames.
            Current: {memoryEntries} entr
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

      {tab === 'chronicle' && (
        <>
          <p className="hint">
            Summaries of older turns, written in the background after a reply. When{' '}
            {context.compactionThreshold} turns are live, the oldest are folded in batches of{' '}
            {context.compactionBatch} until {context.compactionFloor} remain, each into an entry of
            at most one turn&apos;s length, written with the entries before it in view. When a level
            reaches {context.compactionThreshold} entries, its oldest {context.compactionBatch} are
            combined into one entry at the next level up, written afresh from their turns. Entries
            shown oldest first; newest at the bottom. Entries are editable — clear an entry&apos;s
            text to delete it on save, and its turns join a neighbouring entry.
            {' '}Current: {totalEntries} entr{totalEntries === 1 ? 'y' : 'ies'} across{' '}
            {chronicle.length} level{chronicle.length === 1 ? '' : 's'} ({totalChars.toLocaleString()} chars).
          </p>
          {compacting && (
            <p className="hint">
              <em>Folding older turns into the chronicle in the background…</em>
            </p>
          )}
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
                            {turnsLabel(entryTurns.get(e.id))} ·{' '}
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
    </InspectScreen>
  )
}
