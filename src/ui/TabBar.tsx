export type AppTab = 'play' | 'adventure' | 'saves' | 'settings' | 'state' | 'context'

const PLAYER_TABS: { id: AppTab; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'adventure', label: 'Adventure' },
  { id: 'saves', label: 'Saves' },
  { id: 'settings', label: 'Settings' },
]

// The engine's inner workings, shown only in developer mode.
const DEV_TABS: { id: AppTab; label: string; title: string }[] = [
  { id: 'state', label: 'State', title: 'Memory, live state and the chronicle' },
  { id: 'context', label: 'Context', title: 'The next requests, exactly as they will be posted' },
]

export function TabBar({ tab, devMode, onChange }: {
  tab: AppTab
  devMode: boolean
  onChange: (next: AppTab) => void
}) {
  const button = (t: { id: AppTab; label: string; title?: string }) => (
    <button
      key={t.id}
      role="tab"
      aria-selected={tab === t.id}
      className={`tab ${tab === t.id ? 'active' : ''}`}
      title={t.title}
      onClick={() => onChange(t.id)}
    >
      {t.label}
    </button>
  )
  return (
    <nav className="tab-bar" role="tablist" aria-label="Screens">
      {PLAYER_TABS.map(button)}
      {devMode && (
        <>
          <span className="tab-divider" aria-hidden="true" />
          {DEV_TABS.map(button)}
        </>
      )}
    </nav>
  )
}
