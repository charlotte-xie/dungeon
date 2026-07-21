// Pure normalization for OpenAI-compatible Chat Completions responses.
// Provider quirks are quarantined here so game orchestration never parses
// wire payloads or model-specific text protocols.

import type {
  ModelCompletion,
  ModelToolCall,
  ProtocolAnomaly,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function makeRecoveredCallId(): string {
  return `recovered-${crypto.randomUUID()}`
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part)) return ''
      if (typeof part.text === 'string') return part.text
      if (typeof part.content === 'string') return part.content
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function argumentsToString(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (isRecord(value) || Array.isArray(value)) return JSON.stringify(value)
  return null
}

function canonicalArguments(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value))
  } catch {
    return value.trim()
  }
}

function callFingerprint(call: Pick<ModelToolCall, 'name' | 'arguments'>): string {
  return `${call.name}\u0000${canonicalArguments(call.arguments)}`
}

function nativeToolCalls(message: Record<string, unknown>): ModelToolCall[] {
  if (!Array.isArray(message.tool_calls)) return []
  const calls: ModelToolCall[] = []
  for (const raw of message.tool_calls) {
    if (!isRecord(raw) || !isRecord(raw.function)) continue
    const name = raw.function.name
    const args = argumentsToString(raw.function.arguments)
    if (typeof name !== 'string' || args === null) continue
    calls.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : makeRecoveredCallId(),
      name,
      arguments: args,
    })
  }
  return calls
}

interface JsonSpan {
  start: number
  end: number
  text: string
}

// Find complete top-level JSON objects/arrays embedded in otherwise free-form
// text. Candidates are parsed and removed only when they have a recognized
// tool-envelope shape, so ordinary prose and JSON remain untouched.
function findJsonSpans(text: string): JsonSpan[] {
  const spans: JsonSpan[] = []
  for (let start = 0; start < text.length; start++) {
    const opener = text[start]
    if (opener !== '{' && opener !== '[') continue
    const stack: string[] = [opener]
    let inString = false
    let escaped = false
    for (let i = start + 1; i < text.length; i++) {
      const char = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') {
        inString = true
        continue
      }
      if (char === '{' || char === '[') stack.push(char)
      else if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '['
        if (stack[stack.length - 1] !== expected) break
        stack.pop()
        if (stack.length === 0) {
          spans.push({ start, end: i + 1, text: text.slice(start, i + 1) })
          start = i
          break
        }
      }
    }
  }
  return spans
}

interface EnvelopeResult {
  calls: ModelToolCall[]
  toolLikeNames: string[]
}

function callsFromEnvelope(value: unknown, allowedNames: ReadonlySet<string>): EnvelopeResult {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.tool_calls)
      ? value.tool_calls
      : [value]
  const calls: ModelToolCall[] = []
  const toolLikeNames: string[] = []
  for (const candidate of candidates) {
    if (!isRecord(candidate) || typeof candidate.name !== 'string') continue
    const hasArguments = Object.hasOwn(candidate, 'parameters') || Object.hasOwn(candidate, 'arguments')
    if (!hasArguments) continue
    const name = candidate.name
    toolLikeNames.push(name)
    if (!allowedNames.has(name)) continue
    const args = argumentsToString(
      Object.hasOwn(candidate, 'parameters') ? candidate.parameters : candidate.arguments,
    )
    if (args === null) continue
    calls.push({ id: makeRecoveredCallId(), name, arguments: args })
  }
  return { calls, toolLikeNames }
}

function parseEnvelopeText(text: string, allowedNames: ReadonlySet<string>): EnvelopeResult | null {
  try {
    const parsed = JSON.parse(text.trim()) as unknown
    const result = callsFromEnvelope(parsed, allowedNames)
    return result.toolLikeNames.length ? result : null
  } catch {
    return null
  }
}

