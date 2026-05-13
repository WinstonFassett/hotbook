import React, { useEffect, useRef } from 'react'
import { mountTreetable } from '@winstonfassett/vizform-core'
import type { TreetableMounted } from '@winstonfassett/vizform-core'
import type { PNode } from '@winstonfassett/vizform-core'

interface HTreetableProps {
  nodes: PNode[]
  measureKey: string
}

export function HTreetable({ nodes, measureKey }: HTreetableProps) {
  const ref = useRef<HTMLDivElement>(null)
  const mountedRef = useRef<TreetableMounted | null>(null)

  useEffect(() => {
    if (!ref.current) return
    mountedRef.current = mountTreetable(ref.current, nodes, measureKey)
    return () => { mountedRef.current?.destroy(); mountedRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current?.update(nodes, measureKey)
  }, [nodes, measureKey])

  return <div ref={ref} style={{ width: '100%', height: '100%', overflow: 'hidden' }} />
}
