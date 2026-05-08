import { useState } from 'react'
import type { ApiMessage, SamplingParams } from '../engine/types'

export interface ReviserPreview {
  messages: ApiMessage[]
  model: string
  source: 'last-turn' | 'no-draft'
  // Short note about where the draft came from (e.g. "Draft from turn #4.")
  // — purely informational.
  note: string
}

interface ContextViewerProps {
  apiMessages: ApiMessage[]
  tools: unknown[]
  sampling: SamplingParams
  reviser?: ReviserPreview
  onClose: () => void
}

type Tab = 'narrator' | 'reviser'

export function ContextViewer({ apiMessages, tools, sampling, reviser, onClose }: ContextViewerProps) {
  const [tab, setTab] = useState<Tab>('narrator')
  const active = tab === 'reviser' && reviser ? reviser.messages : apiMessages
  const totalBytes = active.reduce((n, m) => n + (m.content?.length ?? 0), 0)
  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <div className="modal-header">
          <h2>{tab === 'narrator' ? 'Next DM request' : 'Reviser request (preview)'}</h2>
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
            This is the exact <code>messages</code> array (plus tool schema and sampling params)
            that will be sent to the model on your next turn. Total content:{' '}
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
        <h2>Sampling</h2>
        <pre className="state-json">{JSON.stringify(
          {
            model: tab === 'reviser' ? reviser?.model : '(see Settings)',
            temperature: sampling.temperature,
          },
          null,
          2,
        )}</pre>
        <div className="context-list">
          {active.map((m, i) => (
            <div key={i} className={`context-item ctx-${m.role}`}>
              <div className="ctx-head">
                <span className="ctx-role">{m.role}</span>
                {m.tool_call_id && <span className="ctx-tag">tool_call_id: {m.tool_call_id}</span>}
                {m.tool_calls?.length ? <span className="ctx-tag">{m.tool_calls.length} tool_call(s)</span> : null}
                <span className="ctx-len">{m.content.length.toLocaleString()} chars</span>
              </div>
              <pre className="state-json">{m.content || '(empty)'}</pre>
              {m.tool_calls?.length ? (
                <pre className="state-json">{JSON.stringify(m.tool_calls, null, 2)}</pre>
              ) : null}
            </div>
          ))}
        </div>
        {tab === 'narrator' && (
          <>
            <h2>Tools</h2>
            <pre className="state-json">{JSON.stringify(tools, null, 2)}</pre>
          </>
        )}
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
