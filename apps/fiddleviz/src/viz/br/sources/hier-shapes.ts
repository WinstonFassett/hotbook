/**
 * hier-shapes.ts — TileSource builder for hierarchical BR-LC charts.
 *
 * makeHier is a thin wrapper over makeHierSource with standard shape/value keys.
 * Treetable gets its own maker because it needs numberDrag integration.
 */

import type { VizNode } from '../../../persistence'
import { makeHierSource, hierShapeKey, hierValueKey } from '../bindTile'
import { numberDrag } from '@fiddleviz/bireactive'
import type { TileSource } from '../bindTile'

export interface HierSourceProps {
  nodes: VizNode[]
  measureKey: string
  depth?: number
  sortBy?: 'index' | 'value'
  orientation?: 'horizontal' | 'vertical'
  drillKey?: string
  drillNodeId?: string | null
  showBreadcrumb?: boolean
  onUpdate?: (nodeId: string, measures: VizNode['measures']) => void
  onUpdateMany?: (updates: Array<{ id: string; measures: VizNode['measures'] }>) => void
}

export function makeHier(tag: string, props: HierSourceProps): TileSource {
  const { nodes, measureKey, depth, sortBy, orientation, drillKey = 'default', drillNodeId, showBreadcrumb = true, onUpdate, onUpdateMany } = props
  const shapeKey = hierShapeKey(tag, nodes, measureKey, depth)
  const valueKey = hierValueKey(nodes, measureKey)
  return makeHierSource({
    tag, nodes, measureKey, depth, sortBy, orientation, shapeKey, valueKey,
    drillKey, drillNodeId, showBreadcrumb, onUpdate, onUpdateMany,
  })
}

export function makeTreetableSource(props: HierSourceProps): TileSource {
  const { nodes, measureKey, onUpdate } = props
  const source = makeHier('v-br-treetable', props)

  const originalMountProps = source.mountProps
  return {
    ...source,
    mountProps(el: HTMLElement) {
      originalMountProps?.(el)

      // numberDrag integration — attach to ALL value cells (parents + leaves)
      // for sum-redistribute editing
      const disposers: Array<() => void> = []
      const typedEl = el as any

      const unsubRender = typedEl.onRender?.((allNodeIds: string[]) => {
        for (const d of disposers.splice(0)) d()

        const root = typedEl.getRoot?.() as HTMLElement | undefined
        if (!root) return
        const biRoot = typedEl.externalRoot
        if (!biRoot) return

        const allBiNodes: any[] = []
        const walk = (node: any) => {
          allBiNodes.push(node)
          for (const child of node.children as any[]) walk(child)
        }
        walk(biRoot)
        const nodeMap = new Map(allBiNodes.map(n => [n.value.id, n]))

        const valueCells = root.querySelectorAll<HTMLElement>('[data-editable-value]')
        for (const cell of Array.from(valueCells)) {
          const cellId = cell.dataset.editableValue
          if (!cellId) continue
          const parts = cellId.split(':')
          const nodeId = parts[0]
          const cellMeasureKey = parts[1] ?? measureKey

          const biNode = nodeMap.get(nodeId)
          if (!biNode) continue
          const measureValue = biNode.value.measures?.[cellMeasureKey] ?? biNode.value.total

          const get = () => measureValue.value
          const set = (v: number) => {
            measureValue.value = v
            const pnode = nodes.find(n => n.id === nodeId)
            if (pnode && onUpdate) onUpdate(nodeId, { ...pnode.measures, [cellMeasureKey]: v })
          }
          disposers.push(numberDrag(cell, { get, set, pxPerUnit: 4 }))
        }
      })

      const originalDispose = (el as any).__dispose
      ;(el as any).__dispose = () => {
        unsubRender?.()
        for (const d of disposers) d()
        originalDispose?.()
      }
    }
  }
}