function stripReasoningMarkers(
  content: string,
  reasoning: string[],
  anomalies: ProtocolAnomaly[],
): string {
  let cleaned = content
  const capture = (_match: string, body: string) => {
    const text = body.trim()
    if (text) reasoning.push(text)
    anomalies.push({
      kind: 'reasoning_in_content',
      detail: 'Recovered reasoning text that was embedded in message content.',
    })
    return ''
  }
  cleaned = cleaned.replace(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi, capture)
  cleaned = cleaned.replace(
    /<!--\s*thinking\s*-->([\s\S]*?)<!--\s*(?:\/thinking|end\s+thinking)\s*-->/gi,
    capture,
  )
  const markerPattern = /<!--\s*(?:\/?thinking|end\s+thinking)\s*-->/gi
  if (markerPattern.test(cleaned)) {
    anomalies.push({
      kind: 'reasoning_in_content',
      detail: 'Removed an unpaired thinking marker from message content.',
    })
    cleaned = cleaned.replace(markerPattern, '')
  }
  return cleaned.replace(/```(?:html)?\s*```/gi, '')
}

function recoverTextToolCalls(
  content: string,
  allowedNames: ReadonlySet<string>,
  existingFingerprints: Set<string>,
  anomalies: ProtocolAnomaly[],
): { cleaned: string; calls: ModelToolCall[] } {
  const calls: ModelToolCall[] = []
  const accept = (result: EnvelopeResult): boolean => {
    for (const name of result.toolLikeNames) {
      if (!allowedNames.has(name)) {
        anomalies.push({
          kind: 'unadvertised_tool_call',
          detail: `Quarantined text-form call to unadvertised tool ${name}.`,
        })
      }
    }
    for (const call of result.calls) {
      const fingerprint = callFingerprint(call)
      if (existingFingerprints.has(fingerprint)) {
        anomalies.push({
          kind: 'duplicate_tool_call',
          detail: `Ignored duplicate text-form call to ${call.name}.`,
        })
        continue
      }
      existingFingerprints.add(fingerprint)
      calls.push(call)
      anomalies.push({
        kind: 'recovered_tool_call',
        detail: `Recovered text-form call to ${call.name}.`,
      })
    }
    return result.toolLikeNames.length > 0
  }

  let cleaned = content.replace(
    /<function_call\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/function_call>/gi,
    (match, name: string, body: string) => {
      const result = callsFromEnvelope(
        { name, arguments: body.trim() },
        allowedNames,
      )
      return accept(result) ? '' : match
    },
  )

  cleaned = cleaned.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (match, body: string) => {
    const result = parseEnvelopeText(body, allowedNames)
    return result && accept(result) ? '' : match
  })

  const spans = findJsonSpans(cleaned)
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i]
    const result = parseEnvelopeText(span.text, allowedNames)
    if (!result || !accept(result)) continue
    cleaned = cleaned.slice(0, span.start) + cleaned.slice(span.end)
  }

  return {
    cleaned: cleaned.replace(/\n{3,}/g, '\n\n').trim(),
    calls,
  }
}

export function normalizeOpenAIChatCompletion(
  raw: unknown,
  allowedToolNames: ReadonlySet<string>,
): ModelCompletion {
  if (!isRecord(raw) || !Array.isArray(raw.choices) || !isRecord(raw.choices[0])) {
    throw new Error('Empty response from model (no choice)')
  }
  const choice = raw.choices[0]
  if (!isRecord(choice.message)) throw new Error('Empty response from model (no message)')
  const message = choice.message
  const anomalies: ProtocolAnomaly[] = []
  const reasoning: string[] = []
  if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
    reasoning.push(message.reasoning_content.trim())
  }
  let content = stripReasoningMarkers(contentToText(message.content), reasoning, anomalies)
  const toolCalls: ModelToolCall[] = []
  for (const call of nativeToolCalls(message)) {
    if (allowedToolNames.has(call.name)) toolCalls.push(call)
    else {
      anomalies.push({
        kind: 'unadvertised_tool_call',
        detail: `Quarantined structured call to unadvertised tool ${call.name}.`,
      })
    }
  }
  const fingerprints = new Set(toolCalls.map(callFingerprint))
  const recovered = recoverTextToolCalls(content, allowedToolNames, fingerprints, anomalies)
  content = recovered.cleaned
  toolCalls.push(...recovered.calls)

  const usage = isRecord(raw.usage) ? raw.usage : undefined
  const details = usage && isRecord(usage.completion_tokens_details)
    ? usage.completion_tokens_details
    : undefined
  const reasoningTokens = details?.reasoning_tokens

  return {
    text: content,
    reasoning,
    toolCalls,
    finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined,
    reasoningTokens:
      typeof reasoningTokens === 'number' && reasoningTokens > 0 ? reasoningTokens : undefined,
    anomalies,
    raw,
  }
}
