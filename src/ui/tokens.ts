/**
 * Design primitives. Deliberately small: a dark, athletic, high-contrast base
 * that reads from across a gym floor. Final visual design is a later phase.
 */
export const colors = {
  bg: '#0B0F14',
  surface: '#141A22',
  surfaceRaised: '#1C242E',
  border: '#2A3441',
  text: '#F3F5F7',
  textMuted: '#9AA6B4',
  textFaint: '#5F6B78',
  accent: '#E8B84A',
  accentText: '#0B0F14',
  danger: '#E5484D',
  success: '#3DD68C',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

export const type = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 1.2, textTransform: 'uppercase' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
} as const;
