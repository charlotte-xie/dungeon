import { Fragment, useEffect, useRef, useState } from 'react'
import './App.css'
import { DEFAULT_SYSTEM_PROMPT } from './prompts'
import { buildPlotterInstruction } from './engine/agents/narrator'
import { buildReviserMessages } from './engine/agents/reviser'
import { totalChronicleEntries } from './engine/chronicle'
import { DEFAULT_STATE } from './engine/config'
import { describeModelError } from './engine/model/errors'
import { buildNarratorSections, buildPlotterSections, buildPlotterTools } from './engine/request'
import { replyStatus } from './engine/turnRecovery'
import type { Turn } from './engine/types'
import { useGameController } from './hooks/useGameController'
import { useSaves } from './hooks/useSaves'
import { useSettings } from './hooks/useSettings'
import { ContextViewer } from './ui/ContextViewer'
import { Elapsed } from './ui/Elapsed'
import { EditableMessage } from './ui/EditableMessage'
import { ErrorDetails } from './ui/ErrorDetails'
import { NewAdventurePrompt } from './ui/NewAdventurePrompt'
import { SavesPanel } from './ui/SavesPanel'
import { SettingsPanel } from './ui/SettingsPanel'
import { StateViewer } from './ui/StateViewer'
import { TraceView, type ModelCallView } from './ui/TraceView'
import { AdventureMenu } from './ui/AdventureMenu'
import type { InspectView } from './ui/InspectSwitch'

// The model calls behind a turn, in the order they ran, as its trace shows
// them. Turns played before the Plotter went first list it in the same place.
function traceCalls(t: Turn): ModelCallView[] {
  const plotter = t.plotter ? [{ label: 'plotter', call: t.plotter }] : []
  return t.narrator
    ? [
        ...plotter,
        { label: 'narrator (draft)', call: t.narrator, hideText: true },
        { label: 'reviser', call: t.reply, diffAgainst: t.narrator.text ?? '' },
      ]
    : [...plotter, { label: 'narrator', call: t.reply, hideText: true }]
}

