// Provider-neutral tool schemas plus the game-state executor. Wire-format
// conversion and text-protocol recovery live under ./model.

import { buildMemoryRules, buildOocRules, buildPlotRules } from '../prompts'
import type { ModelToolDefinition } from './model/types'
import { deleteByPath, getByPath, isSafeStatePath, setByPath } from './state'
import type { JsonValue, Memory, MemoryEntry, StoryData, WorldState } from './types'

export const MAX_PLOT_ITEMS = 10
export const MAX_PLOT_ITEM_CHARS = 300

export const MAX_MEMORY_FACET_CHARS = 300
export const MAX_MEMORY_FACETS = 8

export const MAX_OOC_ITEMS = 10
export const MAX_OOC_ITEM_CHARS = 300

export const PLOT_RULES = buildPlotRules(MAX_PLOT_ITEMS, MAX_PLOT_ITEM_CHARS)

export const MEMORY_RULES = buildMemoryRules(MAX_MEMORY_FACET_CHARS, MAX_MEMORY_FACETS)

export const OOC_RULES = buildOocRules(MAX_OOC_ITEMS, MAX_OOC_ITEM_CHARS)

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
      `Maintain the fact file about the story's recurring people, places, and things. Entries are objects of short string facets (is / wants / knows / bond / secret, plus free facets) keyed by lowercase underscore slugs. Edits are additive by dotted path — only the paths you name change; omission never deletes. Update a facet only when a durable fact about that entity is established or changed — never to log events (what happened belongs to the chronicle) and never for temporary scene data (positions, present company, moods, held or worn items). Operations apply in order move → delete → set. Maximum ${MAX_MEMORY_FACETS} facets per entry, ${MAX_MEMORY_FACET_CHARS} characters per facet.`,
    parameters: {
      type: 'object',
      properties: {
        move: {
          type: 'object',
          description:
            'Map of fromPath → toPath. Rename an entity\'s slug once its real name is learned (e.g. {"dark_haired_boy": "daniel"}) — never create a duplicate entry — or relocate a facet (`slug.facet` → `slug.facet`).',
          additionalProperties: { type: 'string' },
        },
        delete: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Paths to remove: `slug.facet` for a facet that stopped being true, or `slug` for an entity genuinely no longer relevant.',
        },
        set: {
          type: 'object',
          description: `Map of \`slug.facet\` → string (preferred — surgical), or \`slug\` → full facet object (replaces that entry; use sparingly). Facet values are complete present-tense phrases, <= ${MAX_MEMORY_FACET_CHARS} chars.`,
          additionalProperties: true,
        },
      },
    },
}

// Context read tools. Each request seeds one "fake" assistant call to the
// enabled read tools right before generation, delivering the current memory /
// plot plan / state as tool results (see ../request.ts). The framing is the
// DM checking its own private notes after the player acts and before
// narrating — "check", not "get", so the data reads as notes consulted for
// consistency rather than retrieved material to work into the reply. The
// tools are also advertised live, so the model can legitimately re-issue
// them to re-check a value mid-turn; they never mutate anything.

export const CHECK_STATE_TOOL: ModelToolDefinition = {
    name: 'check_state',
    description:
      'Check your private scene notes: the current live-state JSON (current-scene consistency facts). The latest state is already in this conversation as a check_state result; call again only to re-check it after updates.',
    parameters: { type: 'object', properties: {} },
}

export const CHECK_MEMORY_TOOL: ModelToolDefinition = {
    name: 'check_memory',
    description:
      'Check your private continuity notes: the current long-term memory entries. The latest memory is already in this conversation as a check_memory result; call again only to re-check it after updates.',
    parameters: { type: 'object', properties: {} },
}

export const CHECK_PLOT_PLAN_TOOL: ModelToolDefinition = {
    name: 'check_plot_plan',
    description:
      'Check your private planning notes: the current future plot plan. The latest plan is already in this conversation as a check_plot_plan result; call again only to re-check it after updates.',
    parameters: { type: 'object', properties: {} },
}

