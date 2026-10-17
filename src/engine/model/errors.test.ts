import { describe, expect, it } from 'vitest'
import { describeModelError } from './errors'

describe('describeModelError', () => {
  it("shows the provider's message and the HTTP status", () => {
    const raw = 'plotter:0 API 404: {"error":{"message":"The model `grok-4.3` does not exist.","type":"invalid_request_error"}}'
    expect(describeModelError(raw)).toBe('The model `grok-4.3` does not exist. (HTTP 404)')
  })

  it('reads validation details and top-level messages', () => {
    expect(describeModelError('summarizer API 422: {"detail":[{"loc":["body","model"],"msg":"Field required"}]}'))
      .toBe('Field required (HTTP 422)')
    expect(describeModelError('model API 400: {"message":"Invalid model"}')).toBe('Invalid model (HTTP 400)')
  })

  it('recovers a message from a body cut off at 200 characters', () => {
    const raw = 'plotter:0 API 400: {"error":{"message":"This request was rejected because the conversation is far too long for'
    expect(describeModelError(raw))
      .toBe('This request was rejected because the conversation is far too long for… (HTTP 400)')
  })

  it('shows a plain-text body as is', () => {
    expect(describeModelError('model API 502: Bad Gateway')).toBe('Bad Gateway (HTTP 502)')
  })

  it('passes other errors through unchanged', () => {
    expect(describeModelError('Model request timed out after 15 minutes'))
      .toBe('Model request timed out after 15 minutes')
    expect(describeModelError('model API 500: {"unexpected":true}')).toBe('model API 500: {"unexpected":true}')
  })
})
