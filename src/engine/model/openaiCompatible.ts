// Adapters for OpenAI-compatible endpoints. Chat Completions is the
// lowest-common-denominator protocol every provider supports (xAI, OpenAI,
// LM Studio, Ollama, llama.cpp, vLLM, gateways); the Responses API is the
// newer format xAI/OpenAI recommend, used here STATELESSLY (full conversation
// sent each request, store:false) so it behaves identically on providers
// without server-side state and the app's client-side prefix caching stays
// authoritative. Provider-specific wire details stop here.

import { XAI_BASE_URL } from '../config'
import { normalizeOpenAIChatCompletion, normalizeResponsesApiResponse } from './normalize'
import type {
  ModelCompletion,
  ModelCompletionRequest,
  ModelConnection,
  ModelMessage,
  ModelToolDefinition,
  ProtocolAnomaly,
} from './types'

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

function effectiveBaseUrl(baseUrl: string): string {
  return trimTrailingSlashes((baseUrl || XAI_BASE_URL).trim())
}

function isXaiHost(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase()
    return hostname === 'x.ai' || hostname.endsWith('.x.ai')
  } catch {
    return false
  }
}

function toWireMessage(message: ModelMessage): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  }
  if (message.toolCalls?.length) {
    wire.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }))
  }
  if (message.toolCallId) wire.tool_call_id = message.toolCallId
  return wire
}

function toWireTool(tool: ModelToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

function authorizationHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

// xAI routes a request to the server holding its cached prefix by this header,
// on Chat Completions and Responses alike. Its CORS policy allows any request
// header.
function requestHeaders(connection: ModelConnection, baseUrl: string): Record<string, string> {
  const headers = authorizationHeaders(connection.apiKey)
  if (connection.cacheKey && isXaiHost(baseUrl)) headers['x-grok-conv-id'] = connection.cacheKey
  return headers
}

// Capabilities vary by endpoint and model, and names are not reliable signals.
// Learn unsupported temperature, reasoning, cache-key and tool-choice settings
// from a provider's validation response once, then omit the field for later
// calls in this browser session.
const temperatureUnsupported = new Set<string>()
const reasoningUnsupported = new Set<string>()
const cacheKeyUnsupported = new Set<string>()
const toolChoiceUnsupported = new Set<string>()

export const MODEL_REQUEST_TIMEOUT_MS = 15 * 60 * 1000
const MODEL_LIST_TIMEOUT_MS = 30 * 1000

const UNSUPPORTED_WORDING = /unsupported|not\s+support|not\s+allowed|not\s+permitted|unknown|unrecognized|invalid/i

export function rejectsTemperature(status: number, errorBody: string): boolean {
  return status === 400 && /temperature/i.test(errorBody) && UNSUPPORTED_WORDING.test(errorBody)
}

export function rejectsReasoning(status: number, errorBody: string): boolean {
  return status === 400 && /reasoning/i.test(errorBody) && UNSUPPORTED_WORDING.test(errorBody)
}

// Strict validators reject fields they don't know, some with a 422.
export function rejectsCacheKey(status: number, errorBody: string): boolean {
  return (
    (status === 400 || status === 422) &&
    /prompt_cache_key/i.test(errorBody) &&
    (UNSUPPORTED_WORDING.test(errorBody) || /extra/i.test(errorBody))
  )
}

export function rejectsToolChoice(status: number, errorBody: string): boolean {
  return (
    (status === 400 || status === 422) &&
    /tool_choice/i.test(errorBody) &&
    (UNSUPPORTED_WORDING.test(errorBody) || /extra/i.test(errorBody))
  )
}

// Dropping reasoning changes how the model behaves, so it is noted in the
// call's trace rather than only in the console.
const REASONING_DROPPED: ProtocolAnomaly = {
  kind: 'unsupported_reasoning',
  detail: 'reasoning setting rejected by the provider; sent without it',
}

const REJECTABLE_FIELDS = [
  { name: 'temperature', fields: ['temperature'], rejects: rejectsTemperature, unsupported: temperatureUnsupported },
  { name: 'reasoning', fields: ['reasoning_effort', 'reasoning'], rejects: rejectsReasoning, unsupported: reasoningUnsupported },
  { name: 'cache key', fields: ['prompt_cache_key'], rejects: rejectsCacheKey, unsupported: cacheKeyUnsupported },
  { name: 'tool choice', fields: ['tool_choice'], rejects: rejectsToolChoice, unsupported: toolChoiceUnsupported },
]

// Post a completion request. On a rejection of an optional field still in the
// body, remember that for this endpoint and model, drop the field, and retry;
// each retry removes a field, so this ends after at most four.
async function postWithFallbacks(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal,
  capabilityKey: string,
  label: string,
): Promise<Response> {
  let response = await postCompletion(url, headers, body, signal)
  while (!response.ok) {
    const { status, statusText } = response
    const errorBody = await response.text().catch(() => '')
    const rejected = REJECTABLE_FIELDS.find(
      (option) => option.fields.some((field) => Object.hasOwn(body, field)) && option.rejects(status, errorBody),
    )
    if (!rejected) {
      throw new Error(`${label} API ${status}: ${errorBody.slice(0, 200) || statusText}`)
    }
    rejected.unsupported.add(capabilityKey)
    for (const field of rejected.fields) delete body[field]
    console.debug(`[model:${label}] retrying without unsupported ${rejected.name}`)
    response = await postCompletion(url, headers, body, signal)
  }
  return response
}

async function postCompletion(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  })
}

