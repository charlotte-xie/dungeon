import { useState } from 'react'
import { ADVENTURE_SLOTS } from '../engine/config'
import {
  MAX_OOC_ITEMS,
  MAX_OOC_ITEM_CHARS,
  MAX_PLOT_ITEMS,
  MAX_PLOT_ITEM_CHARS,
} from '../engine/tools'
import type { AdventureSlots, ContextConfig, SlotKey } from '../engine/types'
import { useReportDirty } from '../hooks/useReportDirty'

interface AdventurePanelProps {
  slots: AdventureSlots
  ooc: string[]
  plot: string[]
  context: ContextConfig
  // Developer mode shows the arcs without asking.
  devMode: boolean
  busy: boolean
  onSaveSlots: (next: AdventureSlots) => void
  onSaveOoc: (next: string[]) => void
  onSavePlot: (next: string[]) => void
  onDirtyChange: (dirty: boolean) => void
}

function listToDraft(list: string[]): string {
  return list.map((p, i) => `${i + 1}. ${p}`).join('\n')
}

function parseListDraft(draft: string): string[] {
  return draft
    .split('\n')
    .map((line) =>
      line
        // Strip any line-leading list prefix: an arbitrary positive integer
        // followed by ., ), :, or ] (so re-ordered/non-sequential numbering
        // survives a round-trip), or a -, *, or • bullet.
        .replace(/^\s*(?:\d+[.):\]]\s+|[-*•]\s+)/, '')
        .trim(),
    )
    .filter((line) => line.length > 0)
}

