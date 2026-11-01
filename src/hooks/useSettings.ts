import { useState } from 'react'
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '../engine/config'
import {
  LS_BASE_URL,
  LS_CONTEXT,
  LS_DEV_MODE,
  LS_MODEL,
  LS_SAMPLING,
  LS_API_KEY,
  loadStored,
  loadStoredContext,
  loadStoredDevMode,
  loadStoredSampling,
} from '../engine/persistence'
import type { ContextConfig, SamplingParams } from '../engine/types'

// App-level configuration: connection, sampling and context-assembly options,
// plus developer mode. Adventure content (slots) lives in the game
// controller, not here.
export function useSettings() {
  const [model, setModel] = useState(() => loadStored(LS_MODEL, DEFAULT_MODEL))
  const [apiKey, setApiKey] = useState(() => loadStored(LS_API_KEY, ''))
  const [baseUrl, setBaseUrl] = useState(() => loadStored(LS_BASE_URL, DEFAULT_BASE_URL))
  const [sampling, setSampling] = useState<SamplingParams>(() => loadStoredSampling())
  const [context, setContext] = useState<ContextConfig>(() => loadStoredContext())
  const [devMode, setDevMode] = useState<boolean>(() => loadStoredDevMode())

  function save(
    nextModel: string,
    nextApiKey: string,
    nextBaseUrl: string,
    nextSampling: SamplingParams,
    nextContext: ContextConfig,
    nextDevMode: boolean,
  ) {
    setModel(nextModel)
    setApiKey(nextApiKey)
    setBaseUrl(nextBaseUrl)
    setSampling(nextSampling)
    setContext(nextContext)
    setDevMode(nextDevMode)
    try {
      if (nextApiKey) localStorage.setItem(LS_API_KEY, nextApiKey)
      else localStorage.removeItem(LS_API_KEY)
      if (nextModel) localStorage.setItem(LS_MODEL, nextModel)
      else localStorage.removeItem(LS_MODEL)
      if (nextBaseUrl && nextBaseUrl !== DEFAULT_BASE_URL)
        localStorage.setItem(LS_BASE_URL, nextBaseUrl)
      else localStorage.removeItem(LS_BASE_URL)
      localStorage.setItem(LS_SAMPLING, JSON.stringify(nextSampling))
      localStorage.setItem(LS_CONTEXT, JSON.stringify(nextContext))
      if (nextDevMode) localStorage.setItem(LS_DEV_MODE, 'true')
      else localStorage.removeItem(LS_DEV_MODE)
    } catch {
      // ignore quota / disabled storage
    }
  }

  return { model, apiKey, baseUrl, sampling, context, devMode, save }
}
