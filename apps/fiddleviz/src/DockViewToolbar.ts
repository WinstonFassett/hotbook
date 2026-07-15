import type { DockView } from './DockView'
import type { DockEdge } from './dock'

type DockAction = `move-${DockEdge}` | `split-${DockEdge}` | 'close'

const ICONS: Record<string, string> = {
  'move-left':  '<svg viewBox="0 0 24 24"><path d="M4 4v16"/><path d="M21 12H9"/><path d="M13 7l-5 5 5 5"/></svg>',
  'move-right': '<svg viewBox="0 0 24 24"><path d="M20 4v16"/><path d="M3 12h12"/><path d="M11 7l5 5-5 5"/></svg>',
  'move-up':    '<svg viewBox="0 0 24 24"><path d="M4 4h16"/><path d="M12 21V9"/><path d="M7 13l5-5 5 5"/></svg>',
  'move-down':  '<svg viewBox="0 0 24 24"><path d="M4 20h16"/><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/></svg>',
  'split-left': '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/><path d="M6.5 10v4"/><path d="M4.5 12h4"/></svg>',
  'split-right':'<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/><path d="M17.5 10v4"/><path d="M15.5 12h4"/></svg>',
  'split-up':   '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17"/><path d="M12 6v3"/><path d="M10.5 7.5h3"/></svg>',
  'split-down': '<svg viewBox="0 0 24 24"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M3.5 14h17"/><path d="M12 15.5v3"/><path d="M10.5 17h3"/></svg>',
  close:        '<svg viewBox="0 0 24 24"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
}

const LABELS: Record<string, string> = {
  'move-left':  'Move left',
  'move-right': 'Move right',
  'move-up':    'Move up',
  'move-down':  'Move down',
  'split-left': 'Split left',
  'split-right':'Split right',
  'split-up':   'Split up',
  'split-down': 'Split down',
  close:        'Close panel (Ctrl+W)',
}

export function createDockToolbar(dockView: DockView): HTMLElement {
  const toolbar = document.createElement('div')
  toolbar.className = 'sb-dock-toolbar'

  const title = document.createElement('span')
  title.className = 'sb-dock-toolbar-title'
  title.textContent = 'Dock'
  toolbar.appendChild(title)

  const moveGroup = makeGroup('Move', ['move-left', 'move-right', 'move-up', 'move-down'])
  const splitGroup = makeGroup('Split', ['split-left', 'split-right', 'split-up', 'split-down'])
  const closeBtn = makeButton('close', () => dockView.closeFocusedPanel())

  toolbar.appendChild(moveGroup)
  toolbar.appendChild(splitGroup)
  toolbar.appendChild(closeBtn)

  const buttons = new Map<string, HTMLButtonElement>()
  toolbar.querySelectorAll('button[data-action]').forEach(b => {
    const action = (b as HTMLButtonElement).dataset.action!
    buttons.set(action, b as HTMLButtonElement)
  })

  function refresh() {
    for (const [action, btn] of buttons) {
      if (action.startsWith('move-')) {
        const dir = action.slice('move-'.length) as DockEdge
        btn.disabled = !dockView.canMove(dir)
      } else if (action.startsWith('split-')) {
        const dir = action.slice('split-'.length) as DockEdge
        btn.disabled = !dockView.canSplit(dir)
      } else if (action === 'close') {
        const g = dockView.getFocusedGroup()
        btn.disabled = !g || !g.activeId
      }
    }
  }

  dockView.addEventListener('focuschange', refresh)
  dockView.addEventListener('dockchange', refresh)
  // Initial state once the dock is mounted and rendered
  setTimeout(refresh, 0)

  return toolbar

  function makeGroup(name: string, actions: string[]) {
    const wrap = document.createElement('div')
    wrap.className = 'sb-dock-toolgroup'
    wrap.setAttribute('role', 'group')
    wrap.setAttribute('aria-label', name)
    actions.forEach(action => wrap.appendChild(makeButton(action)))
    return wrap
  }

  function makeButton(action: string, onClick?: () => void) {
    const btn = document.createElement('button')
    btn.className = 'sb-dock-tbtn'
    btn.dataset.action = action
    btn.title = LABELS[action] ?? action
    btn.innerHTML = ICONS[action] ?? ''
    btn.addEventListener('click', onClick ?? (() => {
      const [kind, dir] = action.split('-') as ['move' | 'split' | 'close', DockEdge]
      if (kind === 'move') dockView.moveFocusedGroup(dir)
      else if (kind === 'split') dockView.splitFocusedGroup(dir)
    }))
    return btn
  }
}
