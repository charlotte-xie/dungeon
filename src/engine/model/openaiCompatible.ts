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

// Capabilities vary by endpoint and model, and names are not reliable signals.
// Learn unsupported temperature settings from a provider's validation response
// once, then omit the field for later calls in this browser session.
const temperatureUnsupported = new Set<string>()

export const MODEL_REQUEST_TIMEOUT_MS = 15 * 60 * 1000
const MODEL_LIST_TIMEOUT_MS = 30 * 1000

export function rejectsTemperature(status: number, errorBody: string): boolean {
  return (
    status === 400 &&
    /temperature/i.test(errorBody) &&
    /unsupported|not\s+support|not\s+allowed|unknown|unrecognized|invalid/i.test(errorBody)
  )
}

async function postCompletion(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authorizationHeaders(apiKey),
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
  if (request.tools?.length) {
    body.tools = request.tools.map(toWireTool)
    if (request.toolChoice) body.tool_choice = request.toolChoice
  }
  const capabilityKey = `${baseUrl}\u0000${request.model}`
  if (request.temperature !== undefined && !temperatureUnsupported.has(capabilityKey)) {
    body.temperature = request.temperature
  }
  const label = request.label ?? 'model'
  console.debug(`[model:${label}] request`, { baseUrl, body })
  const url = `${baseUrl}/chat/completions`
  let response = await postCompletion(url, connection.apiKey, body, signal)
  if (!response.ok) {
    let errorBody = await response.text().catch(() => '')
    if (Object.hasOwn(body, 'temperature') && rejectsTemperature(response.status, errorBody)) {
      temperatureUnsupported.add(capabilityKey)
      delete body.temperature
      console.debug(`[model:${label}] retrying without unsupported temperature`)
      response = await postCompletion(url, connection.apiKey, body, signal)
      if (!response.ok) errorBody = await response.text().catch(() => '')
    }
    if (response.ok) {
      const raw = (await response.json()) as unknown
      console.debug(`[model:${label}] response`, { raw })
      return normalizeOpenAIChatCompletion(
        raw,
        new Set((request.tools ?? []).map((tool) => tool.name)),
      )
    }
    throw new Error(
      `${label} API ${response.status}: ${errorBody.slice(0, 200) || response.statusText}`,
    )
  }
  const raw = (await response.json()) as unknown
  console.debug(`[model:${label}] response`, { raw })
  return normalizeOpenAIChatCompletion(
    raw,
    new Set((request.tools ?? []).map((tool) => tool.name)),
  )
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
  if (request.tools?.length) {
    body.tools = request.tools.map(toResponsesTool)
    if (request.toolChoice) body.tool_choice = request.toolChoice
  }
  const capabilityKey = `${baseUrl}\u0000${request.model}`
  if (request.temperature !== undefined && !temperatureUnsupported.has(capabilityKey)) {
    body.temperature = request.temperature
  }
  const label = request.label ?? 'model'
  console.debug(`[model:${label}] request`, { baseUrl, body })
  const url = `${baseUrl}/responses`
  let response = await postCompletion(url, connection.apiKey, body, signal)
  if (!response.ok) {
    let errorBody = await response.text().catch(() => '')
    if (Object.hasOwn(body, 'temperature') && rejectsTemperature(response.status, errorBody)) {
      temperatureUnsupported.add(capabilityKey)
      delete body.temperature
      console.debug(`[model:${label}] retrying without unsupported temperature`)
      response = await postCompletion(url, connection.apiKey, body, signal)
      if (!response.ok) errorBody = await response.text().catch(() => '')
    }
    if (!response.ok) {
      throw new Error(
        `${label} API ${response.status}: ${errorBody.slice(0, 200) || response.statusText}`,
      )
    }
  }
  const raw = (await response.json()) as unknown
  console.debug(`[model:${label}] response`, { raw })
  return normalizeResponsesApiResponse(
    raw,
    new Set((request.tools ?? []).map((tool) => tool.name)),
  )
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
