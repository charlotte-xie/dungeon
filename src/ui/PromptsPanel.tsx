import { useState } from 'react'
import { usePromptOverrides } from '../hooks/usePromptOverrides'
import { useReportDirty } from '../hooks/useReportDirty'
import { PROMPT_DEFAULTS, PROMPT_FILES, missingSections, type PromptFile } from '../prompts'
import { InspectScreen } from './InspectScreen'

// Every prompt file, to edit and try in play. An edit applies from the next
// request and stays in this browser until it is reset to the default.
export function PromptsPanel({ busy, onDirtyChange }: { busy: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const { edits, save, reset, resetAll } = usePromptOverrides()
  const [selected, setSelected] = useState<PromptFile>(PROMPT_FILES[0])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const current = (file: PromptFile) => edits[file] ?? PROMPT_DEFAULTS[file]
  const draft = (file: PromptFile) => drafts[file] ?? current(file)
  const isDirty = (file: PromptFile) => draft(file) !== current(file)
  const forgetDraft = (file: PromptFile) =>
    setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([name]) => name !== file)))
  useReportDirty(PROMPT_FILES.some(isDirty), onDirtyChange)

  const edited = Object.hasOwn(edits, selected)
  const editedCount = Object.keys(edits).length
  const sections = PROMPT_FILES.map((file) => ({
    id: file,
    label: `${file.replace(/\.md$/, '')}${Object.hasOwn(edits, file) ? ' (edited)' : ''}`,
    dirty: isDirty(file),
  }))

  function handleSave() {
    const missing = missingSections(selected, draft(selected))
    if (missing.length) {
      setError(`Keep every section the app reads: ${missing.map((name) => `## ${name}`).join(', ')}.`)
      return
    }
    save(selected, draft(selected))
    forgetDraft(selected)
    setError(null)
  }

  return (
    <InspectScreen
      title="Prompts"
      sections={sections}
      selected={selected}
      onSelect={(id) => {
        setSelected(id as PromptFile)
        setError(null)
      }}
      actions={
        <>
          <button
            className="ghost"
            onClick={() => {
              if (confirm(`Drop your edits to ${editedCount === 1 ? 'one prompt' : `${editedCount} prompts`} and use the defaults?`)) {
                resetAll()
                setDrafts({})
                setError(null)
              }
            }}
            disabled={busy || editedCount === 0}
          >
            Reset all
          </button>
          <button
            className="ghost"
            onClick={() => {
              if (confirm(`Drop your edit to ${selected} and use the default?`)) {
                reset(selected)
                forgetDraft(selected)
                setError(null)
              }
            }}
            disabled={busy || !edited}
          >
            Reset to default
          </button>
          <span className="spacer" />
          <button
            className="ghost"
            onClick={() => {
              forgetDraft(selected)
              setError(null)
            }}
            disabled={!isDirty(selected)}
          >
            Revert
          </button>
          <button onClick={handleSave} disabled={busy || !isDirty(selected)}>
            Save
          </button>
        </>
      }
    >
      <p className="hint">
        {edited ? 'Edited: the app uses your version of this prompt.' : 'The default, as the app ships it.'} An edit
        applies from the next request and stays in this browser until you reset it; the role that reads it starts its
        cache afresh. Keep the <code>## name</code> headings and <code>{'{{name}}'}</code> placeholders: the app reads
        and fills them.
        {busy && ' Read-only while a turn is running.'}
      </p>
      <textarea
        className="state-json state-json-editor tab-editor"
        spellCheck={false}
        value={draft(selected)}
        onChange={(e) => setDrafts((d) => ({ ...d, [selected]: e.target.value }))}
        readOnly={busy}
      />
      {error && <p className="error-text" role="alert">{error}</p>}
    </InspectScreen>
  )
}
