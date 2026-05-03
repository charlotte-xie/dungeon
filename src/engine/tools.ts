// Tool schemas advertised to the model + executor for tool calls + a fallback
// parser for inline <function_call> XML the model sometimes emits as prose.

import { buildMemoryRules, buildPlotRules } from '../prompts'
import { MAX_STATE_STRING_CHARS, deleteByPath, findOverLongString, setByPath } from './state'
import type { InlineToolCall, JsonValue, Memory, WorldState } from './types'

export const MAX_PLOT_ITEMS = 10
export const MAX_PLOT_ITEM_CHARS = 300

export const PLOT_RULES = buildPlotRules(MAX_PLOT_ITEMS, MAX_PLOT_ITEM_CHARS)

export const MEMORY_RULES = buildMemoryRules(MAX_STATE_STRING_CHARS)

export const UPDATE_STATE_TOOL = {
  type: 'function',
  function: {
    name: 'update_state',
    description:
      `Make updates to the world state JSON. Provide \`set\` (a map of dotted-path → value to assign), \`delete\` (an array of dotted paths to remove), or both. Deletes apply first, then sets — so a path that appears in both ends up with the set value. Intermediate objects on a set path are auto-created. ` +
      `STRING VALUES must be complete English phrases or short clauses with all articles, prepositions, and verbs in place — NOT telegraphic fragments, NOT single keywords, NOT label-shorthand. ` +
      `RIGHT: "standing at the edge of the dock", "wary of the player and unwilling to speak openly", "a heavy iron seal in his coat pocket". ` +
      `Compactness comes from picking the right level of detail and splitting long facts across multiple keys, not from dropping grammar. ` +
      `Example call: {set:{"scene.location":"on the abbey steps after sundown","npcs.jack.attitude":"resentful but cooperative for now","player.status.injury":"a shallow cut on the left forearm, bleeding lightly"}, delete:["npcs.oldGuard","topics.resolved"]}. ` +
      `HARD LIMIT: any individual string value (including nested strings) must be <= ${MAX_STATE_STRING_CHARS} characters; an over-long value is rejected and the existing value at that path is left unchanged. Split long descriptions into multiple short keys, each a complete phrase.`,
    parameters: {
      type: 'object',
      properties: {
        set: {
          type: 'object',
          description: `Map of dotted paths to values to assign. Any JSON value type. String values must be <= ${MAX_STATE_STRING_CHARS} chars (including nested strings).`,
          additionalProperties: true,
        },
        delete: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of dotted paths to remove. Applied first.',
        },
      },
    },
  },
}