function App() {
  const systemPrompt = DEFAULT_SYSTEM_PROMPT
  const settings = useSettings()
  const { model, apiKey, baseUrl, sampling, context, showTrace } = settings
  const game = useGameController({ systemPrompt, model, apiKey, baseUrl, sampling, context })
  const saves = useSaves({
    captureGame: game.captureGame,
    restoreGame: game.restoreGame,
    hasProgress: game.turns.length > 0 || totalChronicleEntries(game.chronicle) > 0,
  })
  const { turns, compactCutoff, input, thinking, statusText } = game

  const [showSettings, setShowSettings] = useState(false)
  const [inspect, setInspect] = useState<InspectView | null>(null)
  const [showNewAdventure, setShowNewAdventure] = useState(false)
  const [showSaves, setShowSaves] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [rewriteText, setRewriteText] = useState('')
  const [rewriteError, setRewriteError] = useState<string | null>(null)
  const [expandedTraces, setExpandedTraces] = useState<Set<string>>(() => new Set())

  function toggleTrace(id: string) {
    setExpandedTraces((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, thinking])

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      act()
    }
  }

  // Any new turn closes an open Rewrite field, so it never reappears under a
  // later reply.
  function act() {
    setRewriting(false)
    void game.send()
  }

  function continueStory() {
    setRewriting(false)
    void game.continueStory()
  }

  function retry() {
    setRewriting(false)
    void game.retry()
  }

  function undo() {
    setRewriting(false)
    game.undo()
  }

  function openRewrite() {
    setRewriteText('')
    setRewriteError(null)
    setRewriting(true)
  }

  function submitRewrite(e: React.FormEvent) {
    e.preventDefault()
    const guidance = rewriteText.trim()
    if (!guidance) {
      setRewriteError('Say how the reply should change.')
      return
    }
    setRewriting(false)
    void game.retry({ guidance })
  }

  // While the DM works, what it's doing and for how long joins the latest
  // turn: as a DM row while the reply is being written, then under the reply
  // while the turn is recorded.
  const lastTurn = turns[turns.length - 1]
  const pendingTurn = thinking && lastTurn ? turns.length - 1 : -1
  const statusLine = (
    <>
      {statusText} <Elapsed since={game.statusSince} />
    </>
  )
  const thinkingRow = (
    <div className="msg msg-dm thinking" role="status">
      <span className="who">DM</span>
      <div className="msg-body">{statusLine}</div>
    </div>
  )

  return (
    <main className={`app ${showTrace ? 'app-wide' : ''}`}>
      <header>
        <h1>AI Dungeon Master</h1>
        <div className="header-actions">
          <AdventureMenu
            newTitle={thinking
              ? 'Start a new adventure and cancel the current generation'
              : 'Start a new adventure — confirm or edit the scenario brief'}
            onNew={() => setShowNewAdventure(true)}
            onSaves={() => setShowSaves(true)}
          />
          <button
            className="ghost"
            onClick={() => setInspect('state')}
            title="Engine state, standing OOC preferences, and the context for the next request"
          >
            Inspect
          </button>
          <button className="ghost" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>
      </header>
      {/* The log reads as a table: speaker, text, and, with trace on, a
          debug column on the right. */}
      <div className={`log ${showTrace ? 'log-with-aside' : ''}`} ref={logRef}>
        {turns.length === 0 && !thinking && (
          <div className="empty-log">
            <p>No adventure in progress.</p>
            <button onClick={() => setShowNewAdventure(true)}>Begin Adventure</button>
            {game.canRedo && (
              <button className="link" onClick={game.redo} title="Restore the opening you just undid">
                Redo
              </button>
            )}
            <p className="hint">The DM will narrate the opening based on your scenario brief (edit in Settings).</p>
          </div>
        )}
        {turns.map((t, i) => {
          const folded = i < compactCutoff
          const showInput = t.kind === 'player' && t.input !== undefined
          // A turn without a reply in front of the player shows why instead.
          const status = replyStatus(t)
          const showReply = status === 'answered'
          // Fixing a reply happens at the reply: only the latest one can be
          // retried, rewritten, or undone, and Redo takes their place after an undo.
          const latest = i === turns.length - 1 && !thinking
          const replyActions = latest && (game.canRedo || game.canRetry || game.canUndo)
          const traced = showTrace && (t.reply.trace !== undefined || !!t.narrator || !!t.plotter)
          // The DM's status sits in the turn it's working on.
          const pending = i === pendingTurn
          return (
            <Fragment key={t.id}>
              {i === compactCutoff && compactCutoff > 0 && (
                <div className="compact-divider">
                  <span>earlier turns folded into chronicle — still shown, but model sees summary</span>
                </div>
              )}
              <div className={`turn ${folded ? 'turn-folded' : ''}`}>
                {showInput && (
                  <div className="msg msg-player">
                    <span className="who">You</span>
                    <div className="msg-body">
                      <EditableMessage
                        text={t.input ?? ''}
                        onSave={(next) => game.editTurnInput(t.id, next)}
                      />
                    </div>
                  </div>
                )}
                {showReply && (
                  <div className="msg msg-dm">
                    <span className="who">DM</span>
                    <div className="msg-body">
                      <EditableMessage
                        text={t.reply.text ?? ''}
                        onSave={(next) => game.editTurnReply(t.id, next)}
                      />
                      {pending && (
                        <p className="msg-status msg-status-working" role="status">
                          {statusLine}
                        </p>
                      )}
                      {t.plotter?.stopped && (
                        <div className="turn-notice" role="status">
                          <p>Recording stopped — state, plot, memory and OOC weren't updated this turn.</p>
                        </div>
                      )}
                      {t.plotter?.error && (
                        <div className="turn-notice" role="status">
                          <p>
                            Plotter failed — this reply was written without a full plan, and the
                            records may be incomplete:{' '}
                            {describeModelError(t.plotter.error)}
                          </p>
                          <ErrorDetails error={t.plotter.error} />
                        </div>
                      )}
                      {replyActions && (
                        <div className="reply-actions">
                          {game.canRedo ? (
                            <button className="link" onClick={game.redo} title="Restore the turn you just undid">
                              Redo
                            </button>
                          ) : (
                            <>
                              {game.canRetry && (
                                <button
                                  className="link"
                                  onClick={retry}
                                  title="Discard this reply and write it again from the same action"
                                >
                                  Retry
                                </button>
                              )}
                              {game.canRetry && (
                                <button
                                  className="link"
                                  onClick={openRewrite}
                                  title="Discard this reply and write it again following your instruction"
                                >
                                  Rewrite
                                </button>
                              )}
                              {game.canUndo && (
                                <button
                                  className="link"
                                  onClick={undo}
                                  title="Take back this turn and put your action back in the box"
                                >
                                  Undo
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      {latest && rewriting && (
                        <form className="rewrite-form" onSubmit={submitRewrite}>
                          <input
                            type="text"
                            autoFocus
                            value={rewriteText}
                            onChange={(e) => {
                              setRewriteText(e.target.value)
                              setRewriteError(null)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setRewriting(false)
                            }}
                            placeholder="Make the guard back down, and keep it shorter"
                            aria-label="How should the reply change?"
                          />
                          <button type="submit">Rewrite</button>
                          <button type="button" className="ghost" onClick={() => setRewriting(false)}>
                            Cancel
                          </button>
                          {rewriteError && <p className="error-text" role="alert">{rewriteError}</p>}
                        </form>
                      )}
                    </div>
                    {traced && (
                      <div className="msg-aside">
                        <TraceView
                          calls={traceCalls(t)}
                          expanded={expandedTraces.has(t.id)}
                          onToggle={() => toggleTrace(t.id)}
                        />
                      </div>
                    )}
                  </div>
                )}
                {!showReply && !pending && (
                  <div className="msg msg-dm">
                    <span className="who">DM</span>
                    <div className="msg-body">
                      <p className={`msg-status msg-status-${status}`} role="status">
                        {status === 'failed'
                          ? `DM failed to reply: ${describeModelError(t.reply.error ?? '')}`
                          : 'DM stopped by an app reload before replying.'}
                      </p>
                      {latest && game.unanswered && (
                        <div className="reply-actions">
                          <button
                            className="link"
                            onClick={continueStory}
                            title="Have the DM reply to this turn"
                          >
                            Continue
                          </button>
                          <button
                            className="link"
                            onClick={undo}
                            title="Take back this turn and put your action back in the box"
                          >
                            Undo
                          </button>
                        </div>
                      )}
                    </div>
                    {/* With trace on, the underlying error and any trace sit
                        beside the reason. */}
                    {showTrace && (status === 'failed' || traced) && (
                      <div className="msg-aside">
                        {status === 'failed' && <ErrorDetails error={t.reply.error ?? ''} />}
                        {traced && (
                          <TraceView
                            calls={traceCalls(t)}
                            expanded={expandedTraces.has(t.id)}
                            onToggle={() => toggleTrace(t.id)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
                {pending && !showReply && thinkingRow}
              </div>
            </Fragment>
          )
        })}
        {thinking && pendingTurn < 0 && <div className="turn">{thinkingRow}</div>}
      </div>
      {game.compactionError && (
        <div className="app-notice" role="status">
          <div className="app-notice-body">
            <p>
              Compaction failed: {describeModelError(game.compactionError).replace(/\.+$/, '')}. Your turn
              went ahead; it will try again next turn. Check the summariser model in Settings.
            </p>
            <ErrorDetails error={game.compactionError} />
          </div>
          <button className="ghost" onClick={game.dismissCompactionError}>Dismiss</button>
        </div>
      )}
      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => game.setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe your action…"
          rows={1}
        />
        <div className="composer-buttons">
          {thinking ? (
            <button
              className="primary"
              onClick={game.cancelOperation}
              title="Stop the DM and put your action back in the box"
            >
              Stop
            </button>
          ) : (
            <button
              className="primary"
              onClick={act}
              disabled={!input.trim() || game.unanswered}
              title={game.unanswered ? 'The DM has not replied yet: continue or undo the last turn first' : undefined}
            >
              Act
            </button>
          )}
          {!thinking && turns.length > 0 && (
            <button
              className="ghost"
              onClick={continueStory}
              title={
                game.unanswered
                  ? 'Have the DM reply to the last turn'
                  : 'Have the DM carry the story on to its next development — time passes, NPCs act'
              }
            >
              Continue
            </button>
          )}
        </div>
      </div>
      {showSettings && (
        <SettingsPanel
          model={model}
          apiKey={apiKey}
          baseUrl={baseUrl}
          slots={game.slots}
          sampling={sampling}
          context={context}
          showTrace={showTrace}
          onClose={() => setShowSettings(false)}
          onSave={(nextModel, nextApiKey, nextBaseUrl, nextSlots, nextSampling, nextContext, nextShowTrace) => {
            settings.save(nextModel, nextApiKey, nextBaseUrl, nextSampling, nextContext, nextShowTrace)
            game.commitSlots(nextSlots)
          }}
        />
      )}
      {inspect === 'state' && (
        <StateViewer
          state={game.state}
          plot={game.plot}
          memory={game.memory}
          ooc={game.ooc}
          chronicle={game.chronicle}
          context={context}
          busy={thinking}
          canCompact={game.canCompact}
          onClose={() => setInspect(null)}
          onInspect={setInspect}
          onCompact={() => void game.compactNow()}
          onResetState={() => game.commitState(structuredClone(DEFAULT_STATE))}
          onSaveState={game.commitState}
          onSavePlot={game.commitPlot}
          onSaveMemory={game.commitMemory}
          onSaveOoc={game.commitOoc}
          onSaveChronicle={game.commitChronicle}
          onClearPlot={() => game.commitPlot([])}
          onClearMemory={() => game.commitMemory({})}
          onClearOoc={() => game.commitOoc([])}
          onClearChronicle={() => {
            game.commitChronicle([])
            game.commitCompactCutoff(0)
          }}
        />
      )}
      {inspect === 'context' && (() => {
        const lastTurn = [...turns].reverse().find((t) => t.reply.text || t.narrator?.text)
        const lastDraft = lastTurn?.narrator?.text ?? lastTurn?.reply.text ?? ''
        const reviserPreview = context.useReviser
          ? {
              messages: buildReviserMessages(
                game.slots,
                lastDraft || '(placeholder draft — take one turn to see the real reviser request)',
              ),
              model: context.reviserModel,
              source: lastDraft ? ('last-turn' as const) : ('no-draft' as const),
              note: lastTurn ? `Draft from turn #${turns.indexOf(lastTurn) + 1}.` : '',
            }
          : undefined
        const data = {
          state: game.state,
          plot: game.plot,
          memory: game.memory,
          ooc: game.ooc,
        }
        // Both previews show the next turn, with a placeholder for its input.
        const nextTurn: Turn = {
          id: 'next-turn',
          kind: 'player',
          input: '(the player’s next input)',
          reply: { id: 'next-reply', model, text: '' },
        }
        const story = {
          systemPrompt,
          slots: game.slots,
          chronicle: game.chronicle,
          history: [...turns.slice(compactCutoff), nextTurn],
          data,
          includePriorPlayerTurns: context.includePriorPlayerTurns,
          flags: context,
          nsfw: context.nsfw,
          reminderAsSystem: context.reminderAsSystem,
        }
        const tools = buildPlotterTools(context)
        return (
          <ContextViewer
            narrator={buildNarratorSections(story)}
            plotter={
              tools.length
                ? {
                    sections: buildPlotterSections({
                      ...story,
                      pivot: buildPlotterInstruction(context, data, context.stateCleanupChars),
                    }),
                    tools,
                    model: context.plotterModel.trim() || model,
                  }
                : undefined
            }
            sampling={sampling}
            reviser={reviserPreview}
            onClose={() => setInspect(null)}
            onInspect={setInspect}
          />
        )
      })()}
      {showNewAdventure && (
        <NewAdventurePrompt
          slots={game.slots}
          inProgress={turns.length > 0}
          onCancel={() => setShowNewAdventure(false)}
          onBegin={(nextSlots) => {
            setShowNewAdventure(false)
            void game.newAdventure(nextSlots)
          }}
        />
      )}
      {showSaves && (
        <SavesPanel
          saves={saves.saves}
          canSave={!thinking && turns.some((turn) => !!turn.reply.text)}
          busy={thinking}
          turnCount={turns.length}
          onClose={() => setShowSaves(false)}
          onSave={saves.saveCurrentGame}
          onOverwrite={saves.overwriteSavedGame}
          onLoad={(id) => {
            if (saves.loadSavedGame(id)) setShowSaves(false)
          }}
          onDelete={saves.deleteSavedGame}
          onExport={saves.exportSavedGame}
          onImport={saves.importSavedGame}
        />
      )}
    </main>
  )
}

export default App
