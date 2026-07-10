/**
 * url-layout.ts — URL layout parser for fixture-based layouts (WIN-191).
 *
 * Reads `?layout=...` on boot to hydrate deterministic pane arrangements for
 * test fixtures (R2 harness, WIN-131) and demos. The URL does NOT update as
 * the user arranges panes — that half was removed in WIN-191.
 *
 * Example URLs:
 *   ?layout=treetable|bar              → two-pane split (treetable left, bar right)
 *   ?layout=(bar%2Bline)|scatter       → left group has bar+line tabs, right has scatter
 *   ?layout=bar|(scatter%2Btreemap)    → right group has scatter+treemap tabs
 *
 * NOTE: The `+` character MUST be URL-encoded as `%2B` in query strings,
 * otherwise browsers decode it as a space.
 *
 * Grammar (simplified):
 *   layout   := pane ( '|' pane )*     # horizontal split
 *   pane     := group | tile
 *   group    := '(' tiles ')'
 *   tiles    := tile ( '+' tile )*     # tabs within a group
 *   tile     := [a-z0-9-]+             # chart kind
 *
 * The parser builds DockNode trees from the DSL, creating tiles on demand if
 * they don't exist.
 */

import type { DockNode, DockGroup, DockPanel } from './dock'
import { makeGroup, makeSplit, makePanel } from './dock'
import type { TileKind, Dashboard, Tile } from './persistence'

// ─── Parse ────────────────────────────────────────────────────────────────────

// Common shorthands
const shorthands: Record<string, TileKind> = {
  'treetable': 'br-lc-treetable',
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

const reverseShorthands: Record<TileKind, string> = {} as Record<TileKind, string>
for (const [short, kind] of Object.entries(shorthands)) {
  reverseShorthands[kind as TileKind] = short
}

/** Expand shorthand chart names to full TileKind.
 *  bar → br-lc-bar, line → br-lc-line, etc. */
function expandShorthand(kindStr: string): TileKind {
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

// ─── Serialize ─────────────────────────────────────────────────────────────────

function kindToString(kind: TileKind): string {
  return reverseShorthands[kind] ?? kind
}

/** Serialize a DockNode tree back to a layout string. */
export function serializeLayout(dock: DockNode | null, tiles: Tile[]): string {
  if (!dock) return ''
  const tilesById = new Map(tiles.map(t => [t.id, t]))

  function panelKind(panel: DockPanel): string {
    const tile = tilesById.get(panel.tileId)
    return tile ? kindToString(tile.kind) : panel.tileId
  }

  function groupToString(group: DockGroup): string {
    if (group.panels.length === 1) return panelKind(group.panels[0]!)
    return `(${group.panels.map(panelKind).join('+')})`
  }

  function nodeToString(node: DockNode): string {
    if (node.kind === 'group') return groupToString(node)
    const sep = node.direction === 'col' ? '/' : '|'
    return node.children.map(nodeToString).join(sep)
  }

  return nodeToString(dock)
}

// ─── URL integration ──────────────────────────────────────────────────────────

/** Read layout from URL query param ?layout=... */
export function readLayoutFromURL(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('layout')
}
