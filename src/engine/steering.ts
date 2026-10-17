import { MAX_OOC_ITEMS, MAX_OOC_ITEM_CHARS } from './tools'

export type SteeringScope = 'once' | 'standing'

// Standing preferences are saved directly rather than relying on a model to
// remember them. One-turn guidance travels with the player's input so existing
// retry/undo/cancel behaviour preserves its scope along with the action.
export function prepareSteering(
  input: string,
  guidance: string,
  scope: SteeringScope,
  preferences: string[],
): { input: string; preferences: string[] } {
  const next = preferences.map((entry) => entry.trim()).filter(Boolean)
  const text = guidance.trim()
  if (scope === 'standing' && text && !next.includes(text)) next.push(text)
  if (next.length > MAX_OOC_ITEMS) {
    throw new Error(`Keep at most ${MAX_OOC_ITEMS} standing preferences. Edit or remove one first.`)
  }
  if (next.some((entry) => entry.length > MAX_OOC_ITEM_CHARS)) {
    throw new Error(`Keep each standing preference within ${MAX_OOC_ITEM_CHARS} characters.`)
  }
  return {
    input: scope === 'once' && text
      ? [input.trim(), `(OOC: NEXT REPLY ONLY — ${text})`].filter(Boolean).join('\n\n')
      : input,
    preferences: next,
  }
}
