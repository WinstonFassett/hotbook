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
