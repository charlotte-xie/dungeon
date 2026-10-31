// Stable entry point used by the game agents. Adding a Responses API or a
// provider-specific adapter should require changes here, not in narrator or
// game-state code.

import {
  chatCompletionsRequest,
  completeOpenAICompatibleChat,
  completeOpenAICompatibleResponses,
  listOpenAICompatibleModels,
  responsesApiRequest,
} from './openaiCompatible'
import type {
  ModelCompletion,
  ModelCompletionRequest,
  ModelConnection,
  WireRequest,
} from './types'

// The request completeModel would post for this completion, built by the
// same code, so a preview shows exactly what the model will be sent.
export function wireRequest(request: ModelCompletionRequest, connection: ModelConnection): WireRequest {
  return connection.protocol === 'responses'
    ? responsesApiRequest(request, connection)
    : chatCompletionsRequest(request, connection)
}

export async function completeModel(
  request: ModelCompletionRequest,
  connection: ModelConnection,
  signal: AbortSignal,
): Promise<ModelCompletion> {
  if (connection.protocol === 'responses') {
    return completeOpenAICompatibleResponses(request, connection, signal)
  }
  return completeOpenAICompatibleChat(request, connection, signal)
}

export async function listModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return listOpenAICompatibleModels({ baseUrl, apiKey }, signal)
}
