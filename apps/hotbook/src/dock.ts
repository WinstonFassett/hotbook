// Dockview-class layout primitives for sliceboard. Phase A of WIN-57.
//
// Tree shape:
//   Group = { kind: 'group', panels[], activeId }
//   Split = { kind: 'split', direction: 'row'|'col', sizes[], children }
//   Panel = { id, tileId }
// Sizes are flex weights; only ratios matter.
//
// Spec: wiki/dockview-spec.md. Operations here are atomic — every helper
// returns a new tree value and the old tree is the undo target.

export type DockDir = 'row' | 'col'
export type DockEdge = 'left' | 'right' | 'up' | 'down'

export type DockNode = DockSplit | DockGroup
export interface DockSplit {
  kind: 'split'
  id: string
  direction: DockDir
  sizes: number[]
  children: DockNode[]
}
export interface DockGroup {
  kind: 'group'
  id: string
  panels: DockPanel[]
  activeId: string | null
  maximized?: boolean
}
export interface DockPanel { id: string; tileId: string }

function nid(): string { return Math.random().toString(36).slice(2, 10) }

export function makePanel(tileId: string): DockPanel {
  return { id: nid(), tileId }
}

export function makeGroup(panels: DockPanel[], activeId?: string | null): DockGroup {
  const ps = panels.slice()
  const active = activeId ?? ps[0]?.id ?? null
  return { kind: 'group', id: nid(), panels: ps, activeId: active }
}

export function makeSplit(direction: DockDir, children: DockNode[], sizes?: number[]): DockSplit {
  const s = sizes && sizes.length === children.length ? sizes : children.map(() => 1)
  return { kind: 'split', id: nid(), direction, children, sizes: s }
}

/** Seed layout from a flat tile list.
 *  All tiles → single tabbed group (no preset split). */
export function defaultDockTree(tileIds: string[]): DockNode | null {
  if (tileIds.length === 0) return null
  return makeGroup(tileIds.map(makePanel))
}

/** Walk the tree and collect every group (depth-first, left-to-right). */
export function allGroups(node: DockNode | null): DockGroup[] {
  if (!node) return []
  if (node.kind === 'group') return [node]
  return node.children.flatMap(allGroups)
}

/** Find a panel anywhere in the tree. */
export function findPanel(node: DockNode | null, panelId: string): { group: DockGroup; index: number; panel: DockPanel } | null {
  if (!node) return null
  if (node.kind === 'group') {
    const i = node.panels.findIndex(p => p.id === panelId)
    if (i < 0) return null
    return { group: node, index: i, panel: node.panels[i]! }
  }
  for (const c of node.children) {
    const r = findPanel(c, panelId)
    if (r) return r
  }
  return null
}

/** Return every tileId referenced in the tree, dedup'd. */
export function leafTileIds(node: DockNode | null): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const g of allGroups(node)) {
    for (const p of g.panels) {
      if (!seen.has(p.tileId)) { seen.add(p.tileId); out.push(p.tileId) }
    }
  }
  return out
}

/** Map every group with a transform. Returns a new tree where transformed
 *  groups are replaced; splits are descended into. If `map` returns null, the
 *  group is dropped — its parent split is then auto-collapsed (see collapse). */
function mapGroups(node: DockNode | null, map: (g: DockGroup) => DockGroup | null): DockNode | null {
  if (!node) return null
  if (node.kind === 'group') return map(node)
  const kept: DockNode[] = []
  const keptSizes: number[] = []
  node.children.forEach((c, i) => {
    const r = mapGroups(c, map)
    if (r) { kept.push(r); keptSizes.push(node.sizes[i] ?? 1) }
  })
  return collapseSplit({ ...node, children: kept, sizes: keptSizes })
}

/** Replace a specific group by id, walking the tree. Returns the original if
 *  the group isn't found. */
function replaceGroup(node: DockNode | null, groupId: string, repl: DockNode | null): DockNode | null {
  if (!node) return null
  if (node.kind === 'group') return node.id === groupId ? repl : node
  const kept: DockNode[] = []
  const keptSizes: number[] = []
  let changed = false
  node.children.forEach((c, i) => {
    const r = replaceGroup(c, groupId, repl)
    if (r !== c) changed = true
    if (r) { kept.push(r); keptSizes.push(node.sizes[i] ?? 1) }
  })
  if (!changed) return node
  return collapseSplit({ ...node, children: kept, sizes: keptSizes })
}

