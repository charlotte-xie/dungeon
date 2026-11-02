import { useRef, useState } from 'react'

// A message in the story, edited in place. Whether it is open for editing is
// the caller's, so an action elsewhere, such as Edit under the latest reply,
// can open it too.
export function EditableMessage({
  text,
  editing,
  onEditingChange,
  onSave,
}: {
  text: string
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onSave: (next: string) => void
}) {
  if (editing) {
    return (
      <div className="msg-editable">
        <MessageEditor
          text={text}
          onDone={(next) => {
            if (next !== null && next !== text) onSave(next)
            onEditingChange(false)
          }}
        />
      </div>
    )
  }

  return (
    <div className="msg-editable">
      <p className="msg-text" title="Double-click to edit" onDoubleClick={() => onEditingChange(true)}>
        {text}
      </p>
      <button
        className="msg-edit-btn"
        aria-label="Edit message"
        title="Edit"
        onClick={() => onEditingChange(true)}
      >
        ✎
      </button>
    </div>
  )
}

// The draft starts from the message each time the editor opens. It finishes
// once, with the draft or with null when cancelled, so a blur as it closes
// can't save a cancelled edit.
function MessageEditor({ text, onDone }: { text: string; onDone: (next: string | null) => void }) {
  const [draft, setDraft] = useState(text)
  const finished = useRef(false)

  const finish = (next: string | null) => {
    if (finished.current) return
    finished.current = true
    onDone(next)
  }

  const autosize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  return (
    <textarea
      className="msg-edit"
      value={draft}
      autoFocus
      onChange={(e) => {
        setDraft(e.target.value)
        autosize(e.currentTarget)
      }}
      onFocus={(e) => {
        autosize(e.currentTarget)
        const len = e.currentTarget.value.length
        e.currentTarget.setSelectionRange(len, len)
      }}
      onBlur={() => finish(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          finish(null)
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}
