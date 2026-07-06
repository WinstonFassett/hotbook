/**
 * url-layout.ts — URL-based layout serialization for WIN-134.
 *
 * Enables declarative, shareable layout via URL query param `?layout=...`.
 * Format is compact and hand-writable for test fixtures and demos.
 *
 * Example URLs:
 *   ?layout=treetable|bar              → two-pane split (treetable left, bar right)
 *   ?layout=scatter,treemap            → two-pane split (scatter left, treemap right)
 *   ?layout=(bar+line)|scatter         → left group has bar+line tabs, right has scatter
 *   ?layout=bar|(scatter+treemap)      → right group has scatter+treemap tabs
 *
 * Grammar (simplified):
 *   layout   := pane ( '|' pane )*     # horizontal split
 *   pane     := group | tile
 *   group    := '(' tiles ')'
 *   tiles    := tile ( '+' tile )*     # tabs within a group
 *   tile     := [a-z0-9-]+             # chart kind
 *
 * The serializer maps DockNode trees to this compact DSL. The parser builds
 * DockNode trees from the DSL, creating tiles on demand if they don't exist.
 */

import type { DockNode, DockGroup, DockPanel } from './dock'
import { makeGroup, makeSplit, makePanel } from './dock'
import type { TileKind, Dashboard, Tile } from './persistence'

// ─── Serialize ────────────────────────────────────────────────────────────────

/** Serialize a dock tree to a layout string suitable for URL ?layout=...
 *  Requires a tile lookup to map tile IDs to kinds for hand-writable output. */
export function serializeLayout(dock: DockNode | null, tiles: Tile[]): string {
  if (!dock) return ''
  const tileMap = new Map(tiles.map(t => [t.id, t]))
  return serializeNode(dock, tileMap)
}

function serializeNode(node: DockNode, tileMap: Map<string, Tile>): string {
  if (node.kind === 'group') {
    return serializeGroup(node, tileMap)
  }
  // Split — row means horizontal '|', col means vertical '/' (not used in current
  // design but reserved for future)
  const sep = node.direction === 'row' ? '|' : '/'
  return node.children.map(c => serializeNode(c, tileMap)).join(sep)
}

function serializeGroup(group: DockGroup, tileMap: Map<string, Tile>): string {
  if (group.panels.length === 0) return ''
  const kinds = group.panels.map(p => {
    const tile = tileMap.get(p.tileId)
    return tile?.kind ?? p.tileId
  })
  if (kinds.length === 1) {
    return kinds[0]!
  }
  // Multiple panels → tabs, wrap in parens
  return `(${kinds.join('+')})`
}

// ─── Parse ────────────────────────────────────────────────────────────────────

/** Expand shorthand chart names to full TileKind.
 *  bar → br-lc-bar, line → br-lc-line, etc. */
function expandShorthand(kindStr: string): TileKind {
  // Common shorthands
  const shorthands: Record<string, TileKind> = {
    'bar': 'br-lc-bar',
    'line': 'br-lc-line',
    'area': 'br-lc-area',
    'scatter': 'br-lc-scatter',
    'pie': 'br-lc-pie',
    'radar': 'br-lc-radar',
    'pack': 'br-lc-pack',
    'treemap': 'br-lc-treemap',
    'icicle': 'br-lc-icicle',
    'sunburst': 'br-lc-sunburst',
    'sankey': 'br-lc-sankey',
    'tree': 'br-lc-tree',
    'gantt': 'br-lc-gantt',
  }
  return (shorthands[kindStr] || kindStr) as TileKind
}

/** Parse a layout string into a DockNode tree. Tiles referenced in the layout
 *  that don't exist in the dashboard will be reported as missing kinds. The caller
 *  should add those tiles to the workspace before hydrating the layout. */
