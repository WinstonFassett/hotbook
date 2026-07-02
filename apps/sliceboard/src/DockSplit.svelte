<script lang="ts">
  import type { DockSplit as DockSplitType, DockNode } from './dock'
  import { setSizes } from './dock'
  import type { TileRecord } from './DockView'
  import DockGroup from './DockGroup.svelte'

  let {
    split,
    tiles,
    dock,
    focusedGroupId,
    onMutateDock,
    onSetFocusedGroup
  }: {
    split: DockSplitType
    tiles: TileRecord[]
    dock: DockNode | null
    focusedGroupId: string | null
    onMutateDock: (dock: DockNode | null) => void
    onSetFocusedGroup: (id: string) => void
  } = $props()

  const total = $derived(split.sizes.reduce((a, b) => a + b, 0) || 1)
  const flexSizes = $derived(split.sizes.map(s => (s || 1) / total))

  function startGutterDrag(e: PointerEvent, gutterIndex: number) {
    e.preventDefault()
    const branchEl = (e.currentTarget as HTMLElement).parentElement
    if (!branchEl) return
    const rect = branchEl.getBoundingClientRect()
    const horiz = split.direction === 'row'
    const totalPx = horiz ? rect.width : rect.height
    if (totalPx <= 0) return

    const startSizes = split.sizes.slice()
    const sumPair = (startSizes[gutterIndex] ?? 1) + (startSizes[gutterIndex + 1] ?? 1)
    const startCoord = horiz ? e.clientX : e.clientY
    const totalWeight = startSizes.reduce((a, b) => a + b, 0)
    const pairPx = totalPx * (sumPair / totalWeight)

    const onMove = (ev: PointerEvent) => {
      const cur = horiz ? ev.clientX : ev.clientY
      const dPx = cur - startCoord
      const minPx = 24
      const leftPx = Math.max(minPx, Math.min((startSizes[gutterIndex]! / sumPair) * pairPx + dPx, pairPx - minPx))
      const rightPx = pairPx - leftPx
      const next = startSizes.slice()
      next[gutterIndex] = (leftPx / pairPx) * sumPair
      next[gutterIndex + 1] = (rightPx / pairPx) * sumPair
      onMutateDock(setSizes(dock, split.id, next))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
</script>

<div
  class="dv-branch dv-branch--{split.direction}"
  data-split-id={split.id}
  style="display:flex;flex-direction:{split.direction === 'row' ? 'row' : 'column'};width:100%;height:100%;"
>
  {#each split.children as child, i}
    <div
      class="dv-cell"
      style="flex:{flexSizes[i]};min-width:0;min-height:0;overflow:hidden;position:relative"
    >
      {#if child.kind === 'split'}
        <svelte:self
          split={child}
          {tiles}
          {dock}
          {focusedGroupId}
          {onMutateDock}
          {onSetFocusedGroup}
        />
      {:else}
        <DockGroup
          group={child}
          {tiles}
          {dock}
          {focusedGroupId}
          {onMutateDock}
          {onSetFocusedGroup}
        />
      {/if}
    </div>
    {#if i < split.children.length - 1}
      <div
        class="dv-gutter dv-gutter--{split.direction}"
        role="separator"
        aria-orientation={split.direction === 'row' ? 'vertical' : 'horizontal'}
        title="Drag to resize"
        onpointerdown={(e) => startGutterDrag(e, i)}
      />
    {/if}
  {/each}
</div>