/** Replace any node (group or split) by id. */
function replaceNode(node: DockNode | null, targetId: string, repl: DockNode | null): DockNode | null {
  if (!node) return null
  if (node.id === targetId) return repl
  if (node.kind === 'group') return node
  const kept: DockNode[] = []
  const keptSizes: number[] = []
  let changed = false
  node.children.forEach((c, i) => {
    const r = replaceNode(c, targetId, repl)
    if (r !== c) changed = true
    if (r) { kept.push(r); keptSizes.push(node.sizes[i] ?? 1) }
  })
  if (!changed) return node
  return collapseSplit({ ...node, children: kept, sizes: keptSizes })
}

/** Auto-collapse a split with 0 or 1 children — see spec §1.5. */
function collapseSplit(s: DockSplit): DockNode | null {
  if (s.children.length === 0) return null
  if (s.children.length === 1) return s.children[0]!
  return s
}

/** Add a tile to the layout. By default appends a new panel to the first
 *  group; if no group exists, seeds the tree. */
export function addTileToDock(node: DockNode | null, tileId: string, targetGroupId?: string): DockNode {
  const panel = makePanel(tileId)
  if (!node) return makeGroup([panel])
  const groups = allGroups(node)
  const targetId = targetGroupId ?? groups[0]?.id
  if (!targetId) return makeGroup([panel])
  const next = mapGroups(node, g => g.id === targetId ? { ...g, panels: [...g.panels, panel], activeId: panel.id } : g)
  return next ?? makeGroup([panel])
}

/** Remove every panel referring to the given tileId. Empty groups collapse. */
export function removeTileFromDock(node: DockNode | null, tileId: string): DockNode | null {
  return mapGroups(node, g => {
    const panels = g.panels.filter(p => p.tileId !== tileId)
    if (panels.length === 0) return null
    const activeId = g.activeId && panels.some(p => p.id === g.activeId) ? g.activeId : panels[0]!.id
    return { ...g, panels, activeId }
  })
}

/** Drop panels whose tileId is gone; append any tile not yet present as a new
 *  panel in the first group. Preserves all other arrangement. */
export function reconcile(node: DockNode | null, tileIds: string[]): DockNode | null {
  const valid = new Set(tileIds)
  const pruned = mapGroups(node, g => {
    const panels = g.panels.filter(p => valid.has(p.tileId))
    if (panels.length === 0) return null
    const activeId = g.activeId && panels.some(p => p.id === g.activeId) ? g.activeId : panels[0]!.id
    return { ...g, panels, activeId }
  })
  const have = new Set(leafTileIds(pruned))
  let next = pruned
  for (const id of tileIds) {
    if (!have.has(id)) next = addTileToDock(next, id)
  }
  return next
}

/** Set the active panel of a group. Only touches the target group's activeId;
 *  other groups keep their own tab selection unchanged. Keyboard focus tracking
 *  (which group is "active" for shortcuts) lives in DockView._focusedGroupId. */
export function setActive(node: DockNode | null, groupId: string, panelId: string): DockNode | null {
  return mapGroups(node, g => g.id === groupId ? { ...g, activeId: panelId } : g)
}

/** Remove a single panel from its group (dock-only — does not delete the tile
 *  from the workspace). Empty groups collapse via mapGroups. */
export function removePanel(node: DockNode | null, panelId: string): DockNode | null {
  return mapGroups(node, g => {
    if (!g.panels.some(p => p.id === panelId)) return g
    const panels = g.panels.filter(p => p.id !== panelId)
    if (panels.length === 0) return null
    const activeId = g.activeId === panelId
      ? (panels[0]?.id ?? null)
      : g.activeId
    return { ...g, panels, activeId }
  })
}

/** Move a panel to a target group at a specific index. Source group is
 *  collapsed if it becomes empty. If panelId already belongs to targetGroup,
 *  this is a reorder. */
