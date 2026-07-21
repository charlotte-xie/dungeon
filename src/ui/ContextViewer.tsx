import { useState } from 'react'
import type { ModelMessage } from '../engine/model/types'
import type { SamplingParams } from '../engine/types'

export interface ReviserPreview {
  messages: ModelMessage[]
  model: string
  source: 'last-turn' | 'no-draft'
  // Short note about where the draft came from (e.g. "Draft from turn #4.")
  // — purely informational.
  note: string
}

interface ContextViewerProps {
  messages: ModelMessage[]
  tools: unknown[]
  sampling: SamplingParams
  reviser?: ReviserPreview
  onClose: () => void
}

type Tab = 'narrator' | 'reviser'

export function ContextViewer({ messages, tools, sampling, reviser, onClose }: ContextViewerProps) {
  const [tab, setTab] = useState<Tab>('narrator')
  const active = tab === 'reviser' && reviser ? reviser.messages : messages
  const totalBytes = active.reduce((n, m) => n + (m.content?.length ?? 0), 0)
  const toolsJson = JSON.stringify(tools, null, 2)
  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <div className="modal-header">
          <h2>{tab === 'narrator' ? 'Context for next DM request' : 'Context for reviser request (preview)'}</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {reviser && (
          <div className="ctx-tabs">
            <button
              className={`ctx-tab ${tab === 'narrator' ? 'active' : ''}`}
              onClick={() => setTab('narrator')}
            >
              Narrator
            </button>
            <button
              className={`ctx-tab ${tab === 'reviser' ? 'active' : ''}`}
              onClick={() => setTab('reviser')}
            >
              Reviser
            </button>
          </div>
        )}
        {tab === 'narrator' ? (
          <p className="hint">
            This is the provider-neutral request (messages, tool schema, and sampling params)
            before the configured adapter serializes it. Total content:{' '}
            {totalBytes.toLocaleString()} chars across {active.length} messages.
          </p>
        ) : reviser?.source === 'no-draft' ? (
          <p className="hint">
            No DM reply yet — the reviser preview uses a placeholder draft. Take one
            turn and reopen this view to see the real reviser request.
          </p>
        ) : (
          <p className="hint">
            Built from the most recent narrator draft. The reviser receives only what
            you see here — no chronicle, world state, plot, memory, or prior turns.{' '}
            {reviser?.note}
          </p>
        )}
        <details className="ctx-section">
          <summary>Sampling</summary>
          <pre className="state-json ctx-section-json">{JSON.stringify(
            {
              model: tab === 'reviser' ? reviser?.model : '(see Settings)',
              temperature: sampling.temperature,
            },
            null,
            2,
          )}</pre>
        </details>
        <div className="context-list">
          {active.map((m, i) => (
            <div key={i} className={`context-item ctx-${m.role}`}>
              <div className="ctx-head">
                <span className="ctx-role">{m.role}</span>
                {m.toolCallId && <span className="ctx-tag">tool_call_id: {m.toolCallId}</span>}
                {m.toolCalls?.length ? <span className="ctx-tag">{m.toolCalls.length} tool_call(s)</span> : null}
                <span className="ctx-len">{m.content.length.toLocaleString()} chars</span>
              </div>
              {(m.content || !m.toolCalls?.length) && (
                <pre className="state-json">{m.content || '(empty)'}</pre>
              )}
              {m.toolCalls?.length ? (
                <pre className="state-json">{JSON.stringify(m.toolCalls, null, 2)}</pre>
              ) : null}
            </div>
          ))}
        </div>
        {tab === 'narrator' && (
          <details className="ctx-section">
            <summary>
              Tools
              <span className="ctx-len">
                {tools.length} schema{tools.length === 1 ? '' : 's'} · {toolsJson.length.toLocaleString()} chars
              </span>
            </summary>
            <pre className="state-json ctx-section-json">{toolsJson}</pre>
          </details>
        )}
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
