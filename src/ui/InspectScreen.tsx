import type { ReactNode } from 'react'

export interface InspectSection {
  id: string
  label: string
  // Marks a section with unsaved edits.
  dirty?: boolean
  // Marks a section whose saved content differs from its default.
  edited?: boolean
  // Greys out a section for something switched off.
  muted?: boolean
}

interface InspectScreenProps {
  title: string
  sections: InspectSection[]
  selected: string
  onSelect: (id: string) => void
  // The selected section's actions, along the bottom.
  actions?: ReactNode
  children: ReactNode
}

// A developer tab fills the space under the tab bar: its sections down the
// side, the selected section's content scrolling in the middle, and its
// actions along the bottom. Its size never follows its content.
export function InspectScreen({ title, sections, selected, onSelect, actions, children }: InspectScreenProps) {
  return (
    <section className="inspect-screen" aria-label={title}>
      <nav className="inspect-nav" aria-label="Sections">
        {sections.map((s) => (
          <button
            key={s.id}
            className={[s.id === selected && 'active', s.edited && 'edited', s.muted && 'muted']
              .filter(Boolean)
              .join(' ')}
            aria-current={s.id === selected}
            title={s.edited ? 'Edited: differs from the default' : undefined}
            onClick={() => onSelect(s.id)}
          >
            {s.label}
            {s.dirty ? ' •' : ''}
          </button>
        ))}
      </nav>
      <main className="inspect-main">{children}</main>
      {actions && <footer className="inspect-actions">{actions}</footer>}
    </section>
  )
}
