// One-reply guidance travels with the player's input, so retry, undo and
// cancel preserve its scope along with the action. The NEXT REPLY ONLY label
// keeps the plotter from recording it as a standing OOC directive.
const NEXT_REPLY_ONLY = '(OOC: NEXT REPLY ONLY — '

function nextReplyOnly(text: string): string {
  return `${NEXT_REPLY_ONLY}${text})`
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
