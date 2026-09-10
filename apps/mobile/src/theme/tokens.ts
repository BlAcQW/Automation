/**
 * Bookly design tokens — "Soft UI Evolution" direction.
 * Universal emerald + warm-slate palette (works for salons, clinics, and
 * consultants alike — deliberately NOT a beauty-only pink or a WhatsApp clone).
 * All colours are theme-mapped; components must read from useTheme(), never
 * hardcode hex.
 */

export interface ThemeColors {
  // surfaces
  background: string;
  surface: string; // cards
  surfaceElevated: string; // sheets, headers
  surfaceSunken: string; // input wells, muted rows
  // text
  text: string;
  textMuted: string;
  textSubtle: string;
  onPrimary: string;
  // brand
  primary: string; // solid actions (contrast-safe with onPrimary)
  primarySoft: string; // tinted backgrounds/badges
  primaryText: string; // primary used AS text/icon on surfaces (darker for contrast)
  // lines
  border: string;
  divider: string;
  // semantic
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  // misc
  scrim: string;
  shadow: string;
}

const light: ThemeColors = {
  background: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceSunken: '#EEF1F5',
  text: '#0F172A',
  textMuted: '#5B6472',
  textSubtle: '#8A94A6',
  onPrimary: '#FFFFFF',
  primary: '#047857', // emerald-700 — white text ≈ 5.2:1
  primarySoft: '#D6F3E7',
  primaryText: '#0F7A57',
  border: '#E2E8F0',
  divider: '#EDF1F6',
  success: '#0E9F6E',
  successSoft: '#D6F3E7',
  warning: '#B45309',
  warningSoft: '#FBEAD0',
  danger: '#DC2626',
  dangerSoft: '#FBE0E0',
  info: '#1D4ED8',
  infoSoft: '#DCE6FE',
  scrim: 'rgba(15,23,42,0.45)',
  shadow: '#0F172A',
};

const dark: ThemeColors = {
  background: '#0B0F14',
  surface: '#151B23',
  surfaceElevated: '#1C232C',
  surfaceSunken: '#10151B',
  text: '#F8FAFC',
  textMuted: '#A5B0BF',
  textSubtle: '#6B7686',
  onPrimary: '#03150E',
  primary: '#10B981', // emerald-500 — dark text on it ≈ 6:1
  primarySoft: '#0E2C24',
  primaryText: '#34D399',
  border: '#232B36',
  divider: '#1C232C',
  success: '#34D399',
  successSoft: '#0E2C24',
  warning: '#FBBF24',
  warningSoft: '#33270A',
  danger: '#F87171',
  dangerSoft: '#3A1616',
  info: '#60A5FA',
  infoSoft: '#12233F',
  scrim: 'rgba(0,0,0,0.6)',
  shadow: '#000000',
};

export const palettes = { light, dark } as const;

// 4/8 spacing rhythm.
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

// Font families are loaded in app/_layout.tsx via @expo-google-fonts.
export const fonts = {
  display: 'PlusJakartaSans_700Bold',
  displaySemi: 'PlusJakartaSans_600SemiBold',
  displayExtra: 'PlusJakartaSans_800ExtraBold',
  bodyRegular: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
} as const;

// Type scale (size / lineHeight).
export const type = {
  display: { fontSize: 30, lineHeight: 36 },
  h1: { fontSize: 24, lineHeight: 30 },
  h2: { fontSize: 20, lineHeight: 26 },
  h3: { fontSize: 17, lineHeight: 23 },
  body: { fontSize: 16, lineHeight: 23 },
  bodySm: { fontSize: 14, lineHeight: 20 },
  caption: { fontSize: 12.5, lineHeight: 17 },
} as const;

// Motion — Soft UI Evolution stays in the 150–300ms band.
export const motion = {
  fast: 150,
  base: 220,
  slow: 300,
} as const;

// Soft elevation presets (iOS shadow + Android elevation).
export function elevation(level: 1 | 2 | 3, shadowColor: string) {
  const map = {
    1: { height: 1, radius: 3, opacity: 0.06, elevation: 1 },
    2: { height: 4, radius: 12, opacity: 0.1, elevation: 3 },
    3: { height: 10, radius: 24, opacity: 0.14, elevation: 8 },
  } as const;
  const m = map[level];
  return {
    shadowColor,
    shadowOffset: { width: 0, height: m.height },
    shadowRadius: m.radius,
    shadowOpacity: m.opacity,
    elevation: m.elevation,
  };
}
