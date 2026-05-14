import React from 'react'
import ReactDOM from 'react-dom/client'
import { applySecureChatEnv } from './authBootstrap.js'
import App from './App.jsx'
import ErrorBoundary from './components/system/ErrorBoundary.jsx'
import './index.css'

/**
 * @file Vite SPA entry — secure-env check, React root under `#root`, StrictMode + error boundary.
 * @module main
 */

applySecureChatEnv()
  .catch(() => {
    // Keep app boot resilient; auth errors surface in UI/logs.
  })
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    )
  })
