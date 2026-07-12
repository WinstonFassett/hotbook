import { colorFor } from '../colors'
import type { VizNode, GroupingRule, SingleGrouping } from '../types'

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

const NONE_VALUE = '(none)'

function valueForField(node: VizNode, field: string): string {
  return node.dims[field] ?? NONE_VALUE
}

function aggregateLeaves(leaves: VizNode[], measureKey: string, aggregation: 'sum' | 'max' | 'mean' | 'min' = 'sum'): number {
  const values = leaves.map(l => l.measures[measureKey] ?? 0).filter(v => !Number.isNaN(v))
  if (values.length === 0) return 0
  if (aggregation === 'max') return Math.max(...values)
  if (aggregation === 'min') return Math.min(...values)
  if (aggregation === 'mean') return values.reduce((a, b) => a + b, 0) / values.length
  return values.reduce((a, b) => a + b, 0)
}

function sortGroupValues(values: string[], grouping: SingleGrouping): string[] {
  const { field, orderBy, aggregation, dir, customOrder } = grouping
  if (orderBy && orderBy !== field) {
    // measure sort: caller will supply aggregate per value; we sort by the value itself here
    // and let the caller order using the aggregate. This function only handles non-measure sorts.
  }
  const order = customOrder ?? []
  const sorted = values.slice().sort((a, b) => {
    if (a === NONE_VALUE && b !== NONE_VALUE) return 1
    if (b === NONE_VALUE && a !== NONE_VALUE) return -1
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    if (ia !== -1 && ib !== -1) return ia - ib
    if (ia !== -1) return -1
    if (ib !== -1) return 1
    return a.localeCompare(b)
  })
  if (dir === 'desc') sorted.reverse()
  return sorted
}

function reindexByPreOrder(nodes: VizNode[]): VizNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const childrenByParent = new Map<string | null, VizNode[]>()
  for (const n of nodes) {
    const arr = childrenByParent.get(n.parentId) ?? []
    arr.push(n)
    childrenByParent.set(n.parentId, arr)
  }

  const out: VizNode[] = []
  let idx = 0
  function visit(parentId: string | null) {
    const children = (childrenByParent.get(parentId) ?? []).slice()
    children.sort((a, b) => a.index - b.index)
    for (const child of children) {
      child.index = idx++
      out.push(child)
      visit(child.id)
    }
  }
  visit(null)

  for (const n of nodes) {
    if (!out.includes(n)) {
      n.index = idx++
      out.push(n)
    }
  }
  return out
}

/**
 * Apply dynamic grouping rules to a flat list of VizNodes.
 *
 * v1 supports top-level grouping only (level: 0). Group nodes are inserted
 * above the original root nodes; nested groupings add layers inside each
 * outer group. Group nodes get deterministic IDs based on the path so drill
 * and breadcrumbs remain stable, and indices are rewritten in pre-order so
 * buildBiTree / buildHierarchy ordering picks it up.
 *
 * @param nodes - Original VizNode array
 * @param rules - Grouping rules (v1 uses the first level === 0 rule)
 * @returns New array with synthetic group nodes inserted
 */
export function applyGroupings(nodes: VizNode[], rules: GroupingRule[]): VizNode[] {
  if (!rules || rules.length === 0) return nodes
  const rule = rules.find(r => r.level === 0) ?? rules[0]
  if (!rule || !rule.groupings || rule.groupings.length === 0) return nodes

  const allNodes = nodes.map(n => ({ ...n }))

  // Pre-compute leaf descendants for each node using the original tree shape.
  const byId = new Map(allNodes.map(n => [n.id, n]))
  const childrenByParent = new Map<string | null, VizNode[]>()
  for (const n of allNodes) {
    const arr = childrenByParent.get(n.parentId) ?? []
    arr.push(n)
    childrenByParent.set(n.parentId, arr)
  }
  const leafDescendants = new Map<string, VizNode[]>()
  function getLeafDescendants(id: string): VizNode[] {
    if (leafDescendants.has(id)) return leafDescendants.get(id)!
    const children = childrenByParent.get(id) ?? []
    if (children.length === 0) {
      leafDescendants.set(id, [byId.get(id)!])
    } else {
      const leaves: VizNode[] = []
      for (const c of children) leaves.push(...getLeafDescendants(c.id))
      leafDescendants.set(id, leaves)
    }
    return leafDescendants.get(id)!
  }
  for (const n of allNodes) getLeafDescendants(n.id)

  function leavesOfMembers(members: VizNode[]): VizNode[] {
    const leaves: VizNode[] = []
    for (const m of members) leaves.push(...getLeafDescendants(m.id))
    return leaves
  }

  function groupColor(members: VizNode[], val: string): string {
    const leaves = leavesOfMembers(members)
    const colors = new Set([...members, ...leaves].map(m => m.color).filter((c): c is string => !!c))
    if (colors.size === 1) return [...colors][0]!
    return colorFor(val)
  }

  function groupMeasure(members: VizNode[], grouping: SingleGrouping): number | undefined {
    const { orderBy, field, aggregation } = grouping
    if (!orderBy || orderBy === field) return undefined
    const leaves = leavesOfMembers(members)
    return aggregateLeaves(leaves, orderBy, aggregation ?? 'sum')
  }

  function groupNodesFor(parentId: string | null, children: VizNode[], grouping: SingleGrouping): VizNode[] {
    const membersByValue = new Map<string, VizNode[]>()
    for (const child of children) {
      const val = valueForField(child, grouping.field)
      const arr = membersByValue.get(val) ?? []
      arr.push(child)
      membersByValue.set(val, arr)
    }

    // Compute aggregates for each value so group nodes can be sorted by measure.
    const values = Array.from(membersByValue.keys())
    const sortedValues = sortGroupValues(values, grouping)
    if (grouping.orderBy && grouping.orderBy !== grouping.field) {
      sortedValues.sort((a, b) => {
        const ma = groupMeasure(membersByValue.get(a)!, grouping)
        const mb = groupMeasure(membersByValue.get(b)!, grouping)
        return (ma ?? 0) - (mb ?? 0)
      })
      if (grouping.dir === 'desc') sortedValues.reverse()
    }

    const groups: VizNode[] = []
    for (const val of sortedValues) {
      const members = membersByValue.get(val)!
      const groupId = parentId == null ? `__grp__${grouping.field}__${val}` : `__grp__${parentId}__${grouping.field}__${val}`
      const measures: Record<string, number> = {}
      const measure = groupMeasure(members, grouping)
      if (measure !== undefined) measures[grouping.orderBy!] = measure
      const groupNode: VizNode = {
        id: groupId,
        parentId,
        index: -1,
        name: val,
        measures,
        dims: { [grouping.field]: val },
        color: groupColor(members, val),
      }
      groups.push(groupNode)
      for (const m of members) m.parentId = groupId
    }
    return groups
  }

  let currentParentIds: (string | null)[] = [null]
  for (const grouping of rule.groupings) {
    const nextParentIds: (string | null)[] = []
    const childrenByParentLocal = new Map<string | null, VizNode[]>()
    for (const n of allNodes) {
      const arr = childrenByParentLocal.get(n.parentId) ?? []
      arr.push(n)
      childrenByParentLocal.set(n.parentId, arr)
    }
    for (const parentId of currentParentIds) {
      const children = childrenByParentLocal.get(parentId) ?? []
      if (children.length === 0) continue
      const groups = groupNodesFor(parentId, children, grouping)
      allNodes.push(...groups)
      nextParentIds.push(...groups.map(g => g.id))
    }
    currentParentIds = nextParentIds
  }

  return reindexByPreOrder(allNodes)
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
