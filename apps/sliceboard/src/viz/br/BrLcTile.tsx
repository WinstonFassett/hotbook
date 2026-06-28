/**
 * BrLcTile.tsx — dumb React host for BR-LC custom elements.
 *
 * React's ONLY job here:
 *   1. Render a <div> and mount the element once (empty dep array).
 *   2. Push new data on every render via ctrl.update() — bindTile decides
 *      whether to rebuild the element (shape changed) or just update values.
 *
 * All sync/echo/freeze/commit re-sort/batch logic lives in bindTile.ts.
 */

import { useEffect, useRef } from 'react'
import { bindTile } from './bindTile'
import type { TileSource, TileController } from './bindTile'

export type { TileSource }

export function BrLcTile({ source }: { source: TileSource }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const ctrlRef = useRef<TileController | undefined>(undefined)

  // Mount once — NOT keyed on shapeKey; bindTile.update() owns rebuild-on-shape-change.
  useEffect(() => {
    if (!containerRef.current) return
    ctrlRef.current = bindTile(containerRef.current, source)
    return () => {
      ctrlRef.current?.dispose()
      ctrlRef.current = undefined
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push data on every render; bindTile decides whether to rebuild or just update values.
  useEffect(() => {
    ctrlRef.current?.update(source)
  })

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
