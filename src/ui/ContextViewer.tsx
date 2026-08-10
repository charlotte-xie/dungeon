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

type Tab = 'system' | 'story' | 'notes' | 'tools' | 'reviser'

function chars(items: ModelMessage[]): number {
  return items.reduce((n, m) => n + (m.content?.length ?? 0), 0)
}

function sizeNote(items: ModelMessage[]): string {
  return `${chars(items).toLocaleString()} chars across ${items.length} message${items.length === 1 ? '' : 's'}.`
}

function MessageList({ items }: { items: ModelMessage[] }) {
  if (!items.length) {
    return <p className="hint"><em>(no messages in this section)</em></p>
  }
  return (
    <div className="context-list">
      {items.map((m, i) => (
        <div key={i} className={`context-item ctx-${m.role}`}>
          <div className="ctx-head">
            <span className="ctx-role">{m.role}</span>
            {m.toolCallId && <span className="ctx-tag">tool_call_id: {m.toolCallId}</span>}
            {m.toolCalls?.length ? (
              <span className="ctx-tag">{m.toolCalls.length} tool_call(s)</span>
            ) : null}
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
  )
}

export function ContextViewer({ messages, tools, sampling, reviser, onClose }: ContextViewerProps) {
  const [tab, setTab] = useState<Tab>('story')

  // Segment the request into its architectural sections. The seeded
  // check-notes exchange is identified by its fixed ctx-* call ids; the
  // chronicle system message by its heading.
  const injStart = messages.findIndex((m) => m.toolCalls?.some((c) => c.id.startsWith('ctx-')))
  const tailStart = injStart === -1 ? messages.length : injStart
  let historyStart = messages.findIndex((m, i) => i < tailStart && m.role !== 'system')
  if (historyStart === -1 || historyStart > tailStart) historyStart = tailStart
  const prefix = messages.slice(0, historyStart)
  const chronicle = prefix.filter((m) => m.content.startsWith('# Story so far'))
  const system = prefix.filter((m) => !m.content.startsWith('# Story so far'))
  const story = [...chronicle, ...messages.slice(historyStart, tailStart)]
  const notes = messages.slice(tailStart)
  const toolsJson = JSON.stringify(tools, null, 2)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'system', label: `System (${system.length})` },
    { id: 'story', label: `Story (${story.length})` },
    { id: 'notes', label: `Notes (${notes.length})` },
    { id: 'tools', label: `Tools (${tools.length})` },
    ...(reviser ? [{ id: 'reviser' as Tab, label: 'Reviser' }] : []),
  ]

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <div className="modal-header">
          <h2>
            {tab === 'reviser'
              ? 'Context for reviser request (preview)'
              : 'Context for next DM request'}
          </h2>
          <button className="modal-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="ctx-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`ctx-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'system' && (
          <>
            <p className="hint">
              The stable, cacheable prefix: system prompt, content stance, adventure
              slots, and the enabled subsystems&apos; rules. Changes only when settings
              change. {sizeNote(system)}
            </p>
            <MessageList items={system} />
          </>
        )}
        {tab === 'story' && (
          <>
            <p className="hint">
              The story as the model sees it: the chronicle&apos;s compressed summary of
              older turns (when present), then the live transcript of inputs and
              narration. {sizeNote(story)}
            </p>
            <MessageList items={story} />
          </>
        )}
        {tab === 'notes' && (
          <>
            <p className="hint">
              The per-turn tail: the DM &quot;checking its notes&quot; — the seeded
              check_* tool exchange carrying current memory, plan, state, and OOC
              instructions — plus the turn reminder. Rebuilt fresh every turn.{' '}
              {sizeNote(notes)}
            </p>
            <MessageList items={notes} />
          </>
        )}
        {tab === 'tools' && (
          <>
            <p className="hint">
              Advertised tool schemas and sampling parameters for the request —{' '}
              {tools.length} schema{tools.length === 1 ? '' : 's'} ·{' '}
              {toolsJson.length.toLocaleString()} chars.
            </p>
            <pre className="state-json ctx-section-json">{JSON.stringify(
              { model: '(see Settings)', temperature: sampling.temperature },
              null,
              2,
            )}</pre>
            <pre className="state-json ctx-section-json">{toolsJson}</pre>
          </>
        )}
        {tab === 'reviser' && reviser && (
          <>
            {reviser.source === 'no-draft' ? (
              <p className="hint">
                No DM reply yet — the reviser preview uses a placeholder draft. Take one
                turn and reopen this view to see the real reviser request.
              </p>
            ) : (
              <p className="hint">
                Built from the most recent narrator draft (model: {reviser.model}). The
                reviser receives only what you see here — no chronicle, world state,
                plot, memory, or prior turns. {reviser.note} {sizeNote(reviser.messages)}
              </p>
            )}
            <MessageList items={reviser.messages} />
          </>
        )}
        <div className="modal-actions pinned">
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
