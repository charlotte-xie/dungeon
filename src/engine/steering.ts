import { MAX_OOC_ITEMS, MAX_OOC_ITEM_CHARS } from './tools'

export type SteeringScope = 'once' | 'standing'

const NEXT_REPLY_ONLY = '(OOC: NEXT REPLY ONLY — '

function nextReplyOnly(text: string): string {
  return `${NEXT_REPLY_ONLY}${text})`
}

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
      ? [input.trim(), nextReplyOnly(text)].filter(Boolean).join('\n\n')
      : input,
    preferences: next,
  }
}

// Retry with guidance: attach one-reply guidance to the input being retried.
// It replaces one-reply guidance already ending that input, since the player
// is re-steering the same reply; anything else in the input is kept.
export function withRetryGuidance(input: string, guidance: string): string {
  const text = guidance.trim()
  if (!text) return input
  return [withoutTrailingGuidance(input), nextReplyOnly(text)].filter(Boolean).join('\n\n')
}

function withoutTrailingGuidance(input: string): string {
  const trimmed = input.trim()
  const at = trimmed.lastIndexOf(NEXT_REPLY_ONLY)
  if (at < 0 || !trimmed.endsWith(')')) return trimmed
  if (at > 0 && !trimmed.slice(0, at).endsWith('\n\n')) return trimmed
  return trimmed.slice(0, at).trim()
}

// Retry, Undo and Redo restore the OOC list saved with a turn checkpoint,
// which rolls back the plotter's edits from that turn. Player edits made since
// the engine last set the list (`baseline`) are carried across: entries the
// player removed stay removed, and entries they added are kept.
export function carryOocEdits(target: string[], baseline: string[], current: string[]): string[] {
  const removed = baseline.filter((entry) => !current.includes(entry))
  const added = current.filter((entry) => !baseline.includes(entry))
  const next = target.filter((entry) => !removed.includes(entry))
  for (const entry of added) {
    if (!next.includes(entry)) next.push(entry)
  }
  return next
}
