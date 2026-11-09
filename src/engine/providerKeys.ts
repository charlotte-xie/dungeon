// The API keys this browser remembers, one for each endpoint. A key belongs to
// the endpoint it was saved for and is never looked up for any other.

import { DEFAULT_BASE_URL } from './config'

export type ProviderKeys = Readonly<Record<string, string>>

// An endpoint's identity, which is also the URL its requests are built from.
// A blank base URL means the default endpoint.
export function endpointId(baseUrl: string): string {
  return (baseUrl.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function keyFor(keys: ProviderKeys, baseUrl: string): string {
  const id = endpointId(baseUrl)
  return Object.hasOwn(keys, id) ? keys[id] : ''
}

// A blank key forgets that endpoint's key.
export function withKey(keys: ProviderKeys, baseUrl: string, key: string): ProviderKeys {
  const id = endpointId(baseUrl)
  const trimmed = key.trim()
  if (trimmed) return { ...keys, [id]: trimmed }
  return Object.fromEntries(Object.entries(keys).filter(([endpoint]) => endpoint !== id))
}