async function withTimeout<T>(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  label: string,
  action: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  const relayAbort = () => controller.abort(parentSignal?.reason)
  if (parentSignal?.aborted) relayAbort()
  else parentSignal?.addEventListener('abort', relayAbort, { once: true })
  const timeoutId = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await action(controller.signal)
  } catch (err) {
    if (timedOut) {
      const duration = timeoutMs < 60_000
        ? `${Math.round(timeoutMs / 1000)} seconds`
        : `${Math.round(timeoutMs / 60_000)} minutes`
      throw new Error(`${label} timed out after ${duration}`)
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
    parentSignal?.removeEventListener('abort', relayAbort)
  }
}

export async function completeOpenAICompatibleChat(
  request: ModelCompletionRequest,
  connection: ModelConnection,
  signal: AbortSignal,
): Promise<ModelCompletion> {
  return withTimeout(signal, MODEL_REQUEST_TIMEOUT_MS, 'Model request', (requestSignal) =>
    completeOpenAICompatibleChatWithinTimeout(request, connection, requestSignal),
  )
}

async function completeOpenAICompatibleChatWithinTimeout(
  request: ModelCompletionRequest,
  connection: ModelConnection,
  signal: AbortSignal,
): Promise<ModelCompletion> {
  const baseUrl = effectiveBaseUrl(connection.baseUrl)
  if (!connection.apiKey && isXaiHost(baseUrl)) {
    throw new Error(
      'xAI API key not set. Open Settings and paste your key — or point Base URL at a local server.',
    )
  }
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(toWireMessage),
    stream: false,
  }
  const capabilityKey = `${baseUrl}\u0000${request.model}`
  if (request.tools?.length) {
    body.tools = request.tools.map(toWireTool)
    if (request.toolChoice && !toolChoiceUnsupported.has(capabilityKey)) body.tool_choice = request.toolChoice
  }
  const wantsReasoning = !!request.reasoningEffort && request.reasoningEffort !== 'default'
  if (wantsReasoning && !reasoningUnsupported.has(capabilityKey)) {
    body.reasoning_effort = request.reasoningEffort
  }
  if (request.temperature !== undefined && !temperatureUnsupported.has(capabilityKey)) {
    body.temperature = request.temperature
  }
  if (connection.cacheKey && !cacheKeyUnsupported.has(capabilityKey)) {
    body.prompt_cache_key = connection.cacheKey
  }
  const headers = requestHeaders(connection, baseUrl)
  const label = request.label ?? 'model'
  console.debug(`[model:${label}] request`, { baseUrl, body })
  const url = `${baseUrl}/chat/completions`
  const response = await postWithFallbacks(url, headers, body, signal, capabilityKey, label)
  const raw = (await response.json()) as unknown
  console.debug(`[model:${label}] response`, { raw })
  const completion = normalizeOpenAIChatCompletion(
    raw,
    new Set((request.tools ?? []).map((tool) => tool.name)),
  )
  if (wantsReasoning && !Object.hasOwn(body, 'reasoning_effort')) completion.anomalies.push(REASONING_DROPPED)
  return completion
}

// --- Responses API (stateless) ---

