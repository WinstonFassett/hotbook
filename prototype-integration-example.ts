// prototype-integration-example.ts
//
// Example showing how text measurement would integrate into the icicle chart's
// label visibility logic. This is not production code - it's a prototype
// demonstrating the approach.

import { derive, type Cell } from "bireactive";
import { measureText, textFits } from "./packages/bireactive/src/lib/text-measurement";

// ============================================================================
// BEFORE: Current approach (geometric area proxy)
// ============================================================================

function labelTextBefore(
  rw: Cell<number>,
  rh: Cell<number>,
  isHoriz: Cell<boolean>,
  nodeLabel: string,
): Cell<string> {
  return derive(() => {
    const w0 = rw.value;
    const h0 = rh.value;
    const h = isHoriz.value;

    // Geometric threshold: assumes labels are ~4-6 chars
    // Doesn't know actual text width - can be wrong in both directions:
    //   - Hides short labels ("A") that would fit
    //   - Shows long labels that overflow
    if (h) {
      if (w0 <= 28 || h0 <= 16) return "";
    } else {
      if (w0 <= 16 || h0 <= 28) return "";
    }

    return nodeLabel;
  });
}

function valueTextBefore(
  rw: Cell<number>,
  rh: Cell<number>,
  nodeValue: number,
): Cell<string> {
  return derive(() => {
    const w0 = rw.value;
    const h0 = rh.value;

    // Geometric threshold for 2-line stack (name + value)
    // No text measurement - assumes values are ~3-4 digits
    if (w0 <= 28 || h0 <= 28) return "";

    return nodeValue.toFixed(0);
  });
}

// ============================================================================
// AFTER: Text measurement approach
// ============================================================================

const LABEL_PAD = 3;
const LABEL_FONT = "bold 11px sans-serif";
const VALUE_FONT = "11px sans-serif";
const LINE_HEIGHT = 13; // pixels between name and value lines

function labelTextAfter(
  rw: Cell<number>,
  rh: Cell<number>,
  isHoriz: Cell<boolean>,
  nodeLabel: string,
): Cell<string> {
  return derive(() => {
    const w0 = rw.value;
    const h0 = rh.value;
    const h = isHoriz.value;

    // For horizontal: text runs left-to-right, stacks top-to-bottom
    //   - availableWidth = w0 - 2*LABEL_PAD
    //   - availableHeight = h0 - 2*LABEL_PAD
    // For vertical: text rotated -90°, so dimensions swap
    //   - availableWidth = h0 - 2*LABEL_PAD (rotation swaps w/h)
    //   - availableHeight = w0 - 2*LABEL_PAD

    const availableWidth = (h ? w0 : h0) - 2 * LABEL_PAD;
    const availableHeight = (h ? h0 : w0) - 2 * LABEL_PAD;

    // Need at least line height for a single line
    if (availableHeight < LINE_HEIGHT) return "";

    // Check if text actually fits
    if (!textFits(nodeLabel, LABEL_FONT, availableWidth)) {
      return ""; // Could also truncate with ellipsis here
    }

    return nodeLabel;
  });
}

function valueTextAfter(
  rw: Cell<number>,
  rh: Cell<number>,
  isHoriz: Cell<boolean>,
  nodeValue: number,
): Cell<string> {
  return derive(() => {
    const w0 = rw.value;
    const h0 = rh.value;
    const h = isHoriz.value;

    const availableWidth = (h ? w0 : h0) - 2 * LABEL_PAD;
    const availableHeight = (h ? h0 : w0) - 2 * LABEL_PAD;

    // Need room for 2 lines (name at y=0, value at y=13)
    if (availableHeight < LINE_HEIGHT * 2) return "";

    const valueStr = nodeValue.toFixed(0);
    if (!textFits(valueStr, VALUE_FONT, availableWidth)) {
      return "";
    }

    return valueStr;
  });
}

// ============================================================================
// Alternative: Truncation instead of hiding
// ============================================================================

import { truncateText } from "./packages/bireactive/src/lib/text-measurement";

function labelTextWithTruncation(
  rw: Cell<number>,
  rh: Cell<number>,
  isHoriz: Cell<boolean>,
  nodeLabel: string,
): Cell<string> {
  return derive(() => {
    const w0 = rw.value;
    const h0 = rh.value;
    const h = isHoriz.value;

    const availableWidth = (h ? w0 : h0) - 2 * LABEL_PAD;
    const availableHeight = (h ? h0 : w0) - 2 * LABEL_PAD;

    if (availableHeight < LINE_HEIGHT) return "";

    // Instead of hiding, truncate with ellipsis
    return truncateText(nodeLabel, LABEL_FONT, availableWidth);
  });
}

