/**
 * createShell — new dockview-core–backed dock shell.
 *
 * Stage 1: scaffold only. Panel content is a placeholder `<div>Panel {id}</div>`;
 * chart wiring lands in stage 2. The shell exposes only the raw dockview API
 * plus a dispose handle — no coupling to bireactive or hotbook state lives here.
 *
 * Keep-alive: `defaultRenderer: 'always'` plus dockview-core's OverlayRenderContainer
 * (implicit when `renderer: 'always'` is used) keeps hidden panels mounted so
 * charts don't remount on tab switch. See WIN-96 retro / WIN-111.
 */

import { createDockview } from 'dockview-core'
import type {
  DockviewApi,
  IContentRenderer,
  SerializedDockview,
  CreateComponentOptions,
} from 'dockview-core'

export interface ShellHandle {
  api: DockviewApi
  dispose: () => void
}

export interface ShellOptions {
  /** Optional serialized layout to restore. If omitted, caller adds panels manually. */
  initialLayout?: SerializedDockview
  /** Called whenever the layout changes; receives the serialized layout. */
  onLayoutChange?: (layout: SerializedDockview) => void
  /** Called when a panel is added. */
  onDidAddPanel?: (panelId: string) => void
  /** Called when a panel is removed. */
  onDidRemovePanel?: (panelId: string) => void
  /** Called when the active panel changes. */
  onDidActivePanelChange?: (panelId: string | undefined) => void
}

/**
 * Placeholder content renderer — `<div>Panel {id}</div>`. Stage 2 will replace
 * this with a chart-adapter factory.
 */
class PlaceholderRenderer implements IContentRenderer {
  readonly element: HTMLElement

  constructor(private readonly options: CreateComponentOptions) {
    const el = document.createElement('div')
    el.className = 'sb-shell-panel-placeholder'
    el.style.cssText = [
      'width:100%',
      'height:100%',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'color:#888',
      'font:14px/1.4 -apple-system, system-ui, sans-serif',
      'background:#141414',
    ].join(';')
    el.textContent = `Panel ${options.id}`
    this.element = el
  }

  init(): void {
    // No panel params to react to in stage 1.
  }
}

export function createShell(el: HTMLElement, options: ShellOptions = {}): ShellHandle {
  const api = createDockview(el, {
    // Keep-alive: hidden panels stay mounted, rendered through the overlay
    // container. Chart state (zoom, drill, in-flight animations) survives
    // tab / group changes.
    defaultRenderer: 'always',
    theme: undefined,
    createComponent: (opts) => new PlaceholderRenderer(opts),
  })

  const disposables: Array<{ dispose: () => void }> = []

  if (options.onDidAddPanel) {
    disposables.push(api.onDidAddPanel(p => options.onDidAddPanel!(p.id)))
  }
  if (options.onDidRemovePanel) {
    disposables.push(api.onDidRemovePanel(p => options.onDidRemovePanel!(p.id)))
  }
  if (options.onDidActivePanelChange) {
    disposables.push(api.onDidActivePanelChange(e => options.onDidActivePanelChange!(e.panel?.id)))
  }
  if (options.onLayoutChange) {
    disposables.push(api.onDidLayoutChange(() => options.onLayoutChange!(api.toJSON())))
  }

  if (options.initialLayout) {
    api.fromJSON(options.initialLayout)
  }

  return {
    api,
    dispose: () => {
      for (const d of disposables) d.dispose()
      api.dispose()
    },
  }
}
