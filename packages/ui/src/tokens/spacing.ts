// Spacing scale — derived from hotbook's CSS baseline.
export const SPACING = {
  xs: '2px',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '10px',
  xxl: '12px',
} as const

export type SpacingKey = keyof typeof SPACING
