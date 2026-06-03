// Tool schemas advertised to the model + executor for tool calls + a fallback
// parser for inline <function_call> XML the model sometimes emits as prose.

import { buildMemoryRules, buildPlotRules } from '../prompts'
import { deleteByPath, getByPath, setByPath } from './state'
import type { InlineToolCall, JsonValue, Memory, WorldState } from './types'

export const MAX_PLOT_ITEMS = 10
export const MAX_PLOT_ITEM_CHARS = 300

export const MAX_MEMORY_STRING_CHARS = 500

export const PLOT_RULES = buildPlotRules(MAX_PLOT_ITEMS, MAX_PLOT_ITEM_CHARS)

export const MEMORY_RULES = buildMemoryRules(MAX_MEMORY_STRING_CHARS)

export const UPDATE_STATE_TOOL = {
  type: 'function',
  function: {
    name: 'update_state',
    description:
      `Rewrite the world state JSON for the next turn. The previous state is FIRST cleared in full; then the paths you list in \`keep\` are restored from the previous state (carrying forward their existing values); then your \`set\` map is applied on top, creating or overwriting paths. There is NO separate delete — omission is deletion. (As a convenience, a path whose value in \`set\` is \`null\` is treated as omission: that path is dropped from the next turn, even if it appears in \`keep\`. State never stores null.) ` +
      `EVERY TURN you must pass BOTH parameters together. \`keep\` is a whitelist of dotted paths from the CURRENT state that should survive into the next turn unchanged; anything not in \`keep\` is gone unless you also re-set it via \`set\`. \`set\` carries new or updated values on top of the kept paths. ` +
      `Use this each turn to (a) carry forward facts whose value is unchanged (cheap — just list the path in \`keep\`), (b) update facts whose value has changed (put the new value in \`set\`), and (c) drop facts that no longer apply (simply omit them from both lists). ` +
      `STRING VALUES in \`set\` must be complete English phrases or short clauses with all articles, prepositions, and verbs in place — NOT telegraphic fragments, NOT single keywords, NOT label-shorthand. ` +
      `RIGHT: "standing at the edge of the dock", "wary of the player and unwilling to speak openly", "a heavy iron seal in his coat pocket". ` +
      `Compactness comes from picking the right level of detail and splitting long facts across multiple keys, not from dropping grammar. ` +
      `Example call (the priest's study scene continues; the player just sat down and drew a knife; the earlier "weather" key from the street scene no longer applies): {keep:["scene.location","scene.mood","npcs.priest.posture"], set:{"player.position":"seated in the high-backed chair across from the priest","player.holding":"a slim boot-knife, blade flat against the thigh"}}. The previous state's \`scene.weather\` and any old \`player.*\` values are dropped because they aren't in \`keep\` and aren't reset. ` +
      `Calling with empty \`keep\` and empty \`set\` clears all state (between-scenes reset).`,
    parameters: {
      type: 'object',
      properties: {
        keep: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Whitelist of dotted paths from the CURRENT state to carry into the next turn unchanged. Paths not listed (and not re-set via `set`) are dropped. Paths that do not exist in the current state are silently no-ops.',
        },
        set: {
          type: 'object',
          description:
            'Map of dotted paths → values to assign on top of the kept paths. Creates new paths or overwrites kept ones.',
          additionalProperties: true,
        },
      },
      required: ['keep', 'set'],
    },
  },
}

export const FUTURE_PLOT_PLAN_TOOL = {
  type: 'function',
  function: {
    name: 'future_plot_plan',
    description:
      `Edit the numbered FUTURE plot plan — your private DM notebook of the directions the story is heading in, not what has already happened. Keeping the plot interesting and engaging is YOUR responsibility; this tool is how you do it. Every entry must describe an upcoming pressure, revelation, NPC move, or unresolved hook. As soon as something is delivered to the player, DELETE that entry — past events do not belong here (the chronicle records them). Exactly one operation per call via \`op\`. Positions are 1-indexed and refer to the list as it appears in the system message. ` +
      `OPERATIONS: ` +
      `\`append\` adds a new future entry at the end (\`text\` required); ` +
      `\`insert\` inserts a new future entry before \`position\`; ` +
      `\`update\` rewrites the entry at \`position\` (use this when a direction has shifted but the thread is still ahead of the player); ` +
      `\`delete\` removes the entry at \`position\` (use this the moment a planned beat becomes past). ` +
      `LIMITS: at most ${MAX_PLOT_ITEMS} entries total; each entry's \`text\` must be <= ${MAX_PLOT_ITEM_CHARS} chars. Out-of-range positions, missing required fields, or oversize text reject the call and leave the list unchanged.`,
    parameters: {
      type: 'object',
      properties: {
        op: {
          type: 'string',
          enum: ['append', 'insert', 'update', 'delete'],
          description: 'Update operation to perform.',
        },
        position: {
          type: 'integer',
          minimum: 1,
          description:
            '1-indexed slot. Required for insert/update/delete. For insert, may equal length+1 (append at end). Ignored for append.',
        },
        text: {
          type: 'string',
          description: `New bullet content. Required for append/insert/update. Must be <= ${MAX_PLOT_ITEM_CHARS} chars. Ignored for delete.`,
        },
      },
      required: ['op'],
    },
  },
}

