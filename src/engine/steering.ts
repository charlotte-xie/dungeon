// Rewrite guidance travels with the player's input, so retry, undo and
// cancel preserve its scope along with the action. Labelled as a rewrite
// request, it reads as direction for that reply, not a standing OOC
// directive. Turns saved before carry the older NEXT REPLY ONLY label.
const REWRITE_REQUESTED = '(OOC: Rewrite requested: '
const GUIDANCE_LABELS = [REWRITE_REQUESTED, '(OOC: NEXT REPLY ONLY — ']

function rewriteRequested(text: string): string {
  return `${REWRITE_REQUESTED}${text})`
}

// Input holding only out-of-character direction, in (parentheses) or
// [brackets]: the player gave direction but made no move of their own.
export function isOutOfCharacterOnly(input: string): boolean {
  let rest = input
  for (let before = ''; before !== rest; ) {
    before = rest
    rest = rest.replace(/\([^()]*\)|\[[^[\]]*\]/g, '')
  }
  return input.trim() !== '' && !/[\p{L}\p{N}]/u.test(rest)
}

// Rewrite: attach one-reply guidance to the input being retried. It replaces
// one-reply guidance already ending that input, since the player is
// re-steering the same reply; anything else in the input is kept.
export function withRetryGuidance(input: string, guidance: string): string {
  const text = guidance.trim()
  if (!text) return input
  return [withoutTrailingGuidance(input), rewriteRequested(text)].filter(Boolean).join('\n\n')
}

function withoutTrailingGuidance(input: string): string {
  const trimmed = input.trim()
  const at = Math.max(...GUIDANCE_LABELS.map((label) => trimmed.lastIndexOf(label)))
  if (at < 0 || !trimmed.endsWith(')')) return trimmed
  if (at > 0 && !trimmed.slice(0, at).endsWith('\n\n')) return trimmed
  return trimmed.slice(0, at).trim()
}

// The standing OOC instructions a new adventure starts with, from the
// settings' text: one per line.
export function oocListFromText(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean)
}

// Retry, Undo and Redo restore the OOC list and the arcs saved with a turn
// checkpoint, which rolls back the plotter's edits from that turn. Player
// edits made since the engine last set the list (`baseline`) are carried
// across: entries the player removed stay removed, and entries they added or
// rewrote are kept.
export function carryPlayerEdits(target: string[], baseline: string[], current: string[]): string[] {
  const removed = baseline.filter((entry) => !current.includes(entry))
  const added = current.filter((entry) => !baseline.includes(entry))
  const next = target.filter((entry) => !removed.includes(entry))
  for (const entry of added) {
    if (!next.includes(entry)) next.push(entry)
  }
  return next
}
