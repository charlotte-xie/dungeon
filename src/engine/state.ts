// World-state primitives: defaults, value-size limits, immutable path ops.

import { buildStateRules } from '../prompts'
import type { JsonValue, WorldState } from './types'

export const MAX_STATE_STRING_CHARS = 200

export const STATE_RULES = buildStateRules(MAX_STATE_STRING_CHARS)

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

export function findOverLongString(value: JsonValue, limit: number): number | null {
  if (typeof value === 'string') {
    return value.length > limit ? value.length : null
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const found = findOverLongString(v, limit)
      if (found !== null) return found
    }
    return null
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) {
      const found = findOverLongString(v, limit)
      if (found !== null) return found
    }
  }
  return null
}