export const UPDATE_OOC_TOOL: ModelToolDefinition = {
    name: 'update_ooc',
    description:
      `Edit the numbered list of the player's standing out-of-character instructions. Call only when the player's input adds, changes, or withdraws a standing directive, or when an entry is completed or no longer relevant (delete it). One-shot commands fulfilled this turn are not recorded. Use one operation per call: \`append\` or \`insert\` a new directive, \`update\` one the player superseded, or \`delete\` one that no longer applies. Positions are 1-indexed. Maximum ${MAX_OOC_ITEMS} entries and ${MAX_OOC_ITEM_CHARS} characters per entry.`,
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
          description: `New entry content. Required for append/insert/update. Must be <= ${MAX_OOC_ITEM_CHARS} chars. Ignored for delete.`,
        },
      },
      required: ['op'],
    },
}

export const CHECK_OOC_TOOL: ModelToolDefinition = {
    name: 'check_ooc',
    description:
      "Check your private notes: the player's standing out-of-character instructions. The latest list is already in this conversation as a check_ooc result; call again only to re-check it after updates.",
    parameters: { type: 'object', properties: {} },
}

export interface ToolExecResult {
  data: StoryData
  result: string
}

interface ListEditSpec {
  toolName: string
  // Lower-case noun used in result messages ('plan', 'OOC list').
  noun: string
  // Guidance appended when the list is at max capacity.
  capAdvice: string
  maxItems: number
  maxItemChars: number
}

