// Thin transport to an OpenAI-compatible chat completions endpoint. Default
// target is xAI's hosted API, but any baseUrl that exposes the OpenAI shape
// works (LM Studio, Ollama with the OpenAI compat layer, llama.cpp's server,
// vLLM, etc). Agents shape the request body and parse the response.

import { XAI_BASE_URL } from './config'

function isXaiHost(baseUrl: string): boolean {
  return /(^|\/\/)[^/]*\bx\.ai\b/i.test(baseUrl)
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

export async function xaiChat(
  body: unknown,
  apiKey: string,
  signal: AbortSignal,
  baseUrl: string = XAI_BASE_URL,
): Promise<Response> {
  const effectiveBaseUrl = trimTrailingSlash((baseUrl || XAI_BASE_URL).trim())
  if (!apiKey && isXaiHost(effectiveBaseUrl)) {
    throw new Error('xAI API key not set. Open Settings and paste your key — or point Base URL at a local server.')
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return fetch(`${effectiveBaseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
}

export function modelSupportsSampling(model: string): boolean {
  // Reasoning models (e.g. grok-4-1-fast-reasoning) reject temperature and penalty params.
  return !/reasoning/i.test(model)
}

// Probe an OpenAI-compatible /v1/models endpoint for the list of model IDs the
// server currently serves. Used by the Settings panel to populate a picker so
// users don't have to guess the exact identifier (especially for local servers
// like LM Studio whose IDs vary by version and quant).
export async function listModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const effectiveBaseUrl = trimTrailingSlash((baseUrl || XAI_BASE_URL).trim())
  const headers: Record<string, string> = {}
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const res = await fetch(`${effectiveBaseUrl}/models`, { method: 'GET', headers, signal })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`API ${res.status}: ${body.slice(0, 200) || res.statusText}`)
  }
  const data = (await res.json()) as { data?: { id?: string }[] }
  const ids = (data.data ?? [])
    .map((m) => m?.id)
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
  return ids
}
