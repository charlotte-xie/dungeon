import { useEffect, useState } from 'react'
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '../engine/config'
import {
  LS_BASE_URL,
  LS_CONTEXT,
  LS_MODEL,
  LS_SAMPLING,
  LS_SHOW_TRACE,
  LS_API_KEY,
  loadStored,
  loadStoredContext,
  loadStoredSampling,
} from '../engine/persistence'
import type { ContextConfig, SamplingParams } from '../engine/types'

// App-level configuration: connection, sampling and context-assembly options,
// plus the trace-visibility toggle. Adventure content (slots) lives in the
// game controller, not here.
export function useSettings() {
  const [model, setModel] = useState(() => loadStored(LS_MODEL, DEFAULT_MODEL))
  const [apiKey, setApiKey] = useState(() => loadStored(LS_API_KEY, ''))
  const [baseUrl, setBaseUrl] = useState(() => loadStored(LS_BASE_URL, DEFAULT_BASE_URL))
  const [sampling, setSampling] = useState<SamplingParams>(() => loadStoredSampling())
  const [context, setContext] = useState<ContextConfig>(() => loadStoredContext())
  const [showTrace, setShowTrace] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(LS_SHOW_TRACE)
      if (raw === null) return true
      return raw === 'true'
    } catch {
      return true
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(LS_SHOW_TRACE, String(showTrace))
    } catch {
      // ignore quota / disabled storage
    }
  }, [showTrace])

  function save(
    nextModel: string,
    nextApiKey: string,
    nextBaseUrl: string,
    nextSampling: SamplingParams,
    nextContext: ContextConfig,
    nextShowTrace: boolean,
  ) {
    setModel(nextModel)
    setApiKey(nextApiKey)
    setBaseUrl(nextBaseUrl)
    setSampling(nextSampling)
    setContext(nextContext)
    setShowTrace(nextShowTrace)
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
    } catch {
      // ignore quota / disabled storage
    }
  }

  return { model, apiKey, baseUrl, sampling, context, showTrace, save }
}
