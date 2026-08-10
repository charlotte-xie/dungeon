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
// LM Studio's OpenAI-compatible server defaults to localhost:1234. Same shape
// works for other local OpenAI-compat servers — change the port to match.
export const LMSTUDIO_BASE_URL = 'http://localhost:1234/v1'
export const DEFAULT_BASE_URL = XAI_BASE_URL
export const DEFAULT_MODEL = 'grok-4-1-fast-reasoning'
export const DEFAULT_REVISER_MODEL = 'grok-4-1-fast-non-reasoning'

// Single source of truth for the model preset dropdown(s). Free-text input
// next to each picker still accepts any model id the provider supports.
export const MODEL_OPTIONS = [
  'grok-4-1-fast-reasoning',
  'grok-4-1-fast-non-reasoning',
  'grok-4.5',
  'grok-4.3',
  'grok-4.20-0309-reasoning',
  'grok-4',
  'grok-4-fast',
  'grok-4-fast-reasoning',
  'grok-code-fast',
] as const

export const DEFAULT_STYLE_GUIDE = ''

export const ADVENTURE_SLOTS: SlotDef[] = [
  {
    key: 'scenario',
    label: 'Scenario brief',
    header: '# Scenario brief',
    framing:
      'The premise, setting, and tone for this adventure — the foundational frame for everything you narrate.',
    hint: 'Premise, setting, and opening situation. Sets where and what the adventure is.',
    placeholder: 'e.g. A lone adventurer arrives at the threshold of the Mouldering Vaults...',
    defaultValue: DEFAULT_SCENARIO,
    storageKey: 'dm.scenario',
    rows: 5,
  },
  {
    key: 'styleGuide',
    label: 'Author style guide',
    header: '# Author style guide',
    framing:
      'The author voice, genre, and prose register for this adventure. Apply throughout your narration in addition to the general prose rules above.',
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
  nsfw: true,
}

export const DEFAULT_SAMPLING: SamplingParams = {
  temperature: 0.75,
}
