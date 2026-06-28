import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Demos } from './demos/Demos'
import './index.css'

function Root() {
  const [isDemos, setIsDemos] = useState(() => window.location.hash.startsWith('#/demos'))
  useEffect(() => {
    const on = () => setIsDemos(window.location.hash.startsWith('#/demos'))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return isDemos ? <Demos /> : <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
