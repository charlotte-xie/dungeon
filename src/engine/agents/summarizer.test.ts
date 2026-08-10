import { describe, expect, it } from 'vitest'
import { relevantMemoryForInputs } from './summarizer'

describe('summarizer grounding', () => {
  it('includes only memory for entities mentioned in the summarized inputs', () => {
    const memory = {
      the_baker: { is: 'Hesta the baker', secret: 'hiding her son upstairs' },
      masked_patron: { is: 'Duke Orlan', secret: 'secretly funds the river smugglers' },
      player: { is: 'Veteran of the border wars; carries a chipped sabre' },
    }

    expect(relevantMemoryForInputs(memory, ['DM: Hesta hands you the sealed ledger.'])).toEqual({
      the_baker: memory.the_baker,
    })
  })

  it('matches a readable memory slug when no proper name is present', () => {
    const memory = {
      iron_seal: { is: 'An old seal used by the forgotten order.' },
      lower_vault: { is: 'The flooded chambers beneath the crypt.' },
    }

    expect(relevantMemoryForInputs(memory, ['You place the iron seal into the lock.'])).toEqual({
      iron_seal: memory.iron_seal,
    })
  })
})
