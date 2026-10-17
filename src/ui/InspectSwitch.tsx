export type InspectView = 'state' | 'context'

const VIEWS: { id: InspectView; label: string }[] = [
  { id: 'state', label: 'State' },
  { id: 'context', label: 'Context' },
]

// Switches the Inspect panel between the engine state and the context for
// the next request.
export function InspectSwitch({ view, onChange }: { view: InspectView; onChange: (next: InspectView) => void }) {
  return (
    <div className="inspect-switch" role="tablist" aria-label="Inspect">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          role="tab"
          aria-selected={view === v.id}
          className={`ctx-tab ${view === v.id ? 'active' : ''}`}
          onClick={() => {
            if (view !== v.id) onChange(v.id)
          }}
        >
          {v.label}
        </button>
      ))}
    </div>
  )
}
