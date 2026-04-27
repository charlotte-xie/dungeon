import type { ModelCall, TraceEvent } from '../engine/types'

export interface ModelCallView {
  // Short human label shown as the section header (e.g. 'planner', 'narrator').
  label: string
  call: ModelCall
  // When true, omit the call's text from the trace pane — useful for the
  // narrator's reply, since its text is already shown in the message bubble.
  hideText?: boolean
}

interface TraceViewProps {
  calls: ModelCallView[]
  expanded: boolean
  onToggle: () => void
}

function formatToolArgs(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return trimmed
  }
}

function summarizeCall(view: ModelCallView): string {
  const trace = view.call.trace ?? []
  const calls = trace.filter((e) => e.kind === 'call').length
  const thoughts = trace.filter((e) => e.kind === 'thought').length
  const reasonings = trace.filter((e) => e.kind === 'reasoning').length
  const parts: string[] = []
  if (calls) parts.push(`${calls} tool call${calls === 1 ? '' : 's'}`)
  if (thoughts) parts.push(`${thoughts} note${thoughts === 1 ? '' : 's'}`)
  if (reasonings) parts.push(`${reasonings} reasoning step${reasonings === 1 ? '' : 's'}`)
  if (view.call.reasoningTokens) parts.push(`${view.call.reasoningTokens} reasoning tok`)
  if (parts.length === 0) return view.label
  return `${view.label}: ${parts.join(' · ')}`
}

function TraceEventView({ event }: { event: TraceEvent }) {
  if (event.kind === 'thought') {
    return (
      <div className="trace-event trace-thought">
        <span className="trace-label">thought</span>
        <p>{event.text}</p>
      </div>
    )
  }
  if (event.kind === 'reasoning') {
    return (
      <div className="trace-event trace-reasoning">
        <span className="trace-label">reasoning</span>
        <p>{event.text}</p>
      </div>
    )
  }
  return (
    <div className="trace-event trace-call">
      <div className="trace-call-head">
        <span className="trace-label">call</span>
        <code className="trace-call-name">{event.name}</code>
      </div>
      <pre className="state-json trace-args">{formatToolArgs(event.arguments) || '(no args)'}</pre>
      <div className="trace-result">{event.result}</div>
    </div>
  )
}

export function TraceView({ calls, expanded, onToggle }: TraceViewProps) {
  const summary = calls.map(summarizeCall).join(' · ') || 'no calls'
  return (
    <div className="trace">
      <button
        className="trace-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
        title="Show reasoning, tool calls, and intermediate model output for this turn"
      >
        {expanded ? '▾' : '▸'} trace ({summary})
      </button>
      {expanded && (
        <div className="trace-pane">
          {calls.map((view, i) => {
            const trace = view.call.trace ?? []
            const showText = !view.hideText && !!view.call.text
            const empty = trace.length === 0 && !showText
            return (
              <div key={i} className="trace-section">
                <div className="trace-section-head">
                  <span className="trace-section-label">{view.label}</span>
                  {view.call.model && (
                    <code className="trace-section-model">{view.call.model}</code>
                  )}
                </div>
                {showText && (
                  <div className="trace-event trace-output">
                    <span className="trace-label">output</span>
                    <p>{view.call.text}</p>
                  </div>
                )}
                {empty ? (
                  <div className="trace-event trace-empty">
                    <span className="trace-label">no events recorded</span>
                  </div>
                ) : (
                  trace.map((e, j) => <TraceEventView key={j} event={e} />)
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
