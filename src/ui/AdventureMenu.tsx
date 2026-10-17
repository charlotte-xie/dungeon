import { useEffect, useRef, useState } from 'react'

interface AdventureMenuProps {
  newTitle: string
  onNew: () => void
  onSaves: () => void
}

// Adventure-level actions behind one header button.
export function AdventureMenu({ newTitle, onNew, onSaves }: AdventureMenuProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function choose(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <div className="menu" ref={ref}>
      <button
        className="ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Adventure ▾
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <button role="menuitem" title={newTitle} onClick={() => choose(onNew)}>
            New adventure
          </button>
          <button role="menuitem" onClick={() => choose(onSaves)}>
            Saves
          </button>
        </div>
      )}
    </div>
  )
}
