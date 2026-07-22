// text-measurement.ts — Canvas-based text measurement utility for layout-aware labels.
//
// Provides fast, synchronous text width measurement using a shared canvas context.
// Includes caching to avoid redundant measurements.

/**
 * Shared canvas context for text measurement. Created on first use.
 */
let measurementContext: CanvasRenderingContext2D | null = null;

function getContext(): CanvasRenderingContext2D {
  if (!measurementContext) {
    const canvas = document.createElement("canvas");
    measurementContext = canvas.getContext("2d")!;
  }
  return measurementContext;
}

/**
 * Cache of measured text widths. Key is "text|font".
 * Reset when cache size exceeds MAX_CACHE_SIZE.
 */
const measurementCache = new Map<string, number>();
const MAX_CACHE_SIZE = 1000;

/**
 * Measure the width of text in pixels using canvas measureText.
 * Results are cached by (text, font) key.
 *
 * @param text - The text to measure
 * @param font - CSS font string (e.g., "bold 11px sans-serif")
 * @returns Width in pixels
 */
export function measureText(text: string, font: string): number {
  const key = `${text}|${font}`;

  // Check cache first
  const cached = measurementCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  // Measure using canvas
  const ctx = getContext();
  ctx.font = font;
  const width = ctx.measureText(text).width;

  // Cache the result
  measurementCache.set(key, width);

  // Simple cache eviction: clear all when too large
  // (More sophisticated LRU could be added if needed)
  if (measurementCache.size > MAX_CACHE_SIZE) {
    measurementCache.clear();
  }

  return width;
}

/**
 * Clear the measurement cache. Useful when font sizes change globally
 * (e.g., responsive resizing, theme changes).
 */
export function clearMeasurementCache(): void {
  measurementCache.clear();
}

/**
 * Check if text will fit within a given width, with optional padding.
 *
 * @param text - The text to check
 * @param font - CSS font string
 * @param availableWidth - Available width in pixels
 * @param padding - Optional padding to subtract from available width (default: 0)
 * @returns true if text fits, false otherwise
 */
export function textFits(
  text: string,
  font: string,
  availableWidth: number,
  padding = 0,
): boolean {
  const textWidth = measureText(text, font);
  return textWidth <= (availableWidth - padding);
}

/**
 * Truncate text to fit within a given width, adding ellipsis if needed.
 *
 * @param text - The text to truncate
 * @param font - CSS font string
 * @param maxWidth - Maximum width in pixels
 * @param ellipsis - Ellipsis string to append (default: "…")
 * @returns Truncated text, or original if it fits
 */
export function truncateText(
  text: string,
  font: string,
  maxWidth: number,
  ellipsis = "…",
): string {
  const fullWidth = measureText(text, font);
  if (fullWidth <= maxWidth) {
    return text;
  }

  const ellipsisWidth = measureText(ellipsis, font);
  const availableWidth = maxWidth - ellipsisWidth;

  if (availableWidth <= 0) {
    return ellipsis;
  }

  // Binary search for the right length
  let low = 0;
  let high = text.length;
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = text.substring(0, mid);
    const width = measureText(candidate, font);

    if (width <= availableWidth) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return text.substring(0, best) + ellipsis;
}

/**
 * Measure height of text for a given font.
 * Note: This returns the font size as an approximation. For more accurate
 * vertical metrics, use canvas measureText().fontBoundingBoxAscent/Descent.
 *
 * @param font - CSS font string (e.g., "11px sans-serif")
 * @returns Approximate height in pixels
 */
export function measureTextHeight(font: string): number {
  const ctx = getContext();
  ctx.font = font;
  const metrics = ctx.measureText("M");

  // Use fontBoundingBox if available, otherwise extract from font size
  if (metrics.fontBoundingBoxAscent !== undefined &&
      metrics.fontBoundingBoxDescent !== undefined) {
    return metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
  }

  // Fallback: extract font size from font string
  const sizeMatch = font.match(/(\d+)px/);
  return sizeMatch ? parseInt(sizeMatch[1], 10) : 11;
}