export function movePanel(node: DockNode | null, panelId: string, targetGroupId: string, index: number): DockNode | null {
  if (!node) return null
  const found = findPanel(node, panelId)
  if (!found) return node
  const { panel } = found

  // First detach the panel from its source.
  const detached = mapGroups(node, g => {
    if (!g.panels.some(p => p.id === panelId)) return g
    const panels = g.panels.filter(p => p.id !== panelId)
    if (panels.length === 0) return null
    const activeId = g.activeId === panelId
      ? (panels[Math.min(found.index, panels.length - 1)]?.id ?? null)
      : g.activeId
    return { ...g, panels, activeId }
  })

  // Then insert into target.
  const targetGroup = allGroups(detached).find(g => g.id === targetGroupId)
  if (!targetGroup) {
    // Target group is gone (was the source's only panel and got collapsed).
    // In that case the panel is "lost" — re-insert at the root as a new group.
    return detached ? makeSplit('row', [detached, makeGroup([panel])]) : makeGroup([panel])
  }
  const i = Math.max(0, Math.min(index, targetGroup.panels.length))
  return mapGroups(detached, g => {
    if (g.id !== targetGroupId) return g
    const panels = [...g.panels.slice(0, i), panel, ...g.panels.slice(i)]
    return { ...g, panels, activeId: panel.id }
  })
}

/** Drop a panel onto another panel's edge: split the target's group and place
 *  the source panel into a new empty group on the requested side. */
export function dropOnEdge(node: DockNode | null, panelId: string, targetGroupId: string, edge: DockEdge): DockNode | null {
  if (!node) return null
  const found = findPanel(node, panelId)
  if (!found) return node
  const target = allGroups(node).find(g => g.id === targetGroupId)
  if (!target) return node
  if (found.group.id === targetGroupId && target.panels.length === 1) {
    // The source panel IS the only panel of the target — no-op.
    return node
  }
  const { panel } = found

  // Detach from source.
  const detached = mapGroups(node, g => {
    if (!g.panels.some(p => p.id === panelId)) return g
    const panels = g.panels.filter(p => p.id !== panelId)
    if (panels.length === 0) return null
    const activeId = g.activeId === panelId
      ? (panels[Math.min(found.index, panels.length - 1)]?.id ?? null)
      : g.activeId
    return { ...g, panels, activeId }
  })

  // The target group may have been collapsed away by detach (if both source
  // and target were the same single-panel group — covered above) or replaced
  // by a sibling. Re-find by id, then replace it with a 2-child split.
  if (!detached) return makeGroup([panel])
  const stillTarget = allGroups(detached).find(g => g.id === targetGroupId)
  if (!stillTarget) {
    // Target was collapsed (source was target's sibling-only). Just reattach.
    return makeSplit('row', [detached, makeGroup([panel])])
  }
  const newGroup = makeGroup([panel])
  const direction: DockDir = edge === 'left' || edge === 'right' ? 'row' : 'col'
  const placeAfter = edge === 'right' || edge === 'down'
  // 50/50 split by default
  const sizes = [1, 1]
  const split = makeSplit(direction, placeAfter ? [stillTarget, newGroup] : [newGroup, stillTarget], sizes)
  const result = replaceNode(detached, stillTarget.id, split)
  return result ?? detached
}

/** Resize a specific split's sibling weights. */
export function setSizes(node: DockNode | null, splitId: string, sizes: number[]): DockNode | null {
  if (!node) return null
  if (node.kind === 'group') return node
  if (node.id === splitId) return { ...node, sizes: normalize(sizes, node.children.length) }
  return { ...node, children: node.children.map(c => setSizes(c, splitId, sizes) as DockNode) }
}

function normalize(sizes: number[], n: number): number[] {
  const xs = sizes.slice(0, n).map(s => Math.max(0.01, s))
  while (xs.length < n) xs.push(1)
  return xs
}

/** Merge every leaf group under `splitId` into a single tabbed group at that
 *  split's position. The Split is replaced by one Group containing every
 *  panel underneath, in left-to-right order. Active panel becomes the first
 *  one. Used by the per-split "Unsplit" action. */
export function unsplit(node: DockNode | null, splitId: string): DockNode | null {
  if (!node) return null
  if (node.kind === 'group') return node
  if (node.id === splitId) {
    const panels = allGroups(node).flatMap(g => g.panels)
    if (panels.length === 0) return null
    return makeGroup(panels, panels[0]!.id)
  }
  const kept = node.children.map(c => unsplit(c, splitId) as DockNode)
  return { ...node, children: kept }
}

/** Migrate the legacy splits.ts SplitNode shape to the dock model: each leaf
 *  becomes a single-panel group. Returns null if input is null. */
