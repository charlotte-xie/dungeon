import { useState } from 'react'

export function EditableMessage({
  text,
  onSave,
}: {
  text: string
  onSave: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)

  if (!editing) {
    return (
      <p
        title="Double-click to edit"
        onDoubleClick={() => {
          setDraft(text)
          setEditing(true)
        }}
      >
        {text}
      </p>
    )
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
      onBlur={() => {
        if (draft !== text) onSave(draft)
        setEditing(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(text)
          setEditing(false)
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
    />
  )
}
