import { useEffect, useRef } from 'react'
import { mountTreetable } from '@hotbook/d3'
import type { TreetableMounted } from '@hotbook/d3'
import type { VizNode } from '@hotbook/d3'
import { numberDrag } from '@hotbook/bireactive'

interface HTreetableProps {
  nodes: VizNode[]
  measureKey: string
  /**
   * Called when the user scrubs a leaf row's value cell (Figma-style number
   * drag). Patch contains the new measure value for `measureKey`. If omitted,
   * the value cells render as static text.
   */
  onUpdate?: (rowId: string, measures: VizNode['measures']) => void
}

export function HTreetable({ nodes, measureKey, onUpdate }: HTreetableProps) {
  const ref = useRef<HTMLDivElement>(null)
  const mountedRef = useRef<TreetableMounted | null>(null)

  // Latest values held in refs so the per-render attach pass reads fresh
  // node/measure/handler without re-mounting the underlying treetable.
  const nodesRef = useRef(nodes)
  const measureRef = useRef(measureKey)
  const onUpdateRef = useRef(onUpdate)
  nodesRef.current = nodes
  measureRef.current = measureKey
  onUpdateRef.current = onUpdate

  useEffect(() => {
    if (!ref.current) return
    const mounted = mountTreetable(ref.current, nodes, measureKey)
    mountedRef.current = mounted

    // Per-render, attach number-drag to every visible leaf value cell. The
    // primitive owns the gesture (Esc-revert via dragController snapshot).
    const disposers: Array<() => void> = []
    const unsubRender = mounted.onRender((leafIds) => {
      for (const d of disposers.splice(0)) d()
      const root = mounted.getRoot()
      for (const id of leafIds) {
        const cell = root.querySelector<HTMLElement>(`[data-leaf-value="${id}"]`)
        if (!cell) continue
        // Get/set against the freshest snapshot of measures for this node so
        // multiple drags on the same row compose cleanly.
        const get = () => {
          const node = nodesRef.current.find((n) => n.id === id)
          return node?.measures[measureRef.current] ?? 0
        }
        const set = (v: number) => {
          const node = nodesRef.current.find((n) => n.id === id)
          if (!node) return
          onUpdateRef.current?.(id, { ...node.measures, [measureRef.current]: v })
        }
        disposers.push(numberDrag(cell, { get, set, pxPerUnit: 4 }))
      }
    })

    return () => {
      unsubRender()
      for (const d of disposers) d()
      mounted.destroy()
      mountedRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current?.update(nodes, measureKey)
  }, [nodes, measureKey])

  return <div ref={ref} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
}
