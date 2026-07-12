/**
 * Shell demo entry — mounts the new dockview-core shell with N placeholder
 * panels, wires layout persistence to localStorage, and logs panel events.
 *
 * Stage 1 verification surface. Chart wiring comes in stage 2; this page
 * exercises just the raw dock (add / close / drag / resize / persist).
 */

import 'dockview-core/dist/styles/dockview.css'
import './shell.css'
import { createShell } from './createShell'
import type { SerializedDockview } from 'dockview-core'

const LAYOUT_KEY = 'hotbook.shell-demo.layout'
const N_PANELS = 4

function loadLayout(): SerializedDockview | undefined {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    return raw ? (JSON.parse(raw) as SerializedDockview) : undefined
  } catch {
    return undefined
  }
}

function saveLayout(layout: SerializedDockview) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
  } catch {
    /* quota, ignore */
  }
}

function mount() {
  const root = document.getElementById('app')
  if (!root) throw new Error('#app not found')

  root.innerHTML = `
    <div class="shell-root">
      <div class="shell-topbar">
        <span class="shell-title">dockview-core shell — stage 1 scaffold</span>
        <button id="add-panel" class="shell-btn">Add panel</button>
        <button id="reset-layout" class="shell-btn">Reset layout</button>
      </div>
      <div id="shell-host" class="shell-host"></div>
    </div>
  `

  const host = document.getElementById('shell-host') as HTMLElement
  const initialLayout = loadLayout()

  const shell = createShell(host, {
    initialLayout,
    onLayoutChange: saveLayout,
    onDidAddPanel: (id) => console.log('[shell] add panel', id),
    onDidRemovePanel: (id) => console.log('[shell] remove panel', id),
    onDidActivePanelChange: (id) => console.log('[shell] active panel', id),
  })

  // Seed default panels only if there was no persisted layout.
  if (!initialLayout) {
    for (let i = 1; i <= N_PANELS; i++) {
      shell.api.addPanel({
        id: `panel-${i}`,
        component: 'placeholder',
        title: `Panel ${i}`,
      })
    }
  }

  document.getElementById('add-panel')!.addEventListener('click', () => {
    const id = `panel-${Date.now().toString(36)}`
    shell.api.addPanel({ id, component: 'placeholder', title: id })
  })

  document.getElementById('reset-layout')!.addEventListener('click', () => {
    localStorage.removeItem(LAYOUT_KEY)
    window.location.reload()
  })

  window.addEventListener('beforeunload', () => shell.dispose())
}

mount()