// Map the provider-neutral conversation onto Responses `input` items. Message
// history keeps the same role structure; tool activity becomes typed
// function_call / function_call_output items keyed by call_id.
export function toResponsesInput(messages: ModelMessage[]): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = []
  for (const message of messages) {
    if (message.role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: message.toolCallId ?? '',
        output: message.content,
      })
      continue
    }
    if (message.role === 'assistant') {
      if (message.content) {
        items.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: message.content }],
        })
      }
      for (const call of message.toolCalls ?? []) {
        items.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        })
      }
      continue
    }
    items.push({
      role: message.role,
      content: [{ type: 'input_text', text: message.content }],
    })
  }
  return items
}

// Responses tools are flat (name at top level), unlike Chat Completions'
// nested `function` wrapper.
function toResponsesTool(tool: ModelToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }
}

export async function completeOpenAICompatibleResponses(
  request: ModelCompletionRequest,
  connection: ModelConnection,
  signal: AbortSignal,
): Promise<ModelCompletion> {
  return withTimeout(signal, MODEL_REQUEST_TIMEOUT_MS, 'Model request', (requestSignal) =>
    completeResponsesWithinTimeout(request, connection, requestSignal),
  )
}

async function completeResponsesWithinTimeout(
  request: ModelCompletionRequest,
  connection: ModelConnection,
  signal: AbortSignal,
): Promise<ModelCompletion> {
  const baseUrl = effectiveBaseUrl(connection.baseUrl)
  if (!connection.apiKey && isXaiHost(baseUrl)) {
    throw new Error(
      'xAI API key not set. Open Settings and paste your key — or point Base URL at a local server.',
    )
  }
  const body: Record<string, unknown> = {
    model: request.model,
    input: toResponsesInput(request.messages),
    stream: false,
    // Stateless by design: never rely on (or pay for) server-side storage.
    store: false,
  }
  const capabilityKey = `${baseUrl}\u0000${request.model}`
  const wantsReasoning = !!request.reasoningEffort && request.reasoningEffort !== 'default'
  if (wantsReasoning && !reasoningUnsupported.has(capabilityKey)) {
    body.reasoning = { effort: request.reasoningEffort }
  }
  if (request.tools?.length) {
    body.tools = request.tools.map(toResponsesTool)
    if (request.toolChoice && !toolChoiceUnsupported.has(capabilityKey)) body.tool_choice = request.toolChoice
  }
  if (request.temperature !== undefined && !temperatureUnsupported.has(capabilityKey)) {
    body.temperature = request.temperature
  }
  if (connection.cacheKey && !cacheKeyUnsupported.has(capabilityKey)) {
    body.prompt_cache_key = connection.cacheKey
  }
  const label = request.label ?? 'model'
  console.debug(`[model:${label}] request`, { baseUrl, body })
  const url = `${baseUrl}/responses`
  const response = await postWithFallbacks(
    url,
    requestHeaders(connection, baseUrl),
    body,
    signal,
    capabilityKey,
    label,
  )
  const raw = (await response.json()) as unknown
  console.debug(`[model:${label}] response`, { raw })
  const completion = normalizeResponsesApiResponse(
    raw,
    new Set((request.tools ?? []).map((tool) => tool.name)),
  )
  if (wantsReasoning && !Object.hasOwn(body, 'reasoning')) completion.anomalies.push(REASONING_DROPPED)
  return completion
}

export async function listOpenAICompatibleModels(
  connection: ModelConnection,
  signal?: AbortSignal,
): Promise<string[]> {
  return withTimeout(signal, MODEL_LIST_TIMEOUT_MS, 'Model discovery', (requestSignal) =>
    listOpenAICompatibleModelsWithinTimeout(connection, requestSignal),
  )
}

async function listOpenAICompatibleModelsWithinTimeout(
  connection: ModelConnection,
  signal: AbortSignal,
): Promise<string[]> {
  const baseUrl = effectiveBaseUrl(connection.baseUrl)
  const response = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers: authorizationHeaders(connection.apiKey),
    signal,
  })
  if (!response.ok) {
    const errorBody = await response.text().catch(() => '')
    throw new Error(
      `API ${response.status}: ${errorBody.slice(0, 200) || response.statusText}`,
    )
  }
  const raw = (await response.json()) as unknown
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { data?: unknown }).data)) return []
  return ((raw as { data: unknown[] }).data)
    .map((entry) =>
      entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
        ? (entry as { id: string }).id
        : '',
    )
    .filter(Boolean)
}
