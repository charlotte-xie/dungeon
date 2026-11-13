import { describe, expect, it } from 'vitest'
import { DEFAULT_BASE_URL } from './config'
import { endpointId, keyFor, withDevKey, withKey } from './providerKeys'

const XAI = 'https://api.x.ai/v1'
const MISTRAL = 'https://api.mistral.ai/v1'

describe('endpointId', () => {
  it('treats spacing and trailing slashes as the same endpoint', () => {
    expect(endpointId(`  ${MISTRAL}// `)).toBe(endpointId(MISTRAL))
  })

  it('takes a blank base URL to be the default endpoint', () => {
    expect(endpointId('   ')).toBe(endpointId(DEFAULT_BASE_URL))
  })

  it('keeps different endpoints apart', () => {
    expect(endpointId(XAI)).not.toBe(endpointId(MISTRAL))
    expect(endpointId('http://localhost:1234/v1')).not.toBe(endpointId('http://localhost:1235/v1'))
  })
})

describe('provider keys', () => {
  it('remembers a separate key for each endpoint', () => {
    const keys = withKey(withKey({}, XAI, 'xai-key'), MISTRAL, 'mistral-key')
    expect(keyFor(keys, XAI)).toBe('xai-key')
    expect(keyFor(keys, MISTRAL)).toBe('mistral-key')
  })

  it('has no key for an endpoint none was saved for', () => {
    expect(keyFor(withKey({}, XAI, 'xai-key'), MISTRAL)).toBe('')
  })

  it('finds a key however the same URL is written', () => {
    expect(keyFor(withKey({}, `${XAI}/`, 'xai-key'), ` ${XAI}`)).toBe('xai-key')
  })

  it('replaces only the key of the endpoint given', () => {
    const keys = withKey(withKey(withKey({}, XAI, 'old'), MISTRAL, 'mistral-key'), XAI, ' new ')
    expect(keyFor(keys, XAI)).toBe('new')
    expect(keyFor(keys, MISTRAL)).toBe('mistral-key')
  })

  it('forgets only that endpoint when its key is blanked', () => {
    const keys = withKey(withKey(withKey({}, XAI, 'xai-key'), MISTRAL, 'mistral-key'), XAI, '  ')
    expect(keyFor(keys, XAI)).toBe('')
    expect(keyFor(keys, MISTRAL)).toBe('mistral-key')
  })

  it('leaves the keys it was given untouched', () => {
    const before = withKey({}, XAI, 'xai-key')
    withKey(before, XAI, 'other')
    withKey(before, XAI, '')
    expect(keyFor(before, XAI)).toBe('xai-key')
  })

  it('finds nothing inherited under an endpoint named after an object member', () => {
    expect(keyFor({}, 'constructor')).toBe('')
    expect(keyFor({}, '__proto__')).toBe('')
  })
})

describe('the dev server’s xAI key', () => {
  it('stands in for xAI when the browser has no key of its own, and for no other endpoint', () => {
    const keys = withDevKey(withKey({}, MISTRAL, 'mistral-key'), 'dev-key')
    expect(keyFor(keys, XAI)).toBe('dev-key')
    expect(keyFor(keys, MISTRAL)).toBe('mistral-key')
  })

  it('gives way to a key the browser saved for xAI', () => {
    expect(keyFor(withDevKey(withKey({}, XAI, 'saved-key'), 'dev-key'), XAI)).toBe('saved-key')
  })

  it('is empty outside the dev server, so nothing changes', () => {
    const keys = withKey({}, MISTRAL, 'mistral-key')
    expect(withDevKey(keys)).toBe(keys)
    expect(withDevKey(keys, '')).toBe(keys)
  })
})