export function parseLayout(
  layoutStr: string,
  tiles: Tile[],
): { dock: DockNode | null; missingKinds: TileKind[] } {
  if (!layoutStr.trim()) return { dock: null, missingKinds: [] }

  const tilesByKind = new Map<TileKind, Tile>()
  tiles.forEach(t => {
    if (!tilesByKind.has(t.kind)) tilesByKind.set(t.kind, t)
  })

  const missingKinds: TileKind[] = []
  const missingKindsSeen = new Set<TileKind>()

  // Resolve a tile reference (kind string) to a tileId
  function resolveTile(kindStr: string): string | null {
    const kind = expandShorthand(kindStr)
    const existingTile = tilesByKind.get(kind)
    if (existingTile) return existingTile.id
    // Mark as missing
    if (!missingKindsSeen.has(kind)) {
      missingKindsSeen.add(kind)
      missingKinds.push(kind)
    }
    return null
  }

  function genId(): string {
    return Math.random().toString(36).slice(2, 10)
  }

  // Tokenizer
  type Token = { type: '|' | '/' | '(' | ')' | '+' | 'id'; value: string }
  function tokenize(s: string): Token[] {
    const tokens: Token[] = []
    let i = 0
    while (i < s.length) {
      const c = s[i]!
      if (c === '|' || c === '/' || c === '(' || c === ')' || c === '+') {
        tokens.push({ type: c as any, value: c })
        i++
      } else if (/\s/.test(c)) {
        i++
      } else {
        // ID token (tile kind or tile ID)
        let id = ''
        while (i < s.length && /[a-z0-9-]/.test(s[i]!)) {
          id += s[i]!
          i++
        }
        if (id) tokens.push({ type: 'id', value: id })
      }
    }
    return tokens
  }

  // Parser (recursive descent)
  const tokens = tokenize(layoutStr)
  let pos = 0

  function peek(): Token | null {
    return tokens[pos] ?? null
  }

  function advance(): Token | null {
    return tokens[pos++] ?? null
  }

  function expect(type: Token['type']): Token {
    const t = advance()
    if (!t || t.type !== type) {
      const context = tokens.slice(Math.max(0, pos - 3), pos + 2).map(tk => tk.value).join('')
      throw new Error(`Expected ${type}, got ${t?.type ?? 'EOF'} at position ${pos} (context: "${context}")`)
    }
    return t
  }

  // layout := pane ( '|' pane )*
  function parseLayout(): DockNode | null {
    const panes: DockNode[] = []
    const pane1 = parsePane()
    if (pane1) panes.push(pane1)
    while (peek()?.type === '|') {
      advance() // consume '|'
      const pane = parsePane()
      if (pane) panes.push(pane)
    }
    if (panes.length === 0) return null
    if (panes.length === 1) return panes[0]!
    return makeSplit('row', panes)
  }

  // pane := group | tile
  function parsePane(): DockNode | null {
    if (peek()?.type === '(') {
      return parseGroup()
    }
    return parseTile()
  }

  // group := '(' tiles ')'
  // tiles := tile ( '+' tile )*
  function parseGroup(): DockGroup | null {
    expect('(')
    const panels: DockPanel[] = []
    const panel1 = makePanelFromId(expect('id').value)
    if (panel1) panels.push(panel1)
    while (peek()?.type === '+') {
      advance() // consume '+'
      const panel = makePanelFromId(expect('id').value)
      if (panel) panels.push(panel)
    }
    expect(')')
    return panels.length > 0 ? makeGroup(panels) : null
  }

  // tile := id
  function parseTile(): DockGroup | null {
    const kindStr = expect('id').value
    const panel = makePanelFromId(kindStr)
    return panel ? makeGroup([panel]) : null
  }

  function makePanelFromId(kindStr: string): DockPanel | null {
    const tileId = resolveTile(kindStr)
    return tileId ? makePanel(tileId) : null
  }

  try {
    const dock = parseLayout()
    if (pos < tokens.length) {
      console.warn(`[url-layout] Unexpected tokens after layout: ${tokens.slice(pos).map(t => t.value).join('')}`)
    }
    return { dock, missingKinds }
  } catch (e) {
    console.error('[url-layout] Failed to parse layout:', e)
    return { dock: null, missingKinds: [] }
  }
}

// ─── URL integration ──────────────────────────────────────────────────────────

/** Read layout from URL query param ?layout=... */
export function readLayoutFromURL(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('layout')
}

/** Write layout to URL query param ?layout=..., preserving other params.
 *  Uses replaceState so it doesn't add history entries on every layout change. */
export function writeLayoutToURL(layoutStr: string): void {
  const url = new URL(window.location.href)
  if (layoutStr) {
    url.searchParams.set('layout', layoutStr)
  } else {
    url.searchParams.delete('layout')
  }
  window.history.replaceState({}, '', url.toString())
}