export const UPDATE_MEMORY_TOOL = {
  type: 'function',
  function: {
    name: 'update_memory',
    description:
      `Update long-term memory — your canonical record of NPCs, locations, plot themes, and key past events that should persist across scenes. Provide \`set\` (a map of slug → string description), \`delete\` (an array of slugs to remove), or both. Deletes apply first, then sets — so a slug that appears in both ends up with the set value. ` +
      `STRUCTURE: each key is a slug (lowercase, underscores, no periods or spaces) and each value is a single complete English description that captures everything important about that entity. Setting a slug REPLACES its description in full — write the whole updated description, not a delta. Example: \`{"lady_veyra":"spymaster of the Crimson Court; tall, silver-haired, soft-spoken; wants the courier ledger destroyed; openly hostile to the player after the dock confrontation; secretly the Duke's half-sister"}\`. ` +
      `WHEN TO USE: use \`update_memory\` IN PREFERENCE TO \`update_state\` for anything that should be remembered beyond the current scene — recurring NPCs, named places, plot themes, secrets, important past events. Use \`update_state\` only for the live current scene (current location, what the player is doing right now, immediate sensory details). ` +
      `WHEN TO DELETE: only when an entity is genuinely no longer relevant to the story (a one-off NPC who has fully left the narrative, a location that's been abandoned permanently, a plot theme that's been resolved and won't return). Do NOT delete on scene change — memory persists. ` +
      `VALUES must be complete English prose — sentences or semicolon-joined clauses with all articles, prepositions, and verbs in place — NOT telegraphic fragments, NOT JSON, NOT bullet lists. ` +
      `HARD LIMIT: each value must be <= ${MAX_MEMORY_STRING_CHARS} characters. An over-long value is rejected and the existing value is left unchanged. If an entity needs more than that, split it across two slugs (e.g. \`lady_veyra\` and \`lady_veyra_secret\`).`,
    parameters: {
      type: 'object',
      properties: {
        set: {
          type: 'object',
          description: `Map of slug → string description. Slugs are lowercase with underscores, no periods or spaces. Each value is a single complete English description, <= ${MAX_MEMORY_STRING_CHARS} chars. Setting a slug fully replaces its existing description.`,
          additionalProperties: { type: 'string' },
        },
        delete: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Slugs to remove entirely. Applied before sets. Only delete when the target is genuinely no longer relevant to the story.',
        },
      },
    },
  },
}

export interface ToolExecResult {
  state: WorldState
  plot: string[]
  memory: Memory
  result: string
}

