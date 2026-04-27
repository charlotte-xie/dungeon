// Writer agent (experimental). Takes a beat plan from the planner plus the
// turn context, produces the final narrative prose shown to the player. Prompt
// design is a pending open thread — stub returns an unimplemented error so
// accidental use surfaces loudly rather than silently no-oping.

import type {
  AdventureSlots,
  ModelCall,
  SamplingParams,
  Turn,
  WorldState,
} from '../types'

export interface WriterContext {
  systemPrompt: string
  model: string
  apiKey: string
  slots: AdventureSlots
  summary: string
  history: Turn[]
  state: WorldState
  plot: string[]
  sampling: SamplingParams
  // Output of the planner — the beat plan to prosify.
  plan: string
}

export async function runWriter(
  ctx: WriterContext,
  signal: AbortSignal,
): Promise<ModelCall> {
  void ctx
  void signal
  throw new Error('writer agent not implemented yet — prompts are still being designed')
}
