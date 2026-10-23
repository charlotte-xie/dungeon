// Prompt-cache keys. Providers that route by key (xAI, OpenAI) keep a request's
// prompt prefix cached on the server the key names. Each role's requests
// share a long prefix with that role's earlier ones but not with the other
// roles', and on xAI two roles under one key kept evicting each other: both
// reused 128 tokens a turn, where separate keys reused over 80%. So every
// role gets its own key, derived from the adventure's.

export type CacheRole = 'narrator' | 'plotter' | 'summarizer' | 'reviser'

export function roleCacheKey(adventureKey: string | undefined, role: CacheRole): string | undefined {
  return adventureKey ? `${adventureKey}-${role}` : undefined
}
