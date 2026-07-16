# Instruction HUD Design

## Problem

After WIN-255 normalized instruction labels (size 11, centered, 0.7 opacity) and removed hover-value replacement, we have:

1. **Instruction text renders inside the plot area with no reserved space** — can overlap with data marks or axis labels
2. **No hover value display** — the old behavior of swapping instruction text for hover values was intentionally removed; tooltips are the sanctioned replacement
3. **Concentric-arc's center readout is different** — it's the primary readout for that chart type, not an instruction overlay, so it should remain as-is

## Design Goals

1. **Instructions don't overlap data** — reserve space or position instructions where they won't interfere with the visualization
2. **Hover values are accessible** — provide an optional tooltip system that charts can opt into
3. **Respect interaction principles** — especially Rule 8 (minimize chrome) and Rule 14 (touch equivalence)
4. **Progressive disclosure** — don't clutter the view for experienced users who don't need instructions

## Proposed Solution

### 1. Instruction Placement

**Approach: Reserved top gutter with optional fade-on-interaction**

- Reserve 24px at the top of each chart's chrome layer (above the plot area)
- Instruction label positions at `y: 12` (vertically centered in the 24px gutter)
- For charts with tight height constraints, support an `instructionMode` property:
  - `'always'` (default) — always visible
  - `'fade-after-first'` — fade to 0.3 opacity after first user interaction
  - `'toggleable'` — show/hide on `?` key or instruction button in top-right corner
  - `'hidden'` — no instruction label (for embedded contexts)

**Overflow handling:**
- Instruction text truncates with ellipsis at 90% of chart width
- Full text available via `title` attribute (browser tooltip on hover)

### 2. Hover Value Tooltip System

**Approach: Optional floating tooltip that follows the pointer**

Create a new `tooltip.ts` primitive in `packages/bireactive/src/lib/`:

```typescript
interface TooltipOptions {
  /**offset from pointer (px)
  offset?: { x: number; y: number };
  /** Delay before showing (ms) */
  delay?: number;
  /** Max width before wrapping */
  maxWidth?: number;
  /** Position preference: 'auto' | 'top' | 'bottom' | 'left' | 'right' */
  position?: string;
}

function tooltip(
  mount: Mount,
  content: Cell<string | null>,
  pointer: Cell<{ x: number; y: number } | null>,
  options?: TooltipOptions
): void
```

**Behavior:**
- Rendered in the chart's `chromeLayer` (above SVG content)
- Positions automatically to avoid viewport edges
- Respects `prefers-reduced-motion` (no slide-in animation, instant show/hide)
- Touch-equivalent: on touch devices, tooltip shows on tap and dismisses on next tap or scroll
- Styled consistently: dark background (#1a1d24), 1px border (#2a2d34), 12px padding, size 13 text

**Chart integration pattern:**
```typescript
// In each chart's scene():
const hoverTooltip = derive(() => {
  const p = hover.value;
  if (!p) return null;
  return `${p.label}: ${Math.round(p.value)}`;
});

const pointerPos = cell<{ x: number; y: number } | null>(null);
this.addEventListener('pointermove', (e) => {
  const pe = e as PointerEvent;
  pointerPos.value = { x: pe.clientX, y: pe.clientY };
});

tooltip(s, hoverTooltip, pointerPos);
```

Charts can opt in by adding the tooltip call — backward compatible (no breaking changes).

### 3. Concentric-Arc Center Readout

**No changes needed.**

The center readout in `concentric-arc.ts` (lines 353-360) is the primary value display for that chart type, not an instruction overlay. It shows:
- Top line: selected/hovered ring label (size 13, 0.5 opacity)
- Bottom line: value in large text (size 28, colored)

This is intentional design and should remain as-is.

## Implementation Plan

### Phase 1: Reserved Gutter (this ticket)
1. Add `instructionMode` property to base `Diagram` class
2. Update all charts that use instruction labels to:
   - Reserve 24px top gutter in their padding config
   - Position instruction at `y: 12` (current) — will now be in reserved space
   - Add overflow handling (truncate with ellipsis, title attribute)
3. Document the pattern in `wiki/chart-conventions.md`

### Phase 2: Tooltip System (follow-up ticket)
1. Create `tooltip.ts` primitive
2. Add tooltip support to 2-3 charts as proof-of-concept
3. Document usage pattern for other charts to adopt

### Phase 3: Advanced Instruction Modes (future)
- Implement `'fade-after-first'` mode
- Implement `'toggleable'` mode with keyboard shortcut
- Add demo toggle in demos page

## Files Changed

### Phase 1
- `packages/bireactive/src/lib/diagram.ts` — add `instructionMode` property
- `packages/bireactive/src/charts/line-chart.ts` — update padding and instruction rendering
- `packages/bireactive/src/charts/area-chart.ts` — update padding and instruction rendering
- `packages/bireactive/src/charts/bar-chart.ts` — update padding and instruction rendering
- `packages/bireactive/src/charts/concentric-arc.ts` — update instruction rendering (keep center readout)
- `packages/bireactive/src/charts/pie-chart.ts` — update if it has instructions
- `packages/bireactive/src/charts/radar-chart.ts` — update if it has instructions
- `packages/bireactive/src/charts/gantt.ts` — update if it has instructions
- `wiki/chart-conventions.md` — document instruction HUD pattern (create if doesn't exist)

### Phase 2
- `packages/bireactive/src/lib/tooltip.ts` — new file
- Selected charts — integrate tooltip (line, area, bar as examples)

## Open Questions

1. **Should the reserved gutter be adaptive?** (24px for desktop, 0px for embedded/small contexts)
   - Proposal: Yes, use `instructionMode='hidden'` for embedded contexts
2. **Should tooltips replace instructions entirely?**
   - Proposal: No, they're complementary. Instructions explain gestures, tooltips show current values.
3. **Touch tooltip trigger — tap or long-press?**
   - Proposal: Tap (simpler, matches click on desktop). Long-press could be added later.

## Testing Plan

1. **Visual regression**: Verify instruction labels don't overlap data in all demo charts
2. **Overflow**: Test with very long instruction text
3. **Touch**: Verify tooltip works on touch devices (if Phase 2 is included)
4. **Reduced motion**: Verify tooltip respects prefers-reduced-motion
5. **Keyboard nav**: Ensure tooltip doesn't interfere with keyboard navigation

## Related

- WIN-255: The spike that normalized instruction style and removed hover-value replacement
- `wiki/interaction-principles.md`: Rule 8 (minimize chrome), Rule 14 (touch equivalence)
- `packages/bireactive/src/lib/axis.ts`: Example of reserved space pattern (axis padding)
