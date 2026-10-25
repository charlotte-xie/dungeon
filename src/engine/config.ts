// Engine-wide constants and default values, separated from types so they can be
// imported without dragging the React tree.

import { DEFAULT_SCENARIO } from '../prompts'
import type {
  AdventureSlots,
  ContextConfig,
  Memory,
  SamplingParams,
  SlotDef,
  WorldState,
} from './types'

export const XAI_BASE_URL = 'https://api.x.ai/v1'
// Mistral's La Plateforme API is OpenAI-compatible (chat completions only).
export const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1'
// LM Studio's OpenAI-compatible server defaults to localhost:1234. Same shape
// works for other local OpenAI-compat servers — change the port to match.
export const LMSTUDIO_BASE_URL = 'http://localhost:1234/v1'
export const DEFAULT_BASE_URL = XAI_BASE_URL
export const DEFAULT_MODEL = 'grok-4.3'
export const DEFAULT_REVISER_MODEL = 'grok-4-1-fast-non-reasoning'

// Single source of truth for the model preset dropdown(s). Free-text input
// next to each picker still accepts any model id the provider supports.
export const MODEL_OPTIONS = [
  'grok-4.7',
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-4.5',
  'grok-4.3',
  'grok-4.20-0309-reasoning',
  'grok-4',
  'grok-4-fast',
  'grok-4-fast-reasoning',
  'grok-code-fast',
  'mistral-large-latest',
  'mistral-medium-latest',
  'mistral-small-latest',
  'magistral-medium-latest',
  'magistral-small-latest',
  'open-mistral-nemo',
  'ministral-8b-latest',
] as const

export const DEFAULT_STYLE_GUIDE = ''

export const ADVENTURE_SLOTS: SlotDef[] = [
  {
    key: 'scenario',
    label: 'Scenario brief',
    header: '# Scenario brief',
    framing:
      'The premise, setting and tone of this adventure.',
    hint: 'Premise, setting, and opening situation. Sets where and what the adventure is.',
    placeholder: 'e.g. You are a relic hunter who has spent your last coin on a guide to the Mouldering Vaults...',
    defaultValue: DEFAULT_SCENARIO,
    storageKey: 'dm.scenario',
    rows: 5,
  },
  {
    key: 'styleGuide',
    label: 'Author style guide',
    header: '# Author style guide',
    framing:
      'The voice, genre and emotional register of this adventure.',
    hint: 'Voice, genre, prose register. Optional but powerful — sets the feel of the writing.',
    placeholder: 'e.g. Gritty urban noir; sparse, elliptical dialogue; present tense; no purple prose.',
    defaultValue: DEFAULT_STYLE_GUIDE,
    storageKey: 'dm.styleGuide',
    rows: 4,
  },
]

export function defaultSlots(): AdventureSlots {
  const out = {} as AdventureSlots
  for (const def of ADVENTURE_SLOTS) out[def.key] = def.defaultValue
  return out
}

export const DEFAULT_STATE: WorldState = {
  scene: { location: '', time: '', mood: '' },
  player: {
    position: 'standing',
    hair: '',
    clothes: {},
    inventory: {},
    status: {},
  },
}

export const DEFAULT_MEMORY: Memory = {}

export const DEFAULT_CONTEXT: ContextConfig = {
  narratorReasoning: 'none',
  plotterModel: 'grok-4.3',
  plotterReasoning: 'low',
  summarizerModel: 'grok-4.3',
  summarizerReasoning: 'none',
  compactionThreshold: 32,
  compactionFloor: 16,
  compactionBatch: 4,
  stateCleanupChars: 10_000,
  includePriorPlayerTurns: true,
  reminderAsSystem: true,
  includeWorldState: false,
  includePlotOutline: true,
  includeMemory: true,
  includeOoc: true,
  useReviser: false,
  reviserModel: DEFAULT_REVISER_MODEL,
  apiProtocol: 'responses',
  nsfw: true,
}

export type ProviderId = 'xai' | 'mistral' | 'lmstudio'

type ProviderRouting = Pick<
  ContextConfig,
  | 'apiProtocol'
  | 'narratorReasoning'
  | 'plotterModel'
  | 'plotterReasoning'
  | 'summarizerModel'
  | 'summarizerReasoning'
>

export interface ProviderSetup {
  baseUrl: string
  // Narrator model to select. Omitted when the right id depends on what the
  // provider or local server offers; the player picks or detects it.
  model?: string
  context: ProviderRouting & Partial<ContextConfig>
}

// Blank plotter and summariser models follow the narrator model, and
// provider-default reasoning omits the reasoning parameter.
const FOLLOW_NARRATOR: ProviderRouting = {
  apiProtocol: 'chat-completions',
  narratorReasoning: 'default',
  plotterModel: '',
  plotterReasoning: 'default',
  summarizerModel: '',
  summarizerReasoning: 'default',
}

// The provider buttons in Settings apply a whole setup, not just a base URL:
// role models, reasoning levels, and protocol tuned for one provider fail on
// another. The xAI setup is also the Grok preset and the new-install default.
export const PROVIDER_SETUPS: Record<ProviderId, ProviderSetup> = {
  xai: {
    baseUrl: XAI_BASE_URL,
    model: 'grok-4.3',
    context: {
      apiProtocol: 'responses',
      narratorReasoning: 'none',
      plotterModel: 'grok-4.3',
      plotterReasoning: 'low',
      summarizerModel: 'grok-4.3',
      summarizerReasoning: 'none',
      useReviser: false,
    },
  },
  mistral: { baseUrl: MISTRAL_BASE_URL, context: FOLLOW_NARRATOR },
  lmstudio: { baseUrl: LMSTUDIO_BASE_URL, context: FOLLOW_NARRATOR },
}

export type ModelRole = 'narrator' | 'plotter' | 'summarizer'

// Grok 4.7 cannot turn reasoning off. Returns the first role whose effective
// model would be sent reasoning 'none', or null. As at request time, a blank
// or whitespace-only role model follows the narrator model.
export function reasoningOffConflict(model: string, context: ContextConfig): ModelRole | null {
  const narrator = model.trim()
  const roles: [ModelRole, string, ContextConfig['narratorReasoning']][] = [
    ['narrator', narrator, context.narratorReasoning],
    ['plotter', context.plotterModel.trim() || narrator, context.plotterReasoning],
    ['summarizer', context.summarizerModel.trim() || narrator, context.summarizerReasoning],
  ]
  const conflict = roles.find(([, id, effort]) => /^grok-4\.7(?:-|$)/.test(id) && effort === 'none')
  return conflict ? conflict[0] : null
}

export const DEFAULT_SAMPLING: SamplingParams = {
  temperature: 0.75,
}
