import { afterEach, describe, expect, it } from 'vitest'
import type { ConfigEnv, UserConfig } from 'vite'
import config from './vite.config'

const configFor = (env: ConfigEnv) => (config as (env: ConfigEnv) => UserConfig)(env)

describe('the xAI key from the environment', () => {
  const before = process.env.XAI_API_KEY
  afterEach(() => {
    if (before === undefined) delete process.env.XAI_API_KEY
    else process.env.XAI_API_KEY = before
  })

  it('reaches the app from the dev server alone, never a build or the tests', () => {
    process.env.XAI_API_KEY = 'test-key'
    const keyIn = (env: ConfigEnv) => configFor(env).define?.__DEV_XAI_KEY__

    expect(keyIn({ command: 'serve', mode: 'development' })).toBe('"test-key"')
    expect(keyIn({ command: 'build', mode: 'production' })).toBe('""')
    expect(keyIn({ command: 'build', mode: 'development' })).toBe('""')
    expect(keyIn({ command: 'serve', mode: 'test' })).toBe('""')
  })
})