// ============================================================================
// Column auto-sizing example (treetable)
// ============================================================================

function calculateColumnWidths(
  data: Array<{ name: string; value: number }>,
  valueColumns: string[],
): { nameWidth: string; valueWidths: number[] } {
  const COLUMN_PAD = 16; // 8px on each side
  const MIN_VALUE_WIDTH = 40; // minimum sensible column width

  // Measure all values in each column to find max width
  const valueWidths = valueColumns.map((col, colIdx) => {
    const maxWidth = Math.max(
      ...data.map(row => {
        // In real code, would access row[col] or similar
        const valueStr = row.value.toFixed(0);
        return measureText(valueStr, VALUE_FONT);
      })
    );

    return Math.max(MIN_VALUE_WIDTH, maxWidth + COLUMN_PAD);
  });

  // Name column gets remaining space (1fr in CSS Grid)
  const nameWidth = "1fr";

  return { nameWidth, valueWidths };
}

// Usage in treetable:
function buildTreetableGridTemplate(
  data: Array<{ name: string; value: number }>,
  valueColumns: string[],
): string {
  const { nameWidth, valueWidths } = calculateColumnWidths(data, valueColumns);

  // Before (fixed): "1fr repeat(3, 64px)"
  // After (auto-sized): "1fr 45px 52px 58px" (actual content widths)

  return `${nameWidth} ${valueWidths.map(w => `${w}px`).join(" ")}`;
}

// ============================================================================
// Performance considerations
// ============================================================================

/*
Key observations from prototype:

1. **Caching is essential**: Measuring the same text repeatedly is wasteful.
   Cache provides 10-100x speedup for repeated measurements.

2. **Measure once per render**: Label visibility is derived reactively, so
   the derive() will re-run when dimensions change. The cache ensures we
   don't pay the measurement cost multiple times for the same text.

3. **Cache invalidation**: Font size changes (e.g., responsive resize,
   theme changes) need cache clearing. Could hook into:
   - Window resize events
   - motion.separation changes
   - Theme switches

4. **When NOT to measure**: If a tile is too small to show ANY label
   (e.g., h < 16px), skip measurement entirely - the geometric check is
   sufficient for the "definitely too small" case.
*/

// Optimized label visibility (combines geometric + measurement):
function labelTextOptimized(
  rw: Cell<number>,
  rh: Cell<number>,
  isHoriz: Cell<boolean>,
  nodeLabel: string,
): Cell<string> {
  return derive(() => {
    const w0 = rw.value;
    const h0 = rh.value;
    const h = isHoriz.value;

    const availableWidth = (h ? w0 : h0) - 2 * LABEL_PAD;
    const availableHeight = (h ? h0 : w0) - 2 * LABEL_PAD;

    // Fast path: definitely too small (no measurement needed)
    if (availableHeight < LINE_HEIGHT || availableWidth < 10) {
      return "";
    }

    // Slow path: measure actual text
    if (!textFits(nodeLabel, LABEL_FONT, availableWidth)) {
      return "";
    }

    return nodeLabel;
  });
}

// ============================================================================
// Summary of changes needed for production
// ============================================================================

/*
To integrate text measurement into vizform:

1. **Add the utility** (already done):
   - packages/bireactive/src/lib/text-measurement.ts

2. **Update icicle/treemap/pack label logic**:
   - Replace geometric thresholds with textFits() checks
   - Consider truncateText() for overflow instead of hiding
   - Keep fast-path geometric checks for "definitely too small"

3. **Update treetable column layout**:
   - Replace VALUE_COL_PX = 64 with calculated widths
   - Measure all values to find max width per column
   - Apply min/max constraints (40px min, 200px max?)

4. **Update sunburst arc labels**:
   - Measure text width vs. arc length to decide visibility
   - May need to measure along curved path (more complex)

5. **Handle responsive changes**:
   - Clear cache when font size changes
   - Could expose clearMeasurementCache() on motion config changes

6. **Testing**:
   - Verify labels show when they fit, hide when they don't
   - Test truncation behavior
   - Measure performance impact (should be negligible with cache)
   - Test with various label lengths (1 char to 50+ chars)
*/
