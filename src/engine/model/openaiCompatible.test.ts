import { describe, expect, it } from 'vitest'
import { rejectsTemperature } from './openaiCompatible'

describe('OpenAI-compatible capability fallback', () => {
  it('recognizes a provider rejection of temperature', () => {
    expect(
      rejectsTemperature(
        400,
        `{"error":{"message":"Unsupported parameter: 'temperature' is not supported with this model."}}`,
      ),
    ).toBe(true)
  })

  it('does not reinterpret unrelated request failures', () => {
    expect(rejectsTemperature(401, 'invalid API key')).toBe(false)
    expect(rejectsTemperature(400, 'messages must not be empty')).toBe(false)
  })
})
