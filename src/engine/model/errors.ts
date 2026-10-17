// Model client errors read `<label> API <status>: <first 200 chars of body>`.
// Notices show the provider's own message instead, keeping the raw error for
// a details view.

const API_ERROR = /^\S+ API (\d{3}): ([\s\S]*)$/

export function describeModelError(raw: string): string {
  const match = API_ERROR.exec(raw.trim())
  if (!match) return raw
  const [, status, body] = match
  const message = providerMessage(body.trim())
  return message ? `${message} (HTTP ${status})` : raw
}

function providerMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>
    const candidates = [
      (parsed.error as Record<string, unknown> | undefined)?.message,
      parsed.message,
      (Array.isArray(parsed.detail) ? (parsed.detail[0] as Record<string, unknown> | undefined) : undefined)?.msg,
      parsed.error,
      parsed.detail,
    ]
    const found = candidates.find((value): value is string => typeof value === 'string' && value.trim() !== '')
    if (found) return found.trim()
  } catch {
    // The body is truncated or not JSON.
  }
  // A message cut off by the 200-character limit has no closing quote.
  const quoted = /"(?:message|msg)"\s*:\s*"((?:[^"\\]|\\.)*)("?)/.exec(body)
  if (quoted) {
    const text = quoted[1].replace(/\\(.)/g, '$1').trim()
    if (text) return quoted[2] ? text : `${text}…`
  }
  return body && !body.startsWith('{') && !body.startsWith('[') ? body : null
}
