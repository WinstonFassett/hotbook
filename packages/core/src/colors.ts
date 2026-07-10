// Semantic palette — mid-lightness, clearly visible on dark canvas
export const PALETTE = [
  '#e08888', // rose
  '#d4a86c', // amber
  '#ccc060', // gold
  '#7ec87e', // sage
  '#60c4c0', // teal
  '#7aaae8', // sky
  '#b090e0', // violet
  '#8899b4', // slate
]

export function pickColor(index: number): string {
  return PALETTE[index % PALETTE.length]
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