export interface LegacySplitNode {
  kind: 'leaf' | 'split'
  id?: string
  tileId?: string
  direction?: DockDir
  sizes?: number[]
  children?: LegacySplitNode[]
}
export function migrateFromSplits(node: LegacySplitNode | null | undefined): DockNode | null {
  if (!node) return null
  if (node.kind === 'leaf') return makeGroup([makePanel(node.tileId!)])
  const children = (node.children ?? []).map(c => migrateFromSplits(c)).filter((x): x is DockNode => !!x)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]!
  return makeSplit(node.direction ?? 'row', children, node.sizes)
}

/** Toggle maximize state on a group. When maximized, the group renders
 *  full-bleed over the entire dockview surface. Only one group can be maximized
 *  at a time — maximizing a new one un-maximizes any others. */
export function toggleMaximize(node: DockNode | null, groupId: string): DockNode | null {
  if (!node) return null
  const target = allGroups(node).find(g => g.id === groupId)
  if (!target) return node
  const nowMax = !target.maximized
  // Un-maximize all other groups, then toggle the target.
  return mapGroups(node, g => ({ ...g, maximized: g.id === groupId ? nowMax : false }))
}

/** Find the currently maximized group, if any. */
export function findMaximizedGroup(node: DockNode | null): DockGroup | null {
  return allGroups(node).find(g => g.maximized) ?? null
}

/** Move an entire group to a target group's edge or merge with it (center drop).
 *  Similar to dropOnEdge for panels, but moves all panels from the source group. */
export function dropGroupOnEdge(node: DockNode | null, sourceGroupId: string, targetGroupId: string, edge: DockEdge): DockNode | null {
  if (!node) return null
  const source = allGroups(node).find(g => g.id === sourceGroupId)
  const target = allGroups(node).find(g => g.id === targetGroupId)
  if (!source || !target) return node
  if (source.id === target.id) return node // no-op: can't drop on self

  // Remove source group entirely
  const detached = mapGroups(node, g => g.id === sourceGroupId ? null : g)
  if (!detached) return makeGroup(source.panels, source.activeId)

  // Re-find target (may have shifted)
  const stillTarget = allGroups(detached).find(g => g.id === targetGroupId)
  if (!stillTarget) {
    // Target collapsed somehow — reattach as new split
    return makeSplit('row', [detached, source])
  }

  // Create split on requested edge. Target keeps 75%, source gets 25%.
  const direction: DockDir = edge === 'left' || edge === 'right' ? 'row' : 'col'
  const placeAfter = edge === 'right' || edge === 'down'
  const sizes = placeAfter ? [3, 1] : [1, 3]
  const split = makeSplit(direction, placeAfter ? [stillTarget, source] : [source, stillTarget], sizes)
  const result = replaceNode(detached, stillTarget.id, split)
  return result ?? detached
}

/** Move an entire group's panels into another group (center drop). */
export function mergeGroups(node: DockNode | null, sourceGroupId: string, targetGroupId: string): DockNode | null {
  if (!node) return null
  if (sourceGroupId === targetGroupId) return node
  const source = allGroups(node).find(g => g.id === sourceGroupId)
  if (!source) return node

  // Move all panels from source to target
  const panels = source.panels.slice()
  const detached = mapGroups(node, g => g.id === sourceGroupId ? null : g)
  if (!detached) return null

  return mapGroups(detached, g => {
    if (g.id !== targetGroupId) return g
    const merged = [...g.panels, ...panels]
    return { ...g, panels: merged, activeId: panels[0]?.id ?? g.activeId }
  })
}

/** Split a group horizontally (right) — VS Code Ctrl+\ behavior. Creates a new
 *  empty group to the right of the target. */
export function splitGroupRight(node: DockNode | null, groupId: string): DockNode | null {
  if (!node) return null
  const target = allGroups(node).find(g => g.id === groupId)
  if (!target) return node
  const newGroup = makeGroup([])
  const split = makeSplit('row', [target, newGroup])
  return replaceNode(node, groupId, split)
}

/** Split a group vertically (down) — VS Code Ctrl+K Ctrl+\ behavior. Creates a
 *  new empty group below the target. */
export function splitGroupDown(node: DockNode | null, groupId: string): DockNode | null {
  if (!node) return null
  const target = allGroups(node).find(g => g.id === groupId)
  if (!target) return node
  const newGroup = makeGroup([])
  const split = makeSplit('col', [target, newGroup])
  return replaceNode(node, groupId, split)
}
