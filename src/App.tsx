import { Fragment, useEffect, useRef, useState } from 'react'
import './App.css'
import { DEFAULT_SYSTEM_PROMPT } from './prompts'
import { buildReviserMessages } from './engine/agents/reviser'
import { totalChronicleEntries } from './engine/chronicle'
import { DEFAULT_STATE } from './engine/config'
import { describeModelError } from './engine/model/errors'
import { applyTurnReminder, buildModelMessages } from './engine/request'
import { CONTEXT_SUBSYSTEMS } from './engine/request'
import { useGameController } from './hooks/useGameController'
import { useSaves } from './hooks/useSaves'
import { useSettings } from './hooks/useSettings'
import { ContextViewer } from './ui/ContextViewer'
import { EditableMessage } from './ui/EditableMessage'
import { ErrorDetails } from './ui/ErrorDetails'
import { NewAdventurePrompt } from './ui/NewAdventurePrompt'
import { SavesPanel } from './ui/SavesPanel'
import { SettingsPanel } from './ui/SettingsPanel'
import { StateViewer } from './ui/StateViewer'
import { TraceView } from './ui/TraceView'
import { AdventureMenu } from './ui/AdventureMenu'
import type { InspectView } from './ui/InspectSwitch'

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

  return (
    <main className="app">
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
      <div className="log" ref={logRef}>
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
          const showReply = !!t.reply.text
          // Fixing a reply happens at the reply: only the latest one can be
          // retried, rewritten, or undone, and Redo takes their place after an undo.
          const latest = i === turns.length - 1 && !thinking
          const replyActions = latest && (game.canRedo || game.canRetry || game.canUndo)
          return (
            <Fragment key={t.id}>
              {i === compactCutoff && compactCutoff > 0 && (
                <div className="compact-divider">
                  <span>earlier turns folded into chronicle — still shown, but model sees summary</span>
                </div>
              )}
              {showInput && (
                <div className={`msg msg-player ${folded ? 'msg-folded' : ''}`}>
                  <span className="who">You</span>
                  <EditableMessage
                    text={t.input ?? ''}
                    onSave={(next) => game.editTurnInput(t.id, next)}
                  />
                </div>
              )}
              {showReply && (
                <div className={`msg msg-dm ${folded ? 'msg-folded' : ''}`}>
                  <span className="who">DM</span>
                  <EditableMessage
                    text={t.reply.text ?? ''}
                    onSave={(next) => game.editTurnReply(t.id, next)}
                  />
                  {t.plotter?.error && (
                    <div className="turn-notice" role="status">
                      <p>
                        Plotter failed — state, plot, memory and OOC weren't updated this turn:{' '}
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
                  {showTrace && (t.reply.trace !== undefined || t.narrator || t.plotter) && (
                    <TraceView
                      calls={
                        t.narrator
                          ? [
                              { label: 'narrator (draft)', call: t.narrator, hideText: true },
                              ...(t.plotter ? [{ label: 'plotter', call: t.plotter }] : []),
                              {
                                label: 'reviser',
                                call: t.reply,
                                diffAgainst: t.narrator.text ?? '',
                              },
                            ]
                          : [
                              { label: 'narrator', call: t.reply, hideText: true },
                              ...(t.plotter ? [{ label: 'plotter', call: t.plotter }] : []),
                            ]
                      }
                      expanded={expandedTraces.has(t.id)}
                      onToggle={() => toggleTrace(t.id)}
                    />
                  )}
                </div>
              )}
            </Fragment>
          )
        })}
        {thinking && <div className="msg msg-dm thinking">{statusText}</div>}
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
            <button className="primary" onClick={act} disabled={!input.trim()}>
              Act
            </button>
          )}
          {!thinking && turns.length > 0 && (
            <button
              className="ghost"
              onClick={continueStory}
              title="Have the DM keep narrating — time passes, NPCs act — until the player faces a concrete decision"
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
        return (
          <ContextViewer
            messages={applyTurnReminder(
              buildModelMessages({
                systemPrompt,
                slots: game.slots,
                chronicle: game.chronicle,
                history: turns.slice(compactCutoff),
                data: {
                  state: game.state,
                  plot: game.plot,
                  memory: game.memory,
                  ooc: game.ooc,
                },
                includePriorPlayerTurns: context.includePriorPlayerTurns,
                flags: context,
                nsfw: context.nsfw,
              }),
              context.reminderAsSystem,
              {
                worldState: context.includeWorldState,
                plotOutline: context.includePlotOutline,
                memory: context.includeMemory,
                ooc: context.includeOoc,
              },
            )}
            tools={CONTEXT_SUBSYSTEMS.filter((s) => s.enabled(context)).flatMap((s) => [
              s.updateTool,
              s.checkTool,
            ])}
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
