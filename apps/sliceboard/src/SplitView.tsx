import { useRef } from 'react'
import type { ReactNode } from 'react'
import type { SplitNode, SplitBranch } from './splits'

/**
 * Recursive renderer for the split-tree layout. Each branch is a flex
 * row/column; siblings are separated by a draggable gutter that adjusts the
 * two adjacent flex weights on drag. Leaf rendering is delegated via
 * `renderLeaf` so the tile chrome stays owned by the host.
 *
 * Sizes are stored as flex weights (positive numbers); their absolute values
 * don't matter, only the ratios. We resize by transferring a fraction of the
 * pair's total weight in proportion to the cursor delta.
 */
export function SplitView({
  node,
  renderLeaf,
  onResize,
}: {
  node: SplitNode
  renderLeaf: (tileId: string) => ReactNode
  onResize: (splitId: string, sizes: number[]) => void
}) {
  if (node.kind === 'leaf') {
    return <div className="split-leaf">{renderLeaf(node.tileId)}</div>
  }
  return <SplitBranchView branch={node} renderLeaf={renderLeaf} onResize={onResize} />
}

function SplitBranchView({
  branch, renderLeaf, onResize,
}: {
  branch: SplitBranch
  renderLeaf: (tileId: string) => ReactNode
  onResize: (splitId: string, sizes: number[]) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  const startDrag = (index: number, e: React.PointerEvent<HTMLDivElement>) => {
    if (!ref.current) return
    e.preventDefault()
    const el = ref.current
    const rect = el.getBoundingClientRect()
    const horiz = branch.direction === 'row'
    const totalPx = horiz ? rect.width : rect.height
    if (totalPx <= 0) return
    const startSizes = branch.sizes.slice()
    const sumPair = (startSizes[index] ?? 1) + (startSizes[index + 1] ?? 1)
    const startCoord = horiz ? e.clientX : e.clientY
    const pairPx = totalPx * (sumPair / startSizes.reduce((a, b) => a + b, 0))
    const target = e.currentTarget
    try { target.setPointerCapture(e.pointerId) } catch { /* ignore */ }

    const onMove = (ev: PointerEvent) => {
      const cur = horiz ? ev.clientX : ev.clientY
      const dPx = cur - startCoord
      // dPx is added to the left/top sibling, subtracted from the right/bottom.
      // Keep each sibling at least a tiny weight so it doesn't disappear.
      const minPx = 24
      const leftPx = clamp((startSizes[index]! / sumPair) * pairPx + dPx, minPx, pairPx - minPx)
      const rightPx = pairPx - leftPx
      const next = startSizes.slice()
      next[index] = (leftPx / pairPx) * sumPair
      next[index + 1] = (rightPx / pairPx) * sumPair
      onResize(branch.id, next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const flexDir = branch.direction === 'row' ? 'row' : 'column'
  const totalWeight = branch.sizes.reduce((a, b) => a + b, 0) || 1

  return (
    <div ref={ref} className={`split-branch split-branch--${branch.direction}`} style={{ flexDirection: flexDir }}>
      {branch.children.flatMap((child, i) => {
        const cell = (
          <div key={child.id} className="split-cell" style={{ flexGrow: (branch.sizes[i] ?? 1) / totalWeight, flexBasis: 0 }}>
            <SplitView node={child} renderLeaf={renderLeaf} onResize={onResize} />
          </div>
        )
        if (i === branch.children.length - 1) return [cell]
        const gutter = (
          <div
            key={`g-${child.id}`}
            className={`split-gutter split-gutter--${branch.direction}`}
            onPointerDown={(e) => startDrag(i, e)}
            role="separator"
            aria-orientation={branch.direction === 'row' ? 'vertical' : 'horizontal'}
          />
        )
        return [cell, gutter]
      })}
    </div>
  )
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}
