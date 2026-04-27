// Thin transport to the xAI chat completions endpoint. No business logic —
// agents shape the request body and parse the response.

import { XAI_BASE_URL } from './config'

export async function xaiChat(
  body: unknown,
  apiKey: string,
  signal: AbortSignal,
): Promise<Response> {
  if (!apiKey) {
    throw new Error('xAI API key not set. Open Settings and paste your key.')
  }
  return fetch(`${XAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })
}

export function modelSupportsSampling(model: string): boolean {
  // Reasoning models (e.g. grok-4-1-fast-reasoning) reject temperature and penalty params.
  return !/reasoning/i.test(model)
}
