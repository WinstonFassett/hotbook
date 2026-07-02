<script lang="ts">
  import type { DockGroup as DockGroupType, DockNode } from './dock'
  import { setActive, removePanel, toggleMaximize, movePanel, dropOnEdge, dropGroupOnEdge, mergeGroups } from './dock'
  import type { TileRecord } from './DockView'
  import { onMount } from 'svelte'

  let {
    group,
    tiles,
    dock,
    focusedGroupId,
    onMutateDock,
    onSetFocusedGroup
  }: {
    group: DockGroupType
    tiles: TileRecord[]
    dock: DockNode | null
    focusedGroupId: string | null
    onMutateDock: (dock: DockNode | null) => void
    onSetFocusedGroup: (id: string) => void
  } = $props()

  const activePanel = $derived(group.panels.find(p => p.id === group.activeId) ?? group.panels[0])
  const singlePanel = $derived(group.panels.length <= 1)

  // Drag state (simplified - in real impl this would be in parent/context)
  let dragState = $state<any>(null)

  function handleGroupPointerDown() {
    onSetFocusedGroup(group.id)
  }

  function activatePanel(panelId: string) {
    onMutateDock(setActive(dock, group.id, panelId))
  }

  function closePanel(panelId: string) {
    if (group.panels.length > 1) {
      onMutateDock(removePanel(dock, panelId))
    }
  }

  function handleMaximize() {
    onMutateDock(toggleMaximize(dock, group.id))
  }

  function handleAddTile() {
    const btn = document.querySelector(`[data-group-id="${group.id}"] .dv-tab-add`)
    if (btn) {
      const rect = btn.getBoundingClientRect()
      const el = document.querySelector('sb-dock-view-svelte')
      el?.dispatchEvent(new CustomEvent('dockaddtile', {
        detail: { groupId: group.id, x: rect.left, y: rect.bottom },
        bubbles: true, composed: true,
      }))
    }
  }

  function getTileLabel(tileId: string): string {
    const tileRec = tiles.find(t => t.tile.id === tileId)
    return tileRec?.label ?? tileId
  }

  // Tab drag start (simplified - real impl needs more drag logic)
  function startTabDrag(e: PointerEvent, panelId: string) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('.dv-tab-close')) return

    const startX = e.clientX
    const startY = e.clientY
    let dragging = false

    const onMove = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
      dragging = true
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      // TODO: Begin actual drag with ghost
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!dragging) activatePanel(panelId)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Middle-click to close
  function handleTabMouseDown(e: MouseEvent, panelId: string) {
    if (e.button === 1 && group.panels.length > 1) {
      e.preventDefault()
      closePanel(panelId)
    }
  }
</script>

<div
  class="dv-group"
  data-group-id={group.id}
  style="display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden"
  onpointerdown={handleGroupPointerDown}
>
  <!-- Tab strip -->
  <div class="dv-tabstrip">
    <div class="dv-tabs" data-group-id={group.id} data-dropzone="tabs">
      {#each group.panels as panel, i}
        {@const label = getTileLabel(panel.tileId)}
        {@const isActive = panel.id === group.activeId}
        <div
          class="dv-tab"
          class:dv-tab--active={isActive}
          data-tab-index={i}
          data-panel-id={panel.id}
          title={label}
          onpointerdown={(e) => startTabDrag(e, panel.id)}
          onmousedown={(e) => handleTabMouseDown(e, panel.id)}
        >
          <span class="dv-tab-label">{label}</span>
          <button
            class="dv-tab-close"
            title="Close panel"
            aria-label="Close panel"
            disabled={singlePanel}
            style:opacity={singlePanel ? '0.3' : ''}
            style:cursor={singlePanel ? 'default' : ''}
            onclick={(e) => { e.stopPropagation(); closePanel(panel.id) }}
          >
            ×
          </button>
        </div>
      {/each}
    </div>

    <div class="dv-tabstrip-actions">
      <button
        class="dv-tab-add"
        title="Add tile"
        aria-label="Add tile"
        onclick={handleAddTile}
      >
        +
      </button>
      <button
        class="dv-tab-maximize"
        title={group.maximized ? 'Restore' : 'Maximize'}
        aria-label={group.maximized ? 'Restore' : 'Maximize'}
        onclick={handleMaximize}
      >
        {group.maximized ? '❐' : '□'}
      </button>
    </div>
  </div>

  <!-- Panel body -->
  <div
    class="dv-body"
    data-group-id={group.id}
    data-dropzone="edges"
    style="flex:1;min-height:0;position:relative;overflow:hidden"
  >
    {#if activePanel}
      {@const tileRec = tiles.find(t => t.tile.id === activePanel.tileId)}
      {#if tileRec}
        <div
          class="dv-panel"
          data-panel-id={activePanel.id}
          style="width:100%;height:100%;display:flex;flex-direction:column;overflow:hidden"
        >
          <!-- Tile header -->
          <div class="tile-header">
            <span class="tile-title">{tileRec.label}</span>
            <div class="tile-header-actions">
              <!-- TODO: Add measure/config pickers here -->
              <button class="tile-close-btn" onclick={() => tileRec.onRemove()}>×</button>
            </div>
          </div>

          <!-- Chart body placeholder - real impl would mount actual chart -->
          <div
            class="tile-body"
            style="flex:1;min-height:0;overflow:hidden;position:relative;background:#1a1a1a;display:flex;align-items:center;justify-content:center;color:#666;font-size:12px;"
          >
            {tileRec.tile.kind} tile (Svelte render)
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
