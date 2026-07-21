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

export interface ModelConnection {
  baseUrl: string
  apiKey: string
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
