import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import './style.css'

const el = document.getElementById('app')
if (!el) throw new Error('Missing #app element')

createRoot(el).render(
  <React.StrictMode>
    <ErrorBoundary label="Waypoint">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

