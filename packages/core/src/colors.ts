// Semantic palette — mid-lightness, clearly visible on dark canvas
// Original 8-color palette (wife-approved)
export const PALETTE_8 = [
  '#e08888', // rose
  '#d4a86c', // amber
  '#ccc060', // gold
  '#7ec87e', // sage
  '#60c4c0', // teal
  '#7aaae8', // sky
  '#b090e0', // violet
  '#8899b4', // slate
]

// Extended palette following D3 conventions (20 colors)
// Maintains the original 8 at the start, then extends with additional hues
export const PALETTE_20 = [
  ...PALETTE_8,
  '#e85f99', // pink
  '#ff9966', // coral
  '#f5d76e', // yellow
  '#a8e6a3', // mint
  '#66d9d9', // cyan
  '#8fc5ff', // light blue
  '#c9a0dc', // lavender
  '#b3b3cc', // periwinkle
  '#ff8a80', // salmon
  '#ffb84d', // orange
  '#e6e68a', // lime
  '#70d6a3', // sea green
]

// Default palette is the extended 20-color version
export const PALETTE = PALETTE_20

export function pickColor(index: number, palette = PALETTE): string {
  return palette[index % palette.length]!
}

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Stable sort-invariant color: same identity string → same color, always.
// identity: datum.name for flat; root-ancestor name for hier; group-dim value for grouped.
export function colorFor(identity: string, palette = PALETTE): string {
  return palette[hashStr(identity) % palette.length]!
}

// Color strategy types
export type ColorStrategy = 'index' | 'value' | 'identity' | 'single'

// Get color based on strategy
export function getColorByStrategy(
  strategy: ColorStrategy,
  options: {
    index?: number
    value?: number
    identity?: string
    singleColor?: string
    palette?: string[]
    valueScale?: (value: number) => number // 0-1 normalized value
  }
): string {
  const palette = options.palette || PALETTE
  const singleColor = options.singleColor || '#7aaae8'

  switch (strategy) {
    case 'index':
      return pickColor(options.index ?? 0, palette)
    case 'value':
      // Color based on value magnitude (interpolate through palette)
      const normalized = options.valueScale?.(options.value ?? 0) ?? 0
      const paletteIndex = Math.floor(normalized * (palette.length - 1))
      return palette[Math.max(0, Math.min(palette.length - 1, paletteIndex))]!
    case 'identity':
      return colorFor(options.identity ?? '', palette)
    case 'single':
      return singleColor
    default:
      return singleColor
  }
}
