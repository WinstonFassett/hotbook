<svelte:options customElement="sb-dock-view-svelte" />

<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { DockNode, DockGroup as DockGroupType } from './dock'
  import { allGroups, findMaximizedGroup, setActive, removePanel, toggleMaximize,
           setSizes, splitGroupRight, splitGroupDown, reconcile, defaultDockTree } from './dock'
  import type { TileRecord } from './DockView'
  import DockSplit from './DockSplit.svelte'
  import DockGroup from './DockGroup.svelte'

  // Props (set from outside before mount, or updated reactively)
  let {
    externalDock = $bindable(null),
    externalTiles = $bindable([])
  }: {
    externalDock?: DockNode | null
    externalTiles?: TileRecord[]
  } = $props()

  // Local reactive state
  let dock = $state<DockNode | null>(externalDock)
  let tiles = $state<TileRecord[]>(externalTiles)
  let focusedGroupId = $state<string | null>(null)
  let awaitingKChord = $state(false)

  // Watch for external changes
  $effect(() => {
    dock = externalDock
  })

  $effect(() => {
    tiles = externalTiles
  })

  // Public API methods (called from parent)
  export function setDock(newDock: DockNode | null) {
    dock = newDock
    externalDock = newDock
  }

  export function setTiles(newTiles: TileRecord[]) {
    tiles = newTiles
    externalTiles = newTiles
  }

  // Dock mutations
  function mutateDock(next: DockNode | null) {
    dock = next
    externalDock = next
    // Dispatch event for parent to sync
    if (typeof window !== 'undefined') {
      const el = document.querySelector('sb-dock-view-svelte')
      el?.dispatchEvent(new CustomEvent('dockchange', { detail: next, bubbles: true, composed: true }))
    }
  }

  // Computed values
  const maximized = $derived(findMaximizedGroup(dock))
  const target = $derived(maximized ?? dock)
  const isEmpty = $derived(!target)

  // Keyboard shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    if (e.ctrlKey && e.key === 'k' && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      awaitingKChord = true
      return
    }
    if (awaitingKChord && e.ctrlKey && e.key === '\\' && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      awaitingKChord = false
      const activeGroup = getKeyboardGroup()
      if (activeGroup) mutateDock(splitGroupDown(dock, activeGroup.id))
      return
    }
    if (!awaitingKChord && e.ctrlKey && e.key === '\\' && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      const activeGroup = getKeyboardGroup()
      if (activeGroup) mutateDock(splitGroupRight(dock, activeGroup.id))
      return
    }
    if (e.ctrlKey && e.key === 'w' && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault()
      const activeGroup = getKeyboardGroup()
      if (activeGroup && activeGroup.activeId && activeGroup.panels.length > 1) {
        mutateDock(removePanel(dock, activeGroup.activeId))
      }
      return
    }
    if (awaitingKChord) awaitingKChord = false
  }

  function getKeyboardGroup(): DockGroupType | null {
    const groups = allGroups(dock)
    if (groups.length === 0) return null
    if (focusedGroupId) {
      const focused = groups.find(g => g.id === focusedGroupId)
      if (focused) return focused
    }
    return groups.find(g => g.panels.length > 0) ?? groups[0] ?? null
  }

  function handleAddTile() {
    const btn = document.querySelector('.dv-empty button')
    if (btn) {
      const rect = btn.getBoundingClientRect()
      const el = document.querySelector('sb-dock-view-svelte')
      el?.dispatchEvent(new CustomEvent('dockaddtile', {
        detail: { groupId: null, x: rect.left, y: rect.bottom },
        bubbles: true, composed: true,
      }))
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="dv-root" style="flex:1;min-height:0;position:relative;overflow:hidden">
  {#if isEmpty}
    <div class="dv-empty" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:#555;font-size:13px">
      <span>No panels</span>
      <button
        style="background:#222;border:1px solid #333;color:#ccc;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px"
        onclick={handleAddTile}
      >
        + Add tile
      </button>
    </div>
  {:else if target}
    {#if target.kind === 'split'}
      <DockSplit
        split={target}
        {tiles}
        {dock}
        {focusedGroupId}
        onMutateDock={mutateDock}
        onSetFocusedGroup={(id) => focusedGroupId = id}
      />
    {:else}
      <DockGroup
        group={target}
        {tiles}
        {dock}
        {focusedGroupId}
        onMutateDock={mutateDock}
        onSetFocusedGroup={(id) => focusedGroupId = id}
      />
    {/if}
  {/if}
</div>

<style>
  :host {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    position: relative;
  }
</style>
