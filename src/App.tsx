import { Fragment, useEffect, useRef, useState } from 'react'
import './App.css'
import { DEFAULT_SYSTEM_PROMPT } from './prompts'
import { buildReviserMessages } from './engine/agents/reviser'
import { totalChronicleEntries } from './engine/chronicle'
import { DEFAULT_STATE } from './engine/config'
import { applyTurnReminder, buildModelMessages } from './engine/request'
import {
  CHECK_MEMORY_TOOL,
  CHECK_PLOT_PLAN_TOOL,
  CHECK_STATE_TOOL,
  FUTURE_PLOT_PLAN_TOOL,
  UPDATE_MEMORY_TOOL,
  UPDATE_STATE_TOOL,
} from './engine/tools'
import { useGameController } from './hooks/useGameController'
import { useSaves } from './hooks/useSaves'
import { useSettings } from './hooks/useSettings'
import { ContextViewer } from './ui/ContextViewer'
import { EditableMessage } from './ui/EditableMessage'
import { NewAdventurePrompt } from './ui/NewAdventurePrompt'
import { SavesPanel } from './ui/SavesPanel'
import { SettingsPanel } from './ui/SettingsPanel'
import { StateViewer } from './ui/StateViewer'
import { TraceView } from './ui/TraceView'

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
  const [showState, setShowState] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [showNewAdventure, setShowNewAdventure] = useState(false)
  const [showSaves, setShowSaves] = useState(false)
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
      void game.send()
    }
  }

  return (
    <main className="app">
      <header>
        <h1>AI Dungeon Master</h1>
        <div className="header-actions">
          <button
            className="ghost"
            onClick={() => setShowNewAdventure(true)}
            title={thinking
              ? 'Start a new adventure and cancel the current generation'
              : 'Start a new adventure — confirm or edit the scenario brief'}
          >
            New Adventure
          </button>
          <button
            className="ghost"
            onClick={() => void game.compactNow()}
            disabled={thinking || !game.canCompact}
            title="Fold older turns into the chronicle now"
          >
            Compact
          </button>
          <button className="ghost" onClick={() => setShowSaves(true)}>
            Saves
          </button>
          <button className="ghost" onClick={() => setShowContext(true)}>
            Context
          </button>
          <button className="ghost" onClick={() => setShowState(true)}>
            State
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
            <p className="hint">The DM will narrate the opening based on your scenario brief (edit in Settings).</p>
          </div>
        )}
        {turns.map((t, i) => {
          const folded = i < compactCutoff
          const showInput = t.kind === 'player' && t.input !== undefined
          const showReply = !!t.reply.text
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
      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => game.setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Describe your action…"
          rows={1}
        />
        <div className="composer-buttons">
          <button
            className="primary"
            onClick={() => void game.send()}
            disabled={thinking || !input.trim()}
          >
            Act
          </button>
          <button
            className="ghost"
            onClick={game.cancelOperation}
            disabled={!thinking}
            title="Cancel the active model request and restore the pending input"
          >
            Cancel
          </button>
          <button
            className="ghost"
            onClick={game.undo}
            disabled={thinking || !game.canUndo}
            title="Roll back the last turn — restore state and put your input back in the box"
          >
            Undo
          </button>
          <button
            className="ghost"
            onClick={() => void game.retry()}
            disabled={thinking || !game.canRetry}
            title="Discard the DM's last reply and re-roll with the same action"
          >
            Retry
          </button>
          <button
            className="ghost"
            onClick={() => void game.continueStory()}
            disabled={thinking || turns.length === 0}
            title="Have the DM keep narrating — time passes, NPCs act — until the player faces a concrete decision"
          >
            Continue
          </button>
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
      {showState && (
        <StateViewer
          state={game.state}
          plot={game.plot}
          memory={game.memory}
          chronicle={game.chronicle}
          context={context}
          busy={thinking}
          onClose={() => setShowState(false)}
          onResetState={() => game.commitState(structuredClone(DEFAULT_STATE))}
          onSaveState={game.commitState}
          onSavePlot={game.commitPlot}
          onSaveMemory={game.commitMemory}
          onClearPlot={() => game.commitPlot([])}
          onClearMemory={() => game.commitMemory({})}
          onClearChronicle={() => {
            game.commitChronicle([])
            game.commitCompactCutoff(0)
          }}
        />
      )}
      {showContext && (() => {
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
              buildModelMessages(
                systemPrompt,
                game.slots,
                game.chronicle,
                turns.slice(compactCutoff),
                { state: game.state, plot: game.plot, memory: game.memory },
                context.stateCleanupChars,
                context.includePriorPlayerTurns,
                context.includeWorldState,
                context.includePlotOutline,
                context.includeMemory,
                context.nsfw,
              ),
              context.reminderAsSystem,
              {
                worldState: context.includeWorldState,
                plotOutline: context.includePlotOutline,
                memory: context.includeMemory,
              },
            )}
            tools={[
              ...(context.includeMemory ? [UPDATE_MEMORY_TOOL, CHECK_MEMORY_TOOL] : []),
              ...(context.includeWorldState ? [UPDATE_STATE_TOOL, CHECK_STATE_TOOL] : []),
              ...(context.includePlotOutline
                ? [FUTURE_PLOT_PLAN_TOOL, CHECK_PLOT_PLAN_TOOL]
                : []),
            ]}
            sampling={sampling}
            reviser={reviserPreview}
            onClose={() => setShowContext(false)}
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
