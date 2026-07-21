// Stable entry point used by the game agents. Adding a Responses API or a
// provider-specific adapter should require changes here, not in narrator or
// game-state code.

import {
  completeOpenAICompatibleChat,
  listOpenAICompatibleModels,
} from './openaiCompatible'
import type {
  ModelCompletion,
  ModelCompletionRequest,
  ModelConnection,
} from './types'

export async function completeModel(
  request: ModelCompletionRequest,
  connection: ModelConnection,
  signal: AbortSignal,
): Promise<ModelCompletion> {
  return completeOpenAICompatibleChat(request, connection, signal)
}

export async function listModels(
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  return listOpenAICompatibleModels({ baseUrl, apiKey }, signal)
}
