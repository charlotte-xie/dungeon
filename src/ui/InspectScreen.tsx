import type { ReactNode } from 'react'
import { InspectSwitch, type InspectView } from './InspectSwitch'

export interface InspectSection {
  id: string
  label: string
  // Marks a section with unsaved edits.
  dirty?: boolean
}

interface InspectScreenProps {
  view: InspectView
  title: string
  sections: InspectSection[]
  selected: string
  onSelect: (id: string) => void
  onInspect: (view: InspectView) => void
  onClose: () => void
  // The selected section's actions, along the bottom.
  actions?: ReactNode
  children: ReactNode
}

// The Inspect screen fills the window: its bar across the top, its sections
// down the side, the selected section's content scrolling in the middle, and
// its actions along the bottom. Its size never follows its content.
export function InspectScreen({
  view,
  title,
  sections,
  selected,
  onSelect,
  onInspect,
  onClose,
  actions,
  children,
}: InspectScreenProps) {
  return (
    <div className="inspect-screen" role="dialog" aria-label={title}>
      <header className="inspect-bar">
        <h2>{title}</h2>
        <InspectSwitch view={view} onChange={onInspect} />
        <span className="spacer" />
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </header>
      <nav className="inspect-nav" aria-label="Sections">
        {sections.map((s) => (
          <button
            key={s.id}
            className={s.id === selected ? 'active' : ''}
            aria-current={s.id === selected}
            onClick={() => onSelect(s.id)}
          >
            {s.label}
            {s.dirty ? ' •' : ''}
          </button>
        ))}
      </nav>
      <main className="inspect-main">{children}</main>
      {actions && <footer className="inspect-actions">{actions}</footer>}
    </div>
  )
}