export function executeTool(
  name: string,
  rawArgs: string,
  state: WorldState,
  plot: string[],
  memory: Memory,
): ToolExecResult {
  if (name === 'update_state') {
    try {
      const args = JSON.parse(rawArgs) as {
        keep?: unknown
        set?: Record<string, JsonValue>
      }
      if (!Array.isArray(args.keep)) {
        return {
          state,
          plot,
          memory,
          result:
            'error: update_state requires `keep` (array of dotted paths to carry forward from the current state — empty array `[]` is valid). Previous state unchanged.',
        }
      }
      if (!args.set || typeof args.set !== 'object' || Array.isArray(args.set)) {
        return {
          state,
          plot,
          memory,
          result:
            'error: update_state requires `set` (map of dotted-path → value to assign on top of kept paths — empty object `{}` is valid). Previous state unchanged.',
        }
      }
      const keepPaths = args.keep.filter(
        (p): p is string => typeof p === 'string' && p.length > 0,
      )
      const rawSetEntries: [string, JsonValue][] = Object.entries(args.set).filter(
        (e): e is [string, JsonValue] => typeof e[0] === 'string' && e[0].length > 0,
      )
      // null/undefined in `set` means delete: drop the path instead of writing
      // it. (JSON.parse never produces undefined, but we accept it defensively.)
      const setWrites: [string, JsonValue][] = []
      const setDeletes: string[] = []
      for (const [path, value] of rawSetEntries) {
        if (value === null || value === undefined) setDeletes.push(path)
        else setWrites.push([path, value])
      }
      // Build the new state from scratch: first re-apply each kept path's
      // existing value, then apply `set` writes on top, then apply `set`
      // deletes (so a path that's both kept and null-set is dropped). Sort
      // both write lists by depth so a shallow assignment doesn't clobber a
      // deeper one written first.
      const sortByDepth = <T extends { path: string }>(entries: T[]): T[] =>
        entries.slice().sort((a, b) => a.path.split('.').length - b.path.split('.').length)
      let nextState: WorldState = {}
      const keepNotes: string[] = []
      // Filter null values out of kept paths too: state should never contain
      // null, so any null leaking through from a prior turn is treated as
      // already-deleted (heals legacy pollution silently).
      for (const { path, value } of sortByDepth(
        keepPaths
          .map((path) => ({ path, value: getByPath(state, path) }))
          .filter(
            (e): e is { path: string; value: JsonValue } =>
              e.value !== undefined && e.value !== null,
          ),
      )) {
        nextState = setByPath(nextState, path, value)
      }
      const missingKeeps = keepPaths.filter((p) => {
        const v = getByPath(state, p)
        return v === undefined || v === null
      })
      if (missingKeeps.length) {
        keepNotes.push(`kept paths missing from previous state (no-op): ${missingKeeps.join(', ')}`)
      }
      for (const { path, value } of sortByDepth(
        setWrites.map(([path, value]) => ({ path, value })),
      )) {
        nextState = setByPath(nextState, path, value)
      }
      for (const path of setDeletes) {
        nextState = deleteByPath(nextState, path)
      }
      const prevTopKeys = Object.keys(state).length
      const newTopKeys = Object.keys(nextState).length
      const totalSetOps = setWrites.length + setDeletes.length
      const deleteNote = setDeletes.length
        ? `, deleted ${setDeletes.length} path${setDeletes.length === 1 ? '' : 's'} via null`
        : ''
      const summary =
        keepPaths.length === 0 && totalSetOps === 0
          ? `state cleared (was ${prevTopKeys} top-level key${prevTopKeys === 1 ? '' : 's'}, now empty)`
          : `kept ${keepPaths.length} path${keepPaths.length === 1 ? '' : 's'}, set ${setWrites.length} path${setWrites.length === 1 ? '' : 's'}${deleteNote}; ${newTopKeys} top-level key${newTopKeys === 1 ? '' : 's'} now`
      const notes = keepNotes.length ? `; ${keepNotes.join('; ')}` : ''
      return {
        state: nextState,
        plot,
        memory,
        result: `ok — ${summary}${notes}. Anything not in \`keep\` and not in \`set\` has been dropped.`,
      }
    } catch (err) {
      return { state, plot, memory, result: `error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  if (name === 'update_memory') {
    try {
      const args = JSON.parse(rawArgs) as {
        set?: Record<string, unknown>
        delete?: string[]
      }
      const setEntries: [string, unknown][] =
        args.set && typeof args.set === 'object' && !Array.isArray(args.set)
          ? Object.entries(args.set).filter(
              (e): e is [string, unknown] => typeof e[0] === 'string' && e[0].length > 0,
            )
          : []
      const deleteSlugs = Array.isArray(args.delete)
        ? args.delete.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : []
      if (setEntries.length === 0 && deleteSlugs.length === 0) {
        return {
          state,
          plot,
          memory,
          result: 'error: update_memory requires a non-empty `set` map, a non-empty `delete` array, or both.',
        }
      }
      const notes: string[] = []
      let failed = false
      let nextMemory: Memory = memory
      for (const slug of deleteSlugs) {
        if (slug.includes('.')) {
          notes.push(
            `REJECTED delete ${slug}: memory slugs cannot contain periods. Use the bare slug (e.g. "lady_veyra"). Existing value unchanged.`,
          )
          failed = true
          continue
        }
        if (slug in nextMemory) {
          const copy = { ...nextMemory }
          delete copy[slug]
          nextMemory = copy
          notes.push(`deleted ${slug}`)
        } else {
          notes.push(`deleted ${slug} (no-op; not present)`)
        }
      }
      for (const [slug, value] of setEntries) {
        if (slug.includes('.')) {
          notes.push(
            `REJECTED set ${slug}: memory slugs cannot contain periods. Use the bare slug (e.g. "lady_veyra"). Existing value unchanged.`,
          )
          failed = true
          continue
        }
        if (typeof value !== 'string') {
          const got = Array.isArray(value)
            ? 'array'
            : value === null
              ? 'null'
              : typeof value
          notes.push(
            `REJECTED set ${slug}: memory values must be strings (a single complete English description). Got ${got}. Existing value unchanged.`,
          )
          failed = true
          continue
        }
        if (value.length > MAX_MEMORY_STRING_CHARS) {
          notes.push(
            `REJECTED set ${slug}: description too long (${value.length} chars, max ${MAX_MEMORY_STRING_CHARS}). Existing value unchanged. Split across two slugs or rewrite tighter.`,
          )
          failed = true
          continue
        }
        nextMemory = { ...nextMemory, [slug]: value }
        notes.push(`set ${slug}`)
      }
      const result = `${failed ? 'partial' : 'ok'} — memory: ${notes.join('; ')}`
      return { state, plot, memory: nextMemory, result }
    } catch (err) {
      return { state, plot, memory, result: `error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  if (name === 'future_plot_plan') {
    try {
      const args = JSON.parse(rawArgs) as {
        op?: unknown
        position?: unknown
        text?: unknown
      }
      const op = args.op
      if (op !== 'append' && op !== 'insert' && op !== 'update' && op !== 'delete') {
        return {
          state,
          plot,
          memory,
          result:
            'error: future_plot_plan requires `op` to be one of "append","insert","update","delete". Plan unchanged.',
        }
      }
      const text = typeof args.text === 'string' ? args.text.trim() : ''
      const positionRaw = typeof args.position === 'number' ? args.position : NaN
      const position = Number.isFinite(positionRaw) ? Math.trunc(positionRaw) : NaN
      const requireText = op === 'append' || op === 'insert' || op === 'update'
      if (requireText && !text) {
        return {
          state,
          plot,
          memory,
          result: `error: future_plot_plan op="${op}" requires non-empty \`text\`. Plan unchanged.`,
        }
      }
      if (requireText && text.length > MAX_PLOT_ITEM_CHARS) {
        return {
          state,
          plot,
          memory,
          result: `error: plan entry too long (${text.length} chars, max ${MAX_PLOT_ITEM_CHARS}). Rewrite shorter. Plan unchanged.`,
        }
      }
      if (op === 'append') {
        if (plot.length >= MAX_PLOT_ITEMS) {
          return {
            state,
            plot,
            memory,
            result: `error: plan already at max ${MAX_PLOT_ITEMS} entries. Delete a past-event or stale entry instead. Plan unchanged.`,
          }
        }
        const next = [...plot, text]
        return { state, plot: next, memory, result: `ok — appended as entry ${next.length}.` }
      }
      if (op === 'insert') {
        if (plot.length >= MAX_PLOT_ITEMS) {
          return {
            state,
            plot,
            memory,
            result: `error: plan already at max ${MAX_PLOT_ITEMS} entries. Delete a past-event or stale entry instead. Plan unchanged.`,
          }
        }
        if (!Number.isInteger(position) || position < 1 || position > plot.length + 1) {
          return {
            state,
            plot,
            memory,
            result: `error: insert position ${args.position ?? '(missing)'} out of range. Valid: 1..${plot.length + 1}. Plan unchanged.`,
          }
        }
        const next = [...plot.slice(0, position - 1), text, ...plot.slice(position - 1)]
        return {
          state,
          plot: next,
          memory,
          result: `ok — inserted at position ${position}. Plan now has ${next.length} entr${next.length === 1 ? 'y' : 'ies'}.`,
        }
      }
      if (op === 'update') {
        if (!Number.isInteger(position) || position < 1 || position > plot.length) {
          return {
            state,
            plot,
            memory,
            result: `error: update position ${args.position ?? '(missing)'} out of range. Valid: 1..${plot.length}. Plan unchanged.`,
          }
        }
        const next = plot.slice()
        next[position - 1] = text
        return { state, plot: next, memory, result: `ok — updated entry ${position}.` }
      }
      // op === 'delete'
      if (!Number.isInteger(position) || position < 1 || position > plot.length) {
        return {
          state,
          plot,
          memory,
          result: `error: delete position ${args.position ?? '(missing)'} out of range. Valid: 1..${plot.length}. Plan unchanged.`,
        }
      }
      const next = [...plot.slice(0, position - 1), ...plot.slice(position)]
      return {
        state,
        plot: next,
        memory,
        result: `ok — deleted entry ${position}. Plan now has ${next.length} entr${next.length === 1 ? 'y' : 'ies'}.`,
      }
    } catch (err) {
      return { state, plot, memory, result: `error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  return { state, plot, memory, result: `error: unknown tool ${name}` }
}

const INLINE_TOOL_CALL_PATTERN =
  /<function_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/function_call>/gi

export function parseInlineToolCalls(content: string): { cleaned: string; calls: InlineToolCall[] } {
  const calls: InlineToolCall[] = []
  const cleaned = content
    .replace(INLINE_TOOL_CALL_PATTERN, (_match, name: string, body: string) => {
      calls.push({ name, arguments: body.trim() })
      return ''
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { cleaned, calls }
}
