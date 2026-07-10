import { colorFor } from '@winstonfassett/vizform-core'
import type { VizNode, Rollup } from '../types'

export interface TreeDatum {
  id: string
  children?: TreeDatum[]
}

export function childrenOf(nodes: VizNode[], parentId: string | null): VizNode[] {
  return nodes.filter(n => n.parentId === parentId).sort((a, b) => a.index - b.index)
}

export function descendantsOf(nodes: VizNode[], rootId: string): VizNode[] {
  const out: VizNode[] = []
  const stack = [rootId]
  while (stack.length) {
    const cur = stack.pop()!
    for (const n of nodes) {
      if (n.parentId === cur) {
        out.push(n)
        stack.push(n.id)
      }
    }
  }
  return out
}

export function leavesOf(nodes: VizNode[]): VizNode[] {
  const hasChild = new Set(nodes.map(n => n.parentId).filter((p): p is string => !!p))
  return nodes.filter(n => !hasChild.has(n.id))
}

export function rollupMeasurement(
  nodes: VizNode[],
  rootId: string,
  key: string,
  rollup: Rollup = 'sum',
): number {
  if (rollup === 'none') return nodes.find(n => n.id === rootId)?.measures[key] ?? 0
  const own = nodes.find(n => n.id === rootId)?.measures[key]
  const kids = descendantsOf(nodes, rootId)
    .map(n => n.measures[key])
    .filter((v): v is number => v != null)
  const all = own != null ? [own, ...kids] : kids
  if (all.length === 0) return 0
  if (rollup === 'max') return Math.max(...all)
  if (rollup === 'mean') return all.reduce((a, b) => a + b, 0) / all.length
  return all.reduce((a, b) => a + b, 0)
}

export function nodeColor(nodes: VizNode[], id: string): string {
  const byId = new Map(nodes.map(n => [n.id, n]))
  let cur = byId.get(id)
  let root = cur
  while (cur) {
    if (cur.color) return cur.color
    root = cur
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return colorFor(root?.name ?? id)
}

export function buildColorMap(nodes: VizNode[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const n of nodes) m.set(n.id, nodeColor(nodes, n.id))
  return m
}

export function buildNameMap(nodes: VizNode[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const n of nodes) m.set(n.id, n.name)
  return m
}

// Build a tree datum rooted at __root__ for d3-hierarchy.
// Leaf value = own measurement[measureKey]; internal nodes sum children.
export function buildTree(nodes: VizNode[], measureKey: string): TreeDatum {
  const byParent = new Map<string | null, VizNode[]>()
  for (const n of nodes) {
    const arr = byParent.get(n.parentId) ?? []
    arr.push(n)
    byParent.set(n.parentId, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.index - b.index)

  function build(id: string): TreeDatum {
    const kids = (byParent.get(id) ?? []).map(k => build(k.id))
    return kids.length ? { id, children: kids } : { id }
  }

  const roots = (byParent.get(null) ?? []).map(r => build(r.id))
  return { id: '__root__', children: roots }
}

export function measureValue(nodes: VizNode[], id: string, measureKey: string): number {
  return nodes.find(n => n.id === id)?.measures[measureKey] ?? 0
}