// Shared editor for the numbered-list subsystems (future plot plan, OOC
// instructions): one op per call, 1-indexed positions. Returns the edited
// list, or null when the edit was rejected (explanation in `result`).
function executeListEdit(
  rawArgs: string,
  list: string[],
  spec: ListEditSpec,
): { list: string[] | null; result: string } {
  const { toolName, noun, capAdvice, maxItems, maxItemChars } = spec
  const capNoun = noun.charAt(0).toUpperCase() + noun.slice(1)
  try {
    const args = JSON.parse(rawArgs) as { op?: unknown; position?: unknown; text?: unknown }
    const op = args.op
    if (op !== 'append' && op !== 'insert' && op !== 'update' && op !== 'delete') {
      return {
        list: null,
        result: `error: ${toolName} requires \`op\` to be one of "append","insert","update","delete". ${capNoun} unchanged.`,
      }
    }
    const text = typeof args.text === 'string' ? args.text.trim() : ''
    const positionRaw = typeof args.position === 'number' ? args.position : NaN
    const position = Number.isFinite(positionRaw) ? Math.trunc(positionRaw) : NaN
    const requireText = op === 'append' || op === 'insert' || op === 'update'
    if (requireText && !text) {
      return {
        list: null,
        result: `error: ${toolName} op="${op}" requires non-empty \`text\`. ${capNoun} unchanged.`,
      }
    }
    if (requireText && text.length > maxItemChars) {
      return {
        list: null,
        result: `error: ${noun} entry too long (${text.length} chars, max ${maxItemChars}). Rewrite shorter. ${capNoun} unchanged.`,
      }
    }
    if (op === 'append' || op === 'insert') {
      if (list.length >= maxItems) {
        return {
          list: null,
          result: `error: ${noun} already at max ${maxItems} entries. ${capAdvice} ${capNoun} unchanged.`,
        }
      }
    }
    if (op === 'append') {
      const next = [...list, text]
      return { list: next, result: `ok — appended as entry ${next.length}.` }
    }
    if (op === 'insert') {
      if (!Number.isInteger(position) || position < 1 || position > list.length + 1) {
        return {
          list: null,
          result: `error: insert position ${args.position ?? '(missing)'} out of range. Valid: 1..${list.length + 1}. ${capNoun} unchanged.`,
        }
      }
      const next = [...list.slice(0, position - 1), text, ...list.slice(position - 1)]
      return {
        list: next,
        result: `ok — inserted at position ${position}. ${capNoun} now has ${next.length} entr${next.length === 1 ? 'y' : 'ies'}.`,
      }
    }
    if (op === 'update') {
      if (!Number.isInteger(position) || position < 1 || position > list.length) {
        return {
          list: null,
          result: `error: update position ${args.position ?? '(missing)'} out of range. Valid: 1..${list.length}. ${capNoun} unchanged.`,
        }
      }
      const next = list.slice()
      next[position - 1] = text
      return { list: next, result: `ok — updated entry ${position}.` }
    }
    // op === 'delete'
    if (!Number.isInteger(position) || position < 1 || position > list.length) {
      return {
        list: null,
        result: `error: delete position ${args.position ?? '(missing)'} out of range. Valid: 1..${list.length}. ${capNoun} unchanged.`,
      }
    }
    const next = [...list.slice(0, position - 1), ...list.slice(position)]
    return {
      list: next,
      result: `ok — deleted entry ${position}. ${capNoun} now has ${next.length} entr${next.length === 1 ? 'y' : 'ies'}.`,
    }
  } catch (err) {
    return { list: null, result: `error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export function executeTool(
  name: string,
  rawArgs: string,
  data: StoryData,
): ToolExecResult {
  const { state, plot, memory, ooc } = data
  // Most outcomes leave the data untouched (validation errors, unknown
  // tools). `unchanged` returns the same StoryData reference, so callers can
  // rely on identity to detect no-ops.
  const unchanged = (result: string): ToolExecResult => ({ data, result })
  if (name === 'update_state') {
    try {
      const args = JSON.parse(rawArgs) as {
        keep?: unknown
        set?: Record<string, JsonValue>
      }
      if (!Array.isArray(args.keep)) {
        return unchanged(
          'error: update_state requires `keep` (array of dotted paths to carry forward from the current state — empty array `[]` is valid). Previous state unchanged.',
        )
      }
      if (!args.set || typeof args.set !== 'object' || Array.isArray(args.set)) {
        return unchanged(
          'error: update_state requires `set` (map of dotted-path → value to assign on top of kept paths — empty object `{}` is valid). Previous state unchanged.',
        )
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
        return unchanged(
          `error: unsafe state path${unsafePaths.length === 1 ? '' : 's'} rejected: ${unsafePaths.join(', ')}. Previous state unchanged.`,
        )
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
        data: { state: nextState, plot, memory, ooc },
        result: `ok — ${summary}${notes}. Anything not in \`keep\` and not in \`set\` has been dropped.`,
      }
    } catch (err) {
      return unchanged(`error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (name === 'update_memory') {
    try {
      const args = JSON.parse(rawArgs) as {
        set?: Record<string, unknown>
        delete?: unknown
        move?: Record<string, unknown>
      }
      const moveEntries =
        args.move && typeof args.move === 'object' && !Array.isArray(args.move)
          ? Object.entries(args.move)
          : []
      const deletePaths = Array.isArray(args.delete)
        ? args.delete.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : []
      const setEntries =
        args.set && typeof args.set === 'object' && !Array.isArray(args.set)
          ? Object.entries(args.set)
          : []
      if (!moveEntries.length && !deletePaths.length && !setEntries.length) {
        return unchanged(
          'error: update_memory requires a non-empty `set`, `delete`, or `move`.',
        )
      }
      const notes: string[] = []
      let failed = false
      let next: Memory = memory

      // Paths are `slug` or `slug.facet` — two levels, nothing deeper.
      const parsePath = (path: string): { slug: string; facet?: string } | null => {
        const segments = path.split('.')
        if (segments.length < 1 || segments.length > 2) return null
        if (segments.some((s) => !s || !isSafeStatePath(s))) return null
        return { slug: segments[0], facet: segments[1] }
      }
      const dropSlug = (m: Memory, slug: string): Memory => {
        const copy = { ...m }
        delete copy[slug]
        return copy
      }
      const setFacet = (m: Memory, slug: string, facet: string, value: string): Memory => ({
        ...m,
        [slug]: { ...(m[slug] ?? {}), [facet]: value },
      })
      const validateFacetValue = (path: string, value: unknown): string | null => {
        if (typeof value !== 'string' || !value.trim()) {
          notes.push(`REJECTED set ${path}: facet values must be non-empty strings. Unchanged.`)
          failed = true
          return null
        }
        if (value.length > MAX_MEMORY_FACET_CHARS) {
          notes.push(
            `REJECTED set ${path}: facet too long (${value.length} chars, max ${MAX_MEMORY_FACET_CHARS}). Rewrite tighter — state the present truth, not the story. Unchanged.`,
          )
          failed = true
          return null
        }
        return value
      }

      // Moves first: rename entities or relocate facets.
      for (const [fromRaw, toRaw] of moveEntries) {
        if (typeof toRaw !== 'string') {
          notes.push(`REJECTED move ${fromRaw}: target must be a path string.`)
          failed = true
          continue
        }
        const from = parsePath(fromRaw)
        const to = parsePath(toRaw)
        if (!from || !to) {
          notes.push(`REJECTED move ${fromRaw} → ${toRaw}: paths must be \`slug\` or \`slug.facet\`.`)
          failed = true
          continue
        }
        if (Boolean(from.facet) !== Boolean(to.facet)) {
          notes.push(`REJECTED move ${fromRaw} → ${toRaw}: cannot move between a whole entry and a facet.`)
          failed = true
          continue
        }
        if (from.facet && to.facet) {
          const value = next[from.slug]?.[from.facet]
          if (value === undefined) {
            notes.push(`move ${fromRaw} (no-op; not present)`)
            continue
          }
          if (next[to.slug]?.[to.facet] !== undefined) {
            notes.push(`REJECTED move ${fromRaw} → ${toRaw}: target facet already exists. Delete it first or set it directly.`)
            failed = true
            continue
          }
          const fromEntry = { ...next[from.slug] }
          delete fromEntry[from.facet]
          next = Object.keys(fromEntry).length
            ? { ...next, [from.slug]: fromEntry }
            : dropSlug(next, from.slug)
          next = setFacet(next, to.slug, to.facet, value)
          notes.push(`moved ${fromRaw} → ${toRaw}`)
        } else {
          const entry = next[from.slug]
          if (entry === undefined) {
            notes.push(`move ${fromRaw} (no-op; not present)`)
            continue
          }
          if (next[to.slug] !== undefined) {
            notes.push(`REJECTED move ${from.slug} → ${to.slug}: slug ${to.slug} already exists — merge or delete it explicitly first.`)
            failed = true
            continue
          }
          next = dropSlug(next, from.slug)
          next = { ...next, [to.slug]: entry }
          notes.push(`renamed ${from.slug} → ${to.slug}`)
        }
      }

      // Deletes: facets that stopped being true, or whole entries.
      for (const raw of deletePaths) {
        const p = parsePath(raw)
        if (!p) {
          notes.push(`REJECTED delete ${raw}: paths must be \`slug\` or \`slug.facet\`.`)
          failed = true
          continue
        }
        if (p.facet) {
          if (next[p.slug]?.[p.facet] === undefined) {
            notes.push(`deleted ${raw} (no-op; not present)`)
            continue
          }
          const entry = { ...next[p.slug] }
          delete entry[p.facet]
          if (Object.keys(entry).length === 0) {
            next = dropSlug(next, p.slug)
            notes.push(`deleted ${raw} (entry now empty — removed)`)
          } else {
            next = { ...next, [p.slug]: entry }
            notes.push(`deleted ${raw}`)
          }
        } else if (next[p.slug] === undefined) {
          notes.push(`deleted ${p.slug} (no-op; not present)`)
        } else {
          next = dropSlug(next, p.slug)
          notes.push(`deleted ${p.slug}`)
        }
      }

      // Sets last: surgical facet writes, or whole-entry replacement.
      for (const [raw, value] of setEntries) {
        const p = parsePath(raw)
        if (!p) {
          notes.push(`REJECTED set ${raw}: paths must be \`slug\` or \`slug.facet\`.`)
          failed = true
          continue
        }
        if (p.facet) {
          const validated = validateFacetValue(raw, value)
          if (validated === null) continue
          const entry = next[p.slug]
          if (
            entry &&
            entry[p.facet] === undefined &&
            Object.keys(entry).length >= MAX_MEMORY_FACETS
          ) {
            notes.push(
              `REJECTED set ${raw}: entry already has ${MAX_MEMORY_FACETS} facets. Delete or condense one first.`,
            )
            failed = true
            continue
          }
          next = setFacet(next, p.slug, p.facet, validated)
          notes.push(`set ${raw}`)
        } else {
          // Whole entry: an object of string facets, or a bare string coerced
          // to { is: value } for convenience.
          const entryObj =
            typeof value === 'string'
              ? { is: value }
              : value && typeof value === 'object' && !Array.isArray(value)
                ? (value as Record<string, unknown>)
                : null
          if (!entryObj) {
            notes.push(
              `REJECTED set ${p.slug}: an entry must be an object of string facets (or a single string for \`is\`). Unchanged.`,
            )
            failed = true
            continue
          }
          const facets = Object.entries(entryObj)
          if (!facets.length || facets.length > MAX_MEMORY_FACETS) {
            notes.push(
              `REJECTED set ${p.slug}: entries need 1-${MAX_MEMORY_FACETS} facets (got ${facets.length}). Unchanged.`,
            )
            failed = true
            continue
          }
          let ok = true
          const validated: MemoryEntry = {}
          for (const [facet, facetValue] of facets) {
            if (!facet || facet.includes('.') || !isSafeStatePath(facet)) {
              notes.push(`REJECTED set ${p.slug}: bad facet name "${facet}". Unchanged.`)
              failed = true
              ok = false
              break
            }
            const v = validateFacetValue(`${p.slug}.${facet}`, facetValue)
            if (v === null) {
              ok = false
              break
            }
            validated[facet] = v
          }
          if (!ok) continue
          next = { ...next, [p.slug]: validated }
          notes.push(`set ${p.slug} (${facets.length} facet${facets.length === 1 ? '' : 's'})`)
        }
      }

      const result = `${failed ? 'partial' : 'ok'} — memory: ${notes.join('; ')}`
      return { data: { state, plot, memory: next, ooc }, result }
    } catch (err) {
      return unchanged(`error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (name === 'future_plot_plan') {
    const edit = executeListEdit(rawArgs, plot, {
      toolName: 'future_plot_plan',
      noun: 'plan',
      capAdvice: 'Delete a past-event or stale entry instead.',
      maxItems: MAX_PLOT_ITEMS,
      maxItemChars: MAX_PLOT_ITEM_CHARS,
    })
    return edit.list
      ? { data: { state, plot: edit.list, memory, ooc }, result: edit.result }
      : unchanged(edit.result)
  }
  if (name === 'update_ooc') {
    const edit = executeListEdit(rawArgs, ooc, {
      toolName: 'update_ooc',
      noun: 'OOC list',
      capAdvice: 'Delete a completed or stale entry instead.',
      maxItems: MAX_OOC_ITEMS,
      maxItemChars: MAX_OOC_ITEM_CHARS,
    })
    return edit.list
      ? { data: { state, plot, memory, ooc: edit.list }, result: edit.result }
      : unchanged(edit.result)
  }
  return unchanged(`error: unknown tool ${name}`)
}

export function executeEnabledTool(
  enabledNames: ReadonlySet<string>,
  name: string,
  rawArgs: string,
  data: StoryData,
): ToolExecResult {
  if (!enabledNames.has(name)) {
    return { data, result: `error: tool ${name} is disabled` }
  }
  return executeTool(name, rawArgs, data)
}
