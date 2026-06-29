// Split-tree layout primitives for sliceboard. An alternative to the
// react-grid-layout grid: tiles live as leaves of a binary-ish tree of
// row/column splits with proportional sibling sizing.
//
// Tree shape:
//   Leaf  = { kind: 'leaf', tileId }
//   Split = { kind: 'split', direction: 'row' | 'col', sizes[], children[] }
// Sizes are flex weights (positive numbers); the renderer uses them as
// `flex-grow` so absolute values don't matter — ratios do.

export type SplitDir = 'row' | 'col'

export type SplitNode = SplitLeaf | SplitBranch
export interface SplitLeaf { kind: 'leaf'; id: string; tileId: string }
export interface SplitBranch {
  kind: 'split'
  id: string
  direction: SplitDir
  sizes: number[]
  children: SplitNode[]
}

function nid(): string { return Math.random().toString(36).slice(2, 10) }

export function makeLeaf(tileId: string): SplitLeaf {
  return { kind: 'leaf', id: nid(), tileId }
}

export function makeSplit(direction: SplitDir, children: SplitNode[], sizes?: number[]): SplitBranch {
  const s = sizes && sizes.length === children.length ? sizes : children.map(() => 1)
  return { kind: 'split', id: nid(), direction, children, sizes: s }
}

/** Build a default tree from a flat tile list: a single horizontal row of leaves. */
export function defaultTree(tileIds: string[]): SplitNode | null {
  if (tileIds.length === 0) return null
  if (tileIds.length === 1) return makeLeaf(tileIds[0]!)
  return makeSplit('row', tileIds.map(makeLeaf))
}

/** Collect tileIds present in the tree, in left-to-right order. */
export function leafTileIds(node: SplitNode | null | undefined): string[] {
  if (!node) return []
  if (node.kind === 'leaf') return [node.tileId]
  const out: string[] = []
  for (const c of node.children) out.push(...leafTileIds(c))
  return out
}

/** Append a tile as a new leaf at the root level. Creates/extends a row split. */
export function appendTile(node: SplitNode | null, tileId: string): SplitNode {
  const leaf = makeLeaf(tileId)
  if (!node) return leaf
  if (node.kind === 'leaf') return makeSplit('row', [node, leaf])
  return {
    ...node,
    children: [...node.children, leaf],
    sizes: [...node.sizes, average(node.sizes)],
  }
}

function average(xs: number[]): number {
  if (xs.length === 0) return 1
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Remove a tile from the tree, collapsing parents that become trivial. Returns
 *  null if the whole tree becomes empty. */
export function removeTile(node: SplitNode | null, tileId: string): SplitNode | null {
  if (!node) return null
  if (node.kind === 'leaf') return node.tileId === tileId ? null : node
  const kept: SplitNode[] = []
  const keptSizes: number[] = []
  node.children.forEach((c, i) => {
    const r = removeTile(c, tileId)
    if (r) { kept.push(r); keptSizes.push(node.sizes[i] ?? 1) }
  })
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0]!
  return { ...node, children: kept, sizes: keptSizes }
}

/** Bring the tree in sync with the canonical tile list — drop leaves whose
 *  tileId no longer exists, append any tile not yet represented as a leaf,
 *  preserving the existing arrangement and sizes for surviving leaves. */
export function reconcile(node: SplitNode | null, tileIds: string[]): SplitNode | null {
  const valid = new Set(tileIds)
  let pruned = pruneInvalid(node, valid)
  const have = new Set(leafTileIds(pruned))
  for (const id of tileIds) {
    if (!have.has(id)) pruned = appendTile(pruned, id)
  }
  return pruned
}

function pruneInvalid(node: SplitNode | null, valid: Set<string>): SplitNode | null {
  if (!node) return null
  if (node.kind === 'leaf') return valid.has(node.tileId) ? node : null
  const kept: SplitNode[] = []
  const keptSizes: number[] = []
  node.children.forEach((c, i) => {
    const r = pruneInvalid(c, valid)
    if (r) { kept.push(r); keptSizes.push(node.sizes[i] ?? 1) }
  })
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0]!
  return { ...node, children: kept, sizes: keptSizes }
}

/** Update a single split's sizes by id. Returns the same tree if not found. */
export function setSizes(node: SplitNode | null, splitId: string, sizes: number[]): SplitNode | null {
  if (!node) return null
  if (node.kind === 'leaf') return node
  if (node.id === splitId) return { ...node, sizes: normalize(sizes, node.children.length) }
  return { ...node, children: node.children.map(c => setSizes(c, splitId, sizes) as SplitNode) }
}

function normalize(sizes: number[], n: number): number[] {
  const xs = sizes.slice(0, n).map(s => Math.max(0.01, s))
  while (xs.length < n) xs.push(1)
  return xs
}

/** Split a specific leaf in-place: replace it with a 2-child split. */
export function splitLeaf(
  node: SplitNode | null,
  leafId: string,
  direction: SplitDir,
  newTileId: string,
  position: 'before' | 'after' = 'after',
): SplitNode | null {
  if (!node) return null
  if (node.kind === 'leaf') {
    if (node.id !== leafId) return node
    const newLeaf = makeLeaf(newTileId)
    const children = position === 'after' ? [node, newLeaf] : [newLeaf, node]
    return makeSplit(direction, children)
  }
  return { ...node, children: node.children.map(c => splitLeaf(c, leafId, direction, newTileId, position) as SplitNode) }
}
