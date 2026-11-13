import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import './ui/styles.css'
import { prepare } from './color/pipeline'
import { useApp } from './ui/store'
import { viewerApi } from './ui/Viewer'

// acceso al estado desde la consola, solo en desarrollo
if (import.meta.env.DEV) Object.assign(window, { __app: useApp, __viewer: viewerApi, __prepare: prepare })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