export const FUTURE_PLOT_PLAN_TOOL = {
  type: 'function',
  function: {
    name: 'future_plot_plan',
    description:
      `Edit the numbered FUTURE plot plan — your private DM notebook of what the story is aiming AT, not what has already happened. Every entry must describe an upcoming pressure, revelation, NPC move, or unresolved hook. As soon as something is delivered to the player, DELETE that entry — past events do not belong here (the chronicle records them). Exactly one operation per call via \`op\`. Positions are 1-indexed and refer to the list as it appears in the system message. ` +
      `OPERATIONS: ` +
      `\`append\` adds a new future entry at the end (\`text\` required); ` +
      `\`insert\` inserts a new future entry before \`position\`; ` +
      `\`update\` rewrites the entry at \`position\` (use this when an aim has shifted but the thread is still ahead of the player); ` +
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
      `Update long-term memory — your canonical record of NPCs, locations, plot themes, and key past events that should persist across scenes. Provide \`set\` (a map of dotted-path → value to assign), \`delete\` (an array of dotted paths to remove), or both. Deletes apply first, then sets — so a path that appears in both ends up with the set value. Intermediate objects on a set path are auto-created. ` +
      `STRUCTURE: top-level keys are entity names; their values are JSON objects of fields. Examples: \`"Lady Veyra"\` → \`{title, disposition, secret, ...}\`; \`"the Abbey"\` → \`{location, layout, mood, ...}\`; \`"the betrayal at Greyford"\` → \`{when, who, what, consequences, ...}\`. ` +
      `WHEN TO USE: use \`update_memory\` IN PREFERENCE TO \`update_state\` for anything that should be remembered beyond the current scene — recurring NPCs, named places, plot themes, secrets, important past events. Use \`update_state\` only for the live current scene (current location, what the player is doing right now, immediate sensory details). ` +
      `WHEN TO DELETE: only when an entity is genuinely no longer relevant to the story (a one-off NPC who has fully left the narrative, a location that's been abandoned permanently, a plot theme that's been resolved and won't return). Do NOT delete on scene change — memory persists. ` +
      `STRING VALUES must be complete English phrases (e.g. "spymaster of the Crimson Court, openly hostile to the player after the dock confrontation"), NOT telegraphic fragments. ` +
      `HARD LIMIT: any individual string value must be <= ${MAX_STATE_STRING_CHARS} characters; an over-long value is rejected and the existing value at that path is left unchanged. Split long descriptions across multiple keyed fields.`,
    parameters: {
      type: 'object',
      properties: {
        set: {
          type: 'object',
          description: `Map of dotted paths to values. Top-level key should be an entity name; the second component should be a field on that entity (e.g. "Lady Veyra.disposition"). String values must be complete phrases, <= ${MAX_STATE_STRING_CHARS} chars (including nested strings).`,
          additionalProperties: true,
        },
        delete: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Dotted paths to remove. Whole entries (e.g. "Old Mill") or single fields (e.g. "Lady Veyra.disguise"). Applied before sets. Only delete when the target is genuinely no longer relevant to the story.',
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
  if (name === 'update_state' || name === 'update_memory') {
    const isMemory = name === 'update_memory'
    const target = isMemory ? memory : state
    const label = isMemory ? 'memory' : 'state'
    try {
      const args = JSON.parse(rawArgs) as {
        set?: Record<string, JsonValue>
        delete?: string[]
      }
      const setEntries: [string, JsonValue][] =
        args.set && typeof args.set === 'object' && !Array.isArray(args.set)
          ? Object.entries(args.set).filter(
              (e): e is [string, JsonValue] => typeof e[0] === 'string' && e[0].length > 0,
            )
          : []
      const deletePaths = Array.isArray(args.delete)
        ? args.delete.filter((p): p is string => typeof p === 'string' && p.length > 0)
        : []
      if (setEntries.length === 0 && deletePaths.length === 0) {
        return {
          state,
          plot,
          memory,
          result: `error: ${name} requires a non-empty \`set\` map, a non-empty \`delete\` array, or both.`,
        }
      }
      const notes: string[] = []
      let failed = false
      let nextTarget: WorldState | Memory = target
      for (const p of deletePaths) {
        nextTarget = deleteByPath(nextTarget, p)
        notes.push(`deleted ${p}`)
      }
      for (const [path, value] of setEntries) {
        if (isMemory) {
          const segments = path.split('.').filter(Boolean)
          if (segments.length === 1) {
            const isObject =
              value !== null && typeof value === 'object' && !Array.isArray(value)
            if (!isObject) {
              const got = Array.isArray(value)
                ? 'array'
                : value === null
                  ? 'null'
                  : typeof value
              notes.push(
                `REJECTED set ${path}: top-level memory entries must be objects with a \`kind\` field (e.g. {"kind":"npc","name":"...","wants":"..."}). Got ${got}. Existing value unchanged.`,
              )
              failed = true
              continue
            }
          }
        }
        const overLong = findOverLongString(value, MAX_STATE_STRING_CHARS)
        if (overLong !== null) {
          notes.push(
            `REJECTED set ${path}: string value too long (${overLong} chars, max ${MAX_STATE_STRING_CHARS}). Existing value unchanged. Rewrite shorter.`,
          )
          failed = true
        } else {
          nextTarget = setByPath(nextTarget, path, value)
          notes.push(`set ${path}`)
        }
      }
      const result = `${failed ? 'partial' : 'ok'} — ${label}: ${notes.join('; ')}`
      return isMemory
        ? { state, plot, memory: nextTarget, result }
        : { state: nextTarget, plot, memory, result }
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
