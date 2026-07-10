/**
 * Lightens a hex color by mixing it with white.
 * @param hex - Hex color string (e.g., "#7aaae8")
 * @param t - Amount to lighten (0-1, where 1 is white)
 * @returns Lightened hex color string
 */
export function lightenHex(hex: string, t: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const m = (c: number) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0');
  return `#${m(r)}${m(g)}${m(b)}`;
}