function trimSlots(slots: AdventureSlots): AdventureSlots {
  const out = {} as AdventureSlots
  for (const def of ADVENTURE_SLOTS) out[def.key] = (slots[def.key] ?? '').trim()
  return out
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M1.5 12S5.5 4.5 12 4.5 22.5 12 22.5 12 18.5 19.5 12 19.5 1.5 12 1.5 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

// The parts of the adventure the player shapes: the brief and style guide it
// is written from, their standing OOC instructions, and the arcs, which give
// the plot away and stay hidden until asked for.
export function AdventurePanel({
  slots,
  ooc,
  plot,
  context,
  devMode,
  busy,
  onSaveSlots,
  onSaveOoc,
  onSavePlot,
  onDirtyChange,
}: AdventurePanelProps) {
  const [slotDrafts, setSlotDrafts] = useState<AdventureSlots>(() => ({ ...slots }))
  const [oocDraft, setOocDraft] = useState(() => listToDraft(ooc))
  const [oocError, setOocError] = useState<string | null>(null)
  const [plotDraft, setPlotDraft] = useState(() => listToDraft(plot))
  const [plotError, setPlotError] = useState<string | null>(null)
  const [arcsRevealed, setArcsRevealed] = useState(false)
  const showArcs = devMode || arcsRevealed

  // Reset a draft when its record changes underneath it, as after a turn.
  // Adjusting state during render avoids cascading-render lints.
  const [prevSlots, setPrevSlots] = useState(slots)
  if (prevSlots !== slots) {
    setPrevSlots(slots)
    setSlotDrafts({ ...slots })
  }
  const [prevOoc, setPrevOoc] = useState(ooc)
  if (prevOoc !== ooc) {
    setPrevOoc(ooc)
    setOocDraft(listToDraft(ooc))
    setOocError(null)
  }
  const [prevPlot, setPrevPlot] = useState(plot)
  if (prevPlot !== plot) {
    setPrevPlot(plot)
    setPlotDraft(listToDraft(plot))
    setPlotError(null)
  }

  const slotsDirty = ADVENTURE_SLOTS.some((def) => (slotDrafts[def.key] ?? '') !== (slots[def.key] ?? ''))
  const oocDirty = context.includeOoc && oocDraft !== listToDraft(ooc)
  const plotDirty = context.includePlotOutline && plotDraft !== listToDraft(plot)
  const anyDirty = slotsDirty || oocDirty || plotDirty
  useReportDirty(anyDirty, onDirtyChange)

  // Return the parsed list, or null after setting the section's error.
  function validateList(
    draft: string,
    maxItems: number,
    maxChars: number,
    noun: string,
    plural: string,
    setError: (error: string | null) => void,
  ): string[] | null {
    const parsed = parseListDraft(draft)
    if (parsed.length > maxItems) {
      setError(`Too many ${plural} (${parsed.length}, max ${maxItems}).`)
      return null
    }
    const tooLong = parsed.find((s) => s.length > maxChars)
    if (tooLong) {
      setError(`An ${noun} is too long (${tooLong.length} chars, max ${maxChars}).`)
      return null
    }
    setError(null)
    return parsed
  }

  // Saves nothing unless every edited section is valid.
  function save() {
    const nextOoc = oocDirty
      ? validateList(oocDraft, MAX_OOC_ITEMS, MAX_OOC_ITEM_CHARS, 'entry', 'entries', setOocError)
      : undefined
    const nextPlot = plotDirty
      ? validateList(plotDraft, MAX_PLOT_ITEMS, MAX_PLOT_ITEM_CHARS, 'arc', 'arcs', setPlotError)
      : undefined
    if (nextOoc === null) return
    if (nextPlot === null) {
      setArcsRevealed(true)
      return
    }
    if (slotsDirty) onSaveSlots(trimSlots(slotDrafts))
    if (nextOoc) onSaveOoc(nextOoc)
    if (nextPlot) onSavePlot(nextPlot)
  }

  function revert() {
    setSlotDrafts({ ...slots })
    setOocDraft(listToDraft(ooc))
    setOocError(null)
    setPlotDraft(listToDraft(plot))
    setPlotError(null)
  }

  return (
    <section className="page" aria-label="Adventure">
      <div className="page-main">
        {busy && (
          <p className="hint">The DM is working. You can edit again once it finishes or you stop it.</p>
        )}
        {ADVENTURE_SLOTS.map((def) => (
          <label key={def.key}>
            <span>{def.label}</span>
            <textarea
              value={slotDrafts[def.key] ?? ''}
              onChange={(e) => setSlotDrafts((d) => ({ ...d, [def.key as SlotKey]: e.target.value }))}
              rows={def.rows}
              placeholder={def.placeholder}
              readOnly={busy}
            />
            <small className="hint">
              {def.hint} Changes apply from the next turn.
            </small>
          </label>
        ))}

        {context.includeOoc && (
          <label>
            <span>OOC instructions ({ooc.length})</span>
            <textarea
              value={oocDraft}
              onChange={(e) => setOocDraft(e.target.value)}
              rows={4}
              placeholder="e.g. Keep any gore off-screen."
              readOnly={busy}
            />
            <small className="hint">
              Out-of-character preferences the DM keeps to for this adventure, one per line. The DM
              adds to them when you put an <code>(OOC: …)</code> note in your action, and drops
              them when you withdraw them. Up to {MAX_OOC_ITEMS}, each up to {MAX_OOC_ITEM_CHARS}{' '}
              characters.
            </small>
            {oocError && <p className="error-text" role="alert">{oocError}</p>}
          </label>
        )}

        {context.includePlotOutline && (
          <div className="arcs">
            <div className="arcs-head">
              <span className="field-label">Story arcs ({plot.length})</span>
              {!devMode && (
                <button
                  type="button"
                  className="ghost reveal"
                  aria-pressed={arcsRevealed}
                  onClick={() => setArcsRevealed((r) => !r)}
                  title={arcsRevealed ? 'Hide the arcs again' : 'Show the arcs: they give away where the story is heading'}
                >
                  <EyeIcon />
                  {arcsRevealed ? 'Hide' : 'Reveal'}
                </button>
              )}
            </div>
            {showArcs ? (
              <>
                <textarea
                  aria-label="Story arcs"
                  value={plotDraft}
                  onChange={(e) => setPlotDraft(e.target.value)}
                  rows={5}
                  placeholder="(no arcs yet — one arc per line)"
                  readOnly={busy}
                />
                <small className="hint">
                  What is ongoing in the story, such as a quarrel, a rivalry or a secret working its
                  way out, and where each is heading, one per line. The DM sets them up and moves
                  them on as the story turns; edit them to take the story your way, and the DM keeps
                  to what you write. Up to {MAX_PLOT_ITEMS}, each up to {MAX_PLOT_ITEM_CHARS}{' '}
                  characters.
                </small>
                {plotError && <p className="error-text" role="alert">{plotError}</p>}
              </>
            ) : (
              <p className="hint">
                Hidden, because they give away where the story is heading. Reveal them to read or
                change them.
              </p>
            )}
          </div>
        )}
      </div>
      <footer className="page-actions">
        <span className="spacer" />
        <button className="ghost" onClick={revert} disabled={!anyDirty}>
          Revert
        </button>
        <button onClick={save} disabled={busy || !anyDirty}>
          Save
        </button>
      </footer>
    </section>
  )
}
