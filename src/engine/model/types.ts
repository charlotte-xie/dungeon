// Provider-neutral model boundary. Core game code speaks these types; adapters
// translate them to provider wire formats such as OpenAI Chat Completions.

export interface ModelToolCall {
  id: string
  name: string
  arguments: string
}

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCalls?: ModelToolCall[]
  toolCallId?: string
}

export interface ModelToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

// Which OpenAI-compatible wire protocol to speak. 'chat-completions' is the
// universal legacy endpoint every provider supports; 'responses' is the newer
// format recommended by xAI/OpenAI and supported statelessly by Ollama and
// vLLM. Both are used statelessly here — the app always sends the full
// conversation, so the client-side prefix-cache architecture applies equally.
export type ApiProtocol = 'chat-completions' | 'responses'

export type ReasoningEffort = 'default' | 'none' | 'low' | 'medium' | 'high' | 'xhigh'

export interface ModelConnection {
  baseUrl: string
  apiKey: string
  // Defaults to 'chat-completions' when omitted.
  protocol?: ApiProtocol
  // Names one role's requests in one adventure, which share a prompt prefix,
  // so providers that route by key (xAI, OpenAI) send them to the server
  // holding its cache. See roleCacheKey.
  cacheKey?: string
}

export interface ModelCompletionRequest {
  model: string
  messages: ModelMessage[]
  tools?: ModelToolDefinition[]
  // 'none' keeps the tool schemas in the request (they are part of the
  // provider's cached prefix) while forbidding calls for this completion;
  // 'required' has the model make at least one call.
  toolChoice?: 'auto' | 'none' | 'required'
  temperature?: number
  reasoningEffort?: ReasoningEffort
  label?: string
}

export type ProtocolAnomalyKind =
  | 'reasoning_in_content'
  | 'recovered_tool_call'
  | 'duplicate_tool_call'
  | 'unadvertised_tool_call'
  | 'unsupported_reasoning'

export interface ProtocolAnomaly {
  kind: ProtocolAnomalyKind
  detail: string
}

export interface ModelCompletion {
  text: string
  reasoning: string[]
  toolCalls: ModelToolCall[]
  finishReason?: string
  reasoningTokens?: number
  // Prompt-side usage when the provider reports it. cachedTokens is the
  // provider's own count of prompt tokens served from its prefix cache — the
  // observable proof that the append-only request layout is paying off.
  // Undefined means the provider did not report it; 0 means a full miss.
  promptTokens?: number
  cachedTokens?: number
  anomalies: ProtocolAnomaly[]
  raw: unknown
}
