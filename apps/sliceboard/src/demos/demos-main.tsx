import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Demos } from './Demos'
import '../index.css'

export function mountDemos() {
  const rootEl = document.getElementById('root')
  if (!rootEl) throw new Error('No #root element')

  const appEl = document.getElementById('app')
  if (appEl) appEl.style.display = 'none'
  rootEl.style.display = 'block'

  createRoot(rootEl).render(
    <StrictMode>
      <Demos />
    </StrictMode>,
  )
}
