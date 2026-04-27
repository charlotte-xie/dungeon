import type { ApiMessage, SamplingParams } from '../engine/types'

interface ContextViewerProps {
  apiMessages: ApiMessage[]
  tools: unknown[]
  sampling: SamplingParams
  onClose: () => void
}

export function ContextViewer({ apiMessages, tools, sampling, onClose }: ContextViewerProps) {
  const totalBytes = apiMessages.reduce((n, m) => n + (m.content?.length ?? 0), 0)
  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <div className="modal-header">
          <h2>Next DM request</h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <p className="hint">
          This is the exact <code>messages</code> array (plus tool schema and sampling params)
          that will be sent to the model on your next turn. Total content:{' '}
          {totalBytes.toLocaleString()} chars across {apiMessages.length} messages.
        </p>
        <h2>Sampling</h2>
        <pre className="state-json">{JSON.stringify(
          {
            temperature: sampling.temperature,
            frequency_penalty: sampling.frequencyPenalty,
            presence_penalty: sampling.presencePenalty,
          },
          null,
          2,
        )}</pre>
        <div className="context-list">
          {apiMessages.map((m, i) => (
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
        <h2>Tools</h2>
        <pre className="state-json">{JSON.stringify(tools, null, 2)}</pre>
        <div className="modal-actions">
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
