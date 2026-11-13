import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadStoredPromptOverrides } from './engine/persistence'
import { setPromptOverrides } from './prompts'

// The player's edits to the prompts, from developer mode's Prompts tab, are in
// place before anything is sent.
setPromptOverrides(loadStoredPromptOverrides())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
