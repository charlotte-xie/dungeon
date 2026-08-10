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

export interface ModelConnection {
  baseUrl: string
  apiKey: string
  // Defaults to 'chat-completions' when omitted.
  protocol?: ApiProtocol
}

export interface ModelCompletionRequest {
  model: string
  messages: ModelMessage[]
  tools?: ModelToolDefinition[]
  temperature?: number
  label?: string
}

export type ProtocolAnomalyKind =
  | 'reasoning_in_content'
  | 'recovered_tool_call'
  | 'duplicate_tool_call'
  | 'unadvertised_tool_call'

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
  anomalies: ProtocolAnomaly[]
  raw: unknown
}
