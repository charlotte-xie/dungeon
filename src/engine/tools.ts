// Tool schemas advertised to the model + executor for tool calls + a fallback
// parser for inline <function_call> XML the model sometimes emits as prose.

import { buildPlotRules } from '../prompts'
import { MAX_STATE_STRING_CHARS, deleteByPath, findOverLongString, setByPath } from './state'
import type { InlineToolCall, JsonValue, WorldState } from './types'

export const MAX_PLOT_ITEMS = 10
export const MAX_PLOT_ITEM_CHARS = 200

export const PLOT_RULES = buildPlotRules(MAX_PLOT_ITEMS, MAX_PLOT_ITEM_CHARS)

export const UPDATE_STATE_TOOL = {
  type: 'function',
  function: {
    name: 'update_state',
    description:
      `Update the world state JSON in one batched call. Provide \`set\` (a map of dotted-path → value to assign), \`delete\` (an array of dotted paths to remove), or both. Deletes apply first, then sets — so a path that appears in both ends up with the set value. Intermediate objects on a set path are auto-created. ` +
      `STRING VALUES must be complete English phrases or short clauses with all articles, prepositions, and verbs in place — NOT telegraphic fragments, NOT single keywords, NOT label-shorthand. ` +
      `RIGHT: "standing at the edge of the dock", "wary of the player and unwilling to speak openly", "a heavy iron seal in his coat pocket". ` +
      `WRONG: "dock. edge.", "wary, silent", "iron seal: pocket". ` +
      `Compactness comes from picking the right level of detail and splitting long facts across multiple keys, not from dropping grammar. ` +
      `Example call: {set:{"scene.location":"on the abbey steps after sundown","npcs.jack.attitude":"resentful but cooperative for now","player.status.injury":"a shallow cut on the left forearm, bleeding lightly"}, delete:["npcs.oldGuard","topics.resolved"]}. ` +
      `HARD LIMIT: any individual string value (including nested strings) must be <= ${MAX_STATE_STRING_CHARS} characters; an over-long value is rejected and the existing value at that path is left unchanged. Split long descriptions into multiple short keys, each a complete phrase.`,
    parameters: {
      type: 'object',
      properties: {
        set: {
          type: 'object',
          description: `Map of dotted paths to values to assign. String values must be complete English phrases (e.g. "standing on the dock", "resentful but cooperative for now"), NOT telegraphic fragments ("dock", "resentful"). Any JSON value type. String values must be <= ${MAX_STATE_STRING_CHARS} chars (including nested strings).`,
          additionalProperties: true,
        },
        delete: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of dotted paths to remove. Applied before sets.',
        },
      },
    },
  },
}

export const PLOT_UPDATE_TOOL = {
  type: 'function',
  function: {
    name: 'plot_update',
    description:
      `Replace the full plot outline. Pass the new list; it overwrites the old entirely. Pass [] to clear. Max ${MAX_PLOT_ITEMS} bullets, each <= ${MAX_PLOT_ITEM_CHARS} chars. A bullet over the char limit or a list over the item limit rejects the whole call and leaves the existing outline unchanged.`,
    parameters: {
      type: 'object',
      properties: {
        plot: {
          type: 'array',
          items: { type: 'string' },
          description: `New full plot list. Each bullet <= ${MAX_PLOT_ITEM_CHARS} chars; at most ${MAX_PLOT_ITEMS} items. Empty array clears the outline.`,
        },
      },
      required: ['plot'],
    },
  },
}

export interface ToolExecResult {
  state: WorldState
  plot: string[]
  result: string
}

export function executeTool(
  name: string,
  rawArgs: string,
  state: WorldState,
  plot: string[],
): ToolExecResult {
  if (name === 'update_state') {
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
          result:
            'error: update_state requires a non-empty `set` map, a non-empty `delete` array, or both.',
        }
      }
      const notes: string[] = []
      let failed = false
      let nextState = state
      for (const p of deletePaths) {
        nextState = deleteByPath(nextState, p)
        notes.push(`deleted ${p}`)
      }
      for (const [path, value] of setEntries) {
        const overLong = findOverLongString(value, MAX_STATE_STRING_CHARS)
        if (overLong !== null) {
          notes.push(
            `REJECTED set ${path}: string value too long (${overLong} chars, max ${MAX_STATE_STRING_CHARS}). Existing value unchanged. Rewrite shorter.`,
          )
          failed = true
        } else {
          nextState = setByPath(nextState, path, value)
          notes.push(`set ${path}`)
        }
      }
      return { state: nextState, plot, result: `${failed ? 'partial' : 'ok'} — ${notes.join('; ')}` }
    } catch (err) {
      return { state, plot, result: `error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  if (name === 'plot_update') {
    try {
      const args = JSON.parse(rawArgs) as { plot?: unknown }
      if (!Array.isArray(args.plot)) {
        return {
          state,
          plot,
          result: 'error: plot_update requires `plot` as an array of strings. Existing outline unchanged.',
        }
      }
      if (args.plot.some((p) => typeof p !== 'string')) {
        return {
          state,
          plot,
          result: 'error: every plot bullet must be a string. Existing outline unchanged.',
        }
      }
      if (args.plot.length > MAX_PLOT_ITEMS) {
        return {
          state,
          plot,
          result: `error: plot has ${args.plot.length} items (max ${MAX_PLOT_ITEMS}). Trim the list and retry. Existing outline unchanged.`,
        }
      }
      const cleaned = (args.plot as string[]).map((s) => s.trim()).filter((s) => s.length > 0)
      const tooLong = cleaned.find((s) => s.length > MAX_PLOT_ITEM_CHARS)
      if (tooLong) {
        return {
          state,
          plot,
          result: `error: plot bullet too long (${tooLong.length} chars, max ${MAX_PLOT_ITEM_CHARS}). Rewrite shorter. Existing outline unchanged.`,
        }
      }
      return {
        state,
        plot: cleaned,
        result: `ok — plot outline now has ${cleaned.length} bullet${cleaned.length === 1 ? '' : 's'}.`,
      }
    } catch (err) {
      return { state, plot, result: `error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  return { state, plot, result: `error: unknown tool ${name}` }
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
