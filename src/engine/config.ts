// Engine-wide constants and default values, separated from types so they can be
// imported without dragging the React tree.

import { DEFAULT_SCENARIO } from '../prompts'
import type {
  AdventureSlots,
  ContextConfig,
  SamplingParams,
  SlotDef,
  WorldState,
} from './types'

export const XAI_BASE_URL = 'https://api.x.ai/v1'
export const DEFAULT_MODEL = 'grok-4-1-fast-reasoning'

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
  npcs: {},
  goals: {},
  topics: {},
}

export const DEFAULT_CONTEXT: ContextConfig = {
  compactionThreshold: 8,
  compactionBatch: 4,
  stateCleanupChars: 10_000,
  includePriorPlayerTurns: true,
  appendReminderToUser: false,
  includeWorldState: true,
  includePlotOutline: true,
  usePlanner: false,
}

export const DEFAULT_SAMPLING: SamplingParams = {
  temperature: 0.75,
  frequencyPenalty: 0,
  presencePenalty: 0,
}
