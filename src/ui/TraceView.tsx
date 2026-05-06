import type { ModelCall, TraceEvent } from '../engine/types'

export interface ModelCallView {
  // Short human label shown as the section header (e.g. 'narrator', 'reviser').
  label: string
  call: ModelCall
  // When true, omit the call's text from the trace pane — useful for the
  // narrator's reply, since its text is already shown in the message bubble.
  hideText?: boolean
  // When set, render the call's text as a word-level diff against this
  // baseline string (deletions struck through, insertions highlighted) in
  // place of the plain output block.
  diffAgainst?: string
}

type DiffOp = { kind: 'eq' | 'add' | 'del'; text: string }

// Word-level LCS diff. Tokenizes on word/whitespace boundaries so paragraph
// breaks survive. Skipped (returns null) when either side is too long — LCS
// is O(m·n) and a runaway DM reply shouldn't lock the UI.
function diffWords(a: string, b: string): DiffOp[] | null {
  const aTokens = a.match(/\S+|\s+/g) ?? []
  const bTokens = b.match(/\S+|\s+/g) ?? []
  const m = aTokens.length
  const n = bTokens.length
  if (m * n > 1_500_000) return null
  const lcs: Uint16Array = new Uint16Array((m + 1) * (n + 1))
  const w = n + 1
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i * w + j] =
        aTokens[i] === bTokens[j]
          ? lcs[(i + 1) * w + (j + 1)] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + (j + 1)])
    }
  }
  const out: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (aTokens[i] === bTokens[j]) {
      out.push({ kind: 'eq', text: aTokens[i] })
      i++
      j++
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + (j + 1)]) {
      out.push({ kind: 'del', text: aTokens[i++] })
    } else {
      out.push({ kind: 'add', text: bTokens[j++] })
    }
  }
  while (i < m) out.push({ kind: 'del', text: aTokens[i++] })
  while (j < n) out.push({ kind: 'add', text: bTokens[j++] })
  // Coalesce consecutive ops of the same kind for fewer DOM nodes.
  const merged: DiffOp[] = []
  for (const op of out) {
    const last = merged[merged.length - 1]
    if (last && last.kind === op.kind) last.text += op.text
    else merged.push({ ...op })
  }
  return merged
}

function DiffBlock({ from, to }: { from: string; to: string }) {
  const ops = diffWords(from, to)
  if (!ops) {
    return <p className="trace-diff-fallback">(diff skipped — passage too long)</p>
  }
  return (
    <p className="trace-diff">
      {ops.map((op, k) => {
        if (op.kind === 'eq') return <span key={k}>{op.text}</span>
        if (op.kind === 'add') return <ins key={k} className="trace-diff-add">{op.text}</ins>
        return <del key={k} className="trace-diff-del">{op.text}</del>
      })}
    </p>
  )
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
        title="Open the trace pane in a modal — reasoning, tool calls, and the reviser diff for this turn"
      >
        ▸ trace ({summary})
      </button>
      {expanded && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            // Backdrop click closes; clicks inside the modal don't bubble here.
            if (e.target === e.currentTarget) onToggle()
          }}
        >
          <div className="modal modal-wide trace-modal">
            <div className="modal-header">
              <h2>Trace ({summary})</h2>
              <button className="modal-close" aria-label="Close" onClick={onToggle}>×</button>
            </div>
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
                        <span className="trace-label">
                          {view.diffAgainst !== undefined ? 'diff' : 'output'}
                        </span>
                        {view.diffAgainst !== undefined && view.call.text ? (
                          <DiffBlock from={view.diffAgainst} to={view.call.text} />
                        ) : (
                          <p>{view.call.text}</p>
                        )}
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
            <div className="modal-actions">
              <span className="spacer" />
              <button onClick={onToggle}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
