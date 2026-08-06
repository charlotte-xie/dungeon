// Provider-neutral tool schemas plus the game-state executor. Wire-format
// conversion and text-protocol recovery live under ./model.

import { buildMemoryRules, buildPlotRules } from '../prompts'
import type { ModelToolDefinition } from './model/types'
import { deleteByPath, getByPath, isSafeStatePath, setByPath } from './state'
import type { JsonValue, Memory, WorldState } from './types'

export const MAX_PLOT_ITEMS = 10
export const MAX_PLOT_ITEM_CHARS = 300

export const MAX_MEMORY_STRING_CHARS = 500

export const PLOT_RULES = buildPlotRules(MAX_PLOT_ITEMS, MAX_PLOT_ITEM_CHARS)

export const MEMORY_RULES = buildMemoryRules(MAX_MEMORY_STRING_CHARS)

export const UPDATE_STATE_TOOL: ModelToolDefinition = {
    name: 'update_state',
    description:
      `Replace the current-scene consistency state, but only when that state materially changed. Always pass both \`keep\` and \`set\`. The previous state is cleared; paths in \`keep\` retain their current values; then dotted paths in \`set\` are added or overwritten. Anything omitted from both is deleted, and setting a path to null also deletes it. Use short, complete English phrases for string values. Empty \`keep\` and \`set\` clears the state.`,
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
}
export const FUTURE_PLOT_PLAN_TOOL: ModelToolDefinition = {
    name: 'future_plot_plan',
    description:
      `Edit the private numbered plan of future pressures, revelations, NPC moves, and unresolved hooks. Call only when the plan materially changes. Use one operation per call: \`append\` or \`insert\` a genuine new direction, \`update\` a direction that shifted, or \`delete\` a beat once it has played out. Positions are 1-indexed. Maximum ${MAX_PLOT_ITEMS} entries and ${MAX_PLOT_ITEM_CHARS} characters per entry.`,
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
}

export const UPDATE_MEMORY_TOOL: ModelToolDefinition = {
    name: 'update_memory',
    description:
      `Update canonical long-term facts that should persist across scenes: recurring NPCs, locations, threads, secrets, and consequential past events. Call only for a material change. \`set\` maps lowercase underscore slugs to complete replacement descriptions; \`delete\` removes entries that are genuinely no longer relevant. Deletes apply before sets. Do not store transient current-scene detail or future plans. Each description is limited to ${MAX_MEMORY_STRING_CHARS} characters.`,
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
}

// Context read tools. Each request seeds one "fake" assistant call to the
// enabled read tools right before generation, delivering the current memory /
// plot plan / state as tool results (see ../request.ts). The tools are also
// advertised live, so the model can legitimately re-issue them to re-check a
// value mid-turn; they never mutate anything.

export const GET_STATE_TOOL: ModelToolDefinition = {
    name: 'get_state',
    description:
      'Read the current live-state JSON (current-scene consistency facts). The latest state is already in this conversation as a get_state result; call again only to re-check it after updates.',
    parameters: { type: 'object', properties: {} },
}

export const GET_MEMORY_TOOL: ModelToolDefinition = {
    name: 'get_memory',
    description:
      'Read the current long-term memory entries. The latest memory is already in this conversation as a get_memory result; call again only to re-check it after updates.',
    parameters: { type: 'object', properties: {} },
}

export const GET_PLOT_PLAN_TOOL: ModelToolDefinition = {
    name: 'get_plot_plan',
    description:
      'Read the current private future plot plan. The latest plan is already in this conversation as a get_plot_plan result; call again only to re-check it after updates.',
    parameters: { type: 'object', properties: {} },
}

export const CONTEXT_READ_TOOL_NAMES: ReadonlySet<string> = new Set([
  GET_STATE_TOOL.name,
  GET_MEMORY_TOOL.name,
  GET_PLOT_PLAN_TOOL.name,
])

export function isContextReadTool(name: string): boolean {
  return CONTEXT_READ_TOOL_NAMES.has(name)
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
      const unsafePaths = [
        ...keepPaths.filter((path) => !isSafeStatePath(path)),
        ...rawSetEntries.map(([path]) => path).filter((path) => !isSafeStatePath(path)),
      ]
      if (unsafePaths.length > 0) {
        return {
          state,
          plot,
          memory,
          result: `error: unsafe state path${unsafePaths.length === 1 ? '' : 's'} rejected: ${unsafePaths.join(', ')}. Previous state unchanged.`,
        }
      }
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

export function executeEnabledTool(
  enabledNames: ReadonlySet<string>,
  name: string,
  rawArgs: string,
  state: WorldState,
  plot: string[],
  memory: Memory,
): ToolExecResult {
  if (!enabledNames.has(name)) {
    return { state, plot, memory, result: `error: tool ${name} is disabled` }
  }
  return executeTool(name, rawArgs, state, plot, memory)
}
