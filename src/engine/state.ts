// World-state primitives: immutable path ops.

import { buildStateRules } from '../prompts'
import type { JsonValue, WorldState } from './types'

export const STATE_RULES = buildStateRules()

export function setByPath(state: WorldState, path: string, value: JsonValue): WorldState {
  const keys = path.split('.').filter(Boolean)
  if (keys.length === 0) return state
  const next: WorldState = structuredClone(state)
  let obj: { [key: string]: JsonValue } = next
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    const existing = obj[k]
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
      obj[k] = {}
    }
    obj = obj[k] as { [key: string]: JsonValue }
  }
  obj[keys[keys.length - 1]] = value
  return next
}

export function deleteByPath(state: WorldState, path: string): WorldState {
  const keys = path.split('.').filter(Boolean)
  if (keys.length === 0) return state
  const next: WorldState = structuredClone(state)
  let obj: { [key: string]: JsonValue } = next
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]
    const existing = obj[k]
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
      return state
    }
    obj = existing as { [key: string]: JsonValue }
  }
  delete obj[keys[keys.length - 1]]
  return next
}

// Returns the value at `path` in `state`, or undefined if the path does not
// exist. Used by the keep-list semantics: each kept path's current value is
// copied forward into the next turn's state.
export function getByPath(state: WorldState, path: string): JsonValue | undefined {
  const keys = path.split('.').filter(Boolean)
  if (keys.length === 0) return undefined
  let cur: JsonValue = state
  for (const k of keys) {
    if (cur === null || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as { [key: string]: JsonValue })[k]
    if (cur === undefined) return undefined
  }
  return cur
}

