// Typography tokens — derived from hotbook's CSS.
export const TYPOGRAPHY = {
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  fontSize: {
    xs: '10px',   // UI labels, secondary text
    sm: '11px',   // Buttons, tabs, tile headers
    base: '13px', // Body text
    md: '12px',   // Menu items, drill breadcrumb
    lg: '14px',   // Close buttons, larger icons
  },
  fontWeight: {
    normal: 400,
    medium: 500,
  },
  lineHeight: {
    tight: 1,
    normal: 1.5,
  },
} as const
