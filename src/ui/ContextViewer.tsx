import { useState } from 'react'
import type { WireRequest } from '../engine/model/types'
import { InspectScreen } from './InspectScreen'
import type { InspectView } from './InspectSwitch'

export interface NextRequest {
  role: 'plotter' | 'narrator' | 'reviser'
  wire: WireRequest
}

interface ContextViewerProps {
  requests: NextRequest[]
  onClose: () => void
  onInspect: (view: InspectView) => void
}

const ROLE_LABELS: Record<NextRequest['role'], string> = {
  plotter: 'Plotter',
  narrator: 'Narrator',
  reviser: 'Reviser',
}

// What each request is, and what changes before it is sent for real.
const ROLE_NOTES: Record<NextRequest['role'], string> = {
  plotter:
    'The Plotter’s first request of the next turn. Its later requests in the turn add its calls, their results and any reminder.',
  narrator:
    'The narrator’s request as it stands before the Plotter runs: the records the Plotter changes, the memories it recalls and its steer join it then.',
  reviser: 'The reviser’s request for the last reply’s draft.',
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

// Labels an object in a list by the fields that say what it is, such as a
// message's role or an item's type and name.
function itemSummary(value: JsonValue): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ''
  return ['role', 'type', 'name']
    .filter((key) => typeof value[key] === 'string')
    .map((key) => `${key}: ${value[key] as string}`)
    .join(' · ')
}

// Renders a JSON value whole: every key and value in order, strings with
// their own line breaks. Nothing is left out or reworded.
function JsonNode({ name, value }: { name: string; value: JsonValue }) {
  if (typeof value === 'string') {
    if (!value.includes('\n') && value.length <= 100) {
      return (
        <div className="wire-leaf">
          <span className="wire-key">{name}</span> <span className="wire-string">{JSON.stringify(value)}</span>
        </div>
      )
    }
    return (
      <div className="wire-leaf">
        <span className="wire-key">{name}</span>{' '}
        <span className="wire-meta">string · {value.length.toLocaleString()} chars</span>
        <pre className="wire-text">{value}</pre>
      </div>
    )
  }
  if (value === null || typeof value !== 'object') {
    return (
      <div className="wire-leaf">
        <span className="wire-key">{name}</span> <span className="wire-scalar">{JSON.stringify(value)}</span>
      </div>
    )
  }
  const entries: [string, JsonValue][] = Array.isArray(value)
    ? value.map((item, i) => [String(i), item])
    : Object.entries(value)
  const summary = itemSummary(value)
  return (
    <details className="wire-node" open>
      <summary>
        <span className="wire-key">{name}</span>{' '}
        <span className="wire-meta">
          {Array.isArray(value) ? `[${value.length}]` : summary || `{${entries.length}}`}
        </span>
      </summary>
      <div className="wire-children">
        {entries.map(([key, item]) => (
          <JsonNode key={key} name={key} value={item} />
        ))}
      </div>
    </details>
  )
}

export function ContextViewer({ requests, onClose, onInspect }: ContextViewerProps) {
  const [selected, setSelected] = useState<NextRequest['role']>(requests[0]?.role ?? 'narrator')
  const [raw, setRaw] = useState(false)
  const [copied, setCopied] = useState(false)
  const current = requests.find((r) => r.role === selected) ?? requests[0]
  const json = current ? JSON.stringify(current.wire.body, null, 2) : ''

  const copy = () => {
    void navigator.clipboard.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <InspectScreen
      view="context"
      title="Next requests"
      sections={requests.map((r) => ({ id: r.role, label: ROLE_LABELS[r.role] }))}
      selected={current?.role ?? ''}
      onSelect={(id) => setSelected(id as NextRequest['role'])}
      onInspect={onInspect}
      onClose={onClose}
    >
      {current && (
        <>
          <p className="hint">
            {ROLE_NOTES[current.role]} Built by the code that sends it; the text in the input box
            stands in for your next input.
          </p>
          <div className="wire-bar">
            <code>POST {current.wire.url}</code>
            <span className="wire-meta">{json.length.toLocaleString()} chars of JSON</span>
            <span className="spacer" />
            <button className="ghost" onClick={() => setRaw((r) => !r)}>{raw ? 'Readable' : 'Raw JSON'}</button>
            <button className="ghost" onClick={copy}>{copied ? 'Copied' : 'Copy JSON'}</button>
          </div>
          {raw ? (
            <pre className="state-json wire-raw">{json}</pre>
          ) : (
            <div className="wire-tree">
              {Object.entries(current.wire.body as Record<string, JsonValue>).map(([key, value]) => (
                <JsonNode key={key} name={key} value={value} />
              ))}
            </div>
          )}
        </>
      )}
    </InspectScreen>
  )
}
