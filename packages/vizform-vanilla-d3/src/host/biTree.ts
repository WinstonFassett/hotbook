/**
 * biTree.ts — bireactive node tree builder for BR-LC charts.
 *
 * Ported from apps/sliceboard/src/viz/br/tree.ts.
 * Builds a BiNode tree (bireactive Num lenses for every measure at every node)
 * from a flat PNode array. Used by tile-binder.ts source factories.
 */

import { num, treeNode, walkTree, leavesOf, Num } from 'bireactive'
import type { TreeNode, Writable } from 'bireactive'
import { colorFor } from '@winstonfassett/vizform-core'
import type { PNode } from '@winstonfassett/vizform-core'

export interface NodeValue {
  /** Backing PNode id, so chart edits can map back to the store. */
  id: string
  label: string
  color: string
  total: Writable<Num>
  /** All measures from PNode, keyed by measure name. total is always measures[primaryMeasureKey]. */
  measures?: Record<string, Writable<Num>>
}

export type BiNode = TreeNode<NodeValue>

export function biLeaf(id: string, label: string, measuresData: Record<string, number>, primaryKey: string, color: string): BiNode {
  const measures: Record<string, Writable<Num>> = {}
  for (const [key, value] of Object.entries(measuresData)) {
    measures[key] = num(value)
  }
  const total = measures[primaryKey] ?? num(0)
  return treeNode({ id, label, color, total, measures })
}

export function biGroup(id: string, label: string, color: string, children: BiNode[], primaryKey: string): BiNode {
  // Collect all measure keys from children
  const allMeasureKeys = new Set<string>()
  for (const child of children) {
    for (const key of Object.keys(child.value.measures ?? {})) {
      allMeasureKeys.add(key)
    }
  }

  // Create lenses for each measure
  const measures: Record<string, Writable<Num>> = {}
  for (const measureKey of allMeasureKeys) {
    measures[measureKey] = Num.lens(
      children.map(c => c.value.measures?.[measureKey] ?? num(0)),
      (vs: readonly number[]) => vs.reduce((a, b) => a + b, 0),
      (target, vs) => {
        const arr = vs as readonly number[]
        const cur = arr.reduce((a, b) => a + b, 0)
        if (cur === 0) return arr.map(() => target / arr.length) as never
        const scale = target / cur
        return arr.map(v => v * scale) as never
      },
    )
  }

  const total = measures[primaryKey] ?? num(0)
  return treeNode({ id, label, color, total, measures }, children)
}

export function buildParentIndex(root: BiNode): WeakMap<BiNode, BiNode> {
  const idx = new WeakMap<BiNode, BiNode>()
  walkTree(root, n => {
    for (const c of n.children) idx.set(c as BiNode, n as BiNode)
  })
  return idx
}

export function walkWithDepth(root: BiNode): Array<{ node: BiNode; depth: number; isLeaf: boolean }> {
  const out: Array<{ node: BiNode; depth: number; isLeaf: boolean }> = []
  const walk = (n: BiNode, depth: number) => {
    out.push({ node: n, depth, isLeaf: n.children.length === 0 })
    ;(n.children as BiNode[]).forEach(c => walk(c, depth + 1))
  }
  walk(root, 0)
  return out
}

export function biLeavesOf(root: BiNode): BiNode[] {
  return leavesOf(root) as BiNode[]
}

function pnodeColor(byId: Map<string, PNode>, n: PNode): string {
  // Walk to root ancestor; root's name is the stable color identity for the whole subtree.
  let cur: PNode | undefined = n
  let root: PNode = n
  while (cur) {
    if (cur.color) return cur.color  // explicit override wins
    root = cur
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return colorFor(root.name)
}

export function buildBiTree(nodes: PNode[], measureKey: string, allMeasureKeys?: string[]): BiNode | null {
  if (nodes.length === 0) return null
  const byId = new Map(nodes.map(n => [n.id, n]))

  // Collect all unique measure keys if not provided
  const measureKeys = allMeasureKeys ?? Array.from(
    new Set(nodes.flatMap(n => Object.keys(n.measures)))
  )
  void measureKeys  // used by biLeaf indirectly via measuresData

  function build(n: PNode): BiNode {
    const color = pnodeColor(byId, n)
    const kids = nodes
      .filter(c => c.parentId === n.id)
      .sort((a, b) => a.index - b.index)
    if (kids.length === 0) {
      return biLeaf(n.id, n.name, n.measures, measureKey, color)
    }
    return biGroup(n.id, n.name, color, kids.map(build), measureKey)
  }

  const roots = nodes.filter(n => n.parentId === null).sort((a, b) => a.index - b.index)
  if (roots.length === 0) return null
  if (roots.length === 1) return build(roots[0]!)
  return biGroup('__root__', 'root', colorFor('root'), roots.map(build), measureKey)
}

export function buildFlatBiData(nodes: PNode[], measureKey: string): Array<{ label: string; value: number }> {
  return nodes
    .filter(n => !nodes.some(m => m.parentId === n.id))
    .map(n => ({ label: n.name, value: n.measures[measureKey] ?? 1 }))
}
