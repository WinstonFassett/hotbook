import { colorFor } from '../colors'
import type { VizNode } from '../types'

/**
 * TreeNode — minimal tree structure for d3-hierarchy and drill path operations.
 * Parallel to bireactive TreeNode but data-only (no reactivity).
 */
export interface TreeNode {
  id: string
  children?: TreeNode[]
}

/**
 * Build a tree datum rooted at __root__ for d3-hierarchy.
 * Leaf value = own measurement[measureKey]; internal nodes sum children.
 *
 * Takes a flat VizNode array with parentId references and builds a hierarchical
 * TreeNode structure. Roots become direct children of a synthetic __root__ node.
 *
 * @param rows - Flat array of VizNode objects with parentId references
 * @param measureKey - Primary measure key (used for D3 value)
 * @returns Tree structure with __root__ at the top
 */
export function buildTree(rows: VizNode[], measureKey: string): TreeNode {
  const byParent = new Map<string | null, VizNode[]>()
  for (const n of rows) {
    const arr = byParent.get(n.parentId) ?? []
    arr.push(n)
    byParent.set(n.parentId, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.index - b.index)

  function build(id: string): TreeNode {
    const kids = (byParent.get(id) ?? []).map(k => build(k.id))
    return kids.length ? { id, children: kids } : { id }
  }

  const roots = (byParent.get(null) ?? []).map(r => build(r.id))
  return { id: '__root__', children: roots }
}

/**
 * Apply a groupBy dimension to a flat list of rows.
 *
 * Given a flat list of rows and a dim key, inserts virtual group-parent nodes
 * so the viz sees a two-level tree: group → leaf. Rows that already have a
 * parentId are passed through unchanged (groupBy only affects root-level rows).
 *
 * @param rows - VizNode array (typically flat, but non-root nodes are preserved)
 * @param dimKey - Dimension key to group by (e.g., 'group', 'season', 'status')
 * @returns New array with virtual group parents inserted above roots
 */
export function applyView(rows: VizNode[], dimKey: string): VizNode[] {
  const roots = rows.filter(r => !r.parentId)
  const nonRoots = rows.filter(r => r.parentId)

  const groups = new Map<string, string>() // dimValue → virtual node id
  const groupNodes: VizNode[] = []
  let gi = 0

  for (const r of roots) {
    const val = r.dims[dimKey] ?? '(none)'
    if (!groups.has(val)) {
      const gid = `__grp__${dimKey}__${val}`
      groups.set(val, gid)
      // Color the synthetic group by its members' shared color so the inner ring
      // matches the outer ring (members carry explicit hues in flat datasets).
      // Fall back to a palette pick from the group name when members are uncolored.
      const members = roots.filter(m => (m.dims[dimKey] ?? '(none)') === val)
      const memberColors = new Set(members.map(m => m.color).filter(Boolean))
      const groupColor = memberColors.size === 1 ? members.find(m => m.color)!.color! : colorFor(val)
      groupNodes.push({ id: gid, parentId: null, index: gi, name: val, measures: {}, dims: {}, color: groupColor })
      gi++
    }
  }

  const regrouped = roots.map(r => ({
    ...r,
    parentId: groups.get(r.dims[dimKey] ?? '(none)') ?? null,
  }))

  return [...groupNodes, ...regrouped, ...nonRoots]
}

/**
 * Walk a node's parent chain via VizNode.parentId until a root is reached.
 *
 * Returns [root, ..., node] — empty if drillNodeId is null or not found.
 * Useful for breadcrumbs.
 *
 * @param rows - VizNode array to search through
 * @param drillNodeId - ID of target node (or null to return empty array)
 * @returns Array of VizNodes from root to target; empty if not found
 */
export function drillPath(rows: VizNode[], drillNodeId: string | null): VizNode[] {
  if (!drillNodeId) return []
  const byId = new Map(rows.map(n => [n.id, n]))
  const target = byId.get(drillNodeId)
  if (!target) return []
  const path: VizNode[] = []
  let cur: VizNode | undefined = target
  while (cur) {
    path.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return path
}

/**
 * Get all leaf nodes from a tree.
 *
 * A leaf is a node with no children in the array (no other node has its id as parentId).
 *
 * @param rows - VizNode array
 * @returns All leaf VizNodes
 */
export function leavesOf(rows: VizNode[]): VizNode[] {
  const hasChild = new Set(rows.map(n => n.parentId).filter((p): p is string => !!p))
  return rows.filter(n => !hasChild.has(n.id))
}
