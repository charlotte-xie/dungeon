import { useState } from 'react'
import type { ModelMessage, ModelToolDefinition } from '../engine/model/types'
import type { RequestSections } from '../engine/request'
import type { SamplingParams } from '../engine/types'
import { InspectSwitch, type InspectView } from './InspectSwitch'

export interface ReviserPreview {
  messages: ModelMessage[]
  model: string
  source: 'last-turn' | 'no-draft'
  // Short note about where the draft came from (e.g. "Draft from turn #4.")
  // — purely informational.
  note: string
}

export interface PlotterPreview {
  sections: RequestSections
  tools: ModelToolDefinition[]
  model: string
}

interface ContextViewerProps {
  narrator: RequestSections
  // Absent when every record is switched off: there is no Plotter request.
  plotter?: PlotterPreview
  sampling: SamplingParams
  reviser?: ReviserPreview
  onClose: () => void
  onInspect: (view: InspectView) => void
}

type Tab = 'system' | 'chronicle' | 'history' | 'notes' | 'plotter' | 'reviser'

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

export function ContextViewer({ narrator, plotter, sampling, reviser, onClose, onInspect }: ContextViewerProps) {
  const [tab, setTab] = useState<Tab>('history')

  const { system, chronicle, history, tail: notes } = narrator
  // What the Plotter's request holds beyond the story both roles share: its
  // rules in place of the narrator's reading notes, and its own tail.
  const plotterPrefix = plotter
    ? plotter.sections.system.filter((m) => !system.some((n) => n.content === m.content))
    : []
  const plotterMessages = plotter ? [...plotterPrefix, ...plotter.sections.tail] : []
  const toolsJson = plotter ? JSON.stringify(plotter.tools, null, 2) : ''

  const tabs: { id: Tab; label: string }[] = [
    { id: 'system', label: `System (${system.length})` },
    { id: 'chronicle', label: `Chronicle (${chronicle.length})` },
    { id: 'history', label: `History (${history.length})` },
    { id: 'notes', label: `Notes (${notes.length})` },
    ...(plotter ? [{ id: 'plotter' as Tab, label: 'Plotter' }] : []),
    ...(reviser ? [{ id: 'reviser' as Tab, label: 'Reviser' }] : []),
  ]

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide">
        <div className="ctx-head-block">
          <div className="modal-header">
            <h2>
              {tab === 'reviser'
                ? 'Context for reviser request (preview)'
                : tab === 'plotter'
                  ? 'Context for Plotter request (preview)'
                  : 'Context for next narrator request'}
            </h2>
            <InspectSwitch view="context" onChange={onInspect} />
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
        </div>
        {tab === 'system' && (
          <>
            <p className="hint">
              The stable, cacheable prefix: system prompt, content stance, adventure
              slots, and a short note on reading the Plotter&apos;s briefing. Changes
              only when settings change. The narrator is offered no tools; sampling
              temperature {sampling.temperature}. {sizeNote(system)}
            </p>
            <MessageList items={system} />
          </>
        )}
        {tab === 'chronicle' && (
          <>
            <p className="hint">
              The chronicle: older turns compressed into the &quot;story so far&quot;
              summary the model reads in place of their full text. Empty until the
              first compaction. {sizeNote(chronicle)}
            </p>
            <MessageList items={chronicle} />
          </>
        )}
        {tab === 'history' && (
          <>
            <p className="hint">
              The recent live transcript: player inputs, the Plotter&apos;s briefing for
              each turn, and DM narration replayed verbatim, up to the compaction
              cutoff. The last input is a placeholder for the player&apos;s next one. {sizeNote(history)}
            </p>
            <MessageList items={history} />
          </>
        )}
        {tab === 'notes' && (
          <>
            <p className="hint">
              The per-turn tail: the player&apos;s standing OOC instructions, then the
              turn reminder. Rebuilt fresh every turn. The Plotter&apos;s briefing for
              the turn — updates, recalled memories, and steer — sits in the history
              just before it, as tool calls. {sizeNote(notes)}
            </p>
            <MessageList items={notes} />
          </>
        )}
        {tab === 'plotter' && plotter && (
          <>
            <p className="hint">
              Sent first, when the player acts (model: {plotter.model}). It shares the
              system prompt, slots, and chronicle with the narrator&apos;s request, and
              its history without the briefings; shown here is what differs: the full
              rules for each record in place of the narrator&apos;s note, then its tail —
              the records as check_* tool results and its instruction. The player&apos;s
              next input is a placeholder here.{' '}
              {sizeNote(plotterMessages)}
            </p>
            <MessageList items={plotterMessages} />
            <p className="hint">
              Tools offered to the Plotter — {plotter.tools.length} schema
              {plotter.tools.length === 1 ? '' : 's'} · {toolsJson.length.toLocaleString()} chars.
            </p>
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
