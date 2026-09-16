/**
 * Bookly design tokens.
 *
 * Direction: the operator lives in WhatsApp all day, so the app deliberately
 * borrows its visual language — neutral (hue-free) greys on true black in dark
 * mode, WhatsApp's saturated green, and its chat-bubble colours. This replaces
 * the earlier blue-tinted "warm slate" palette, which read as a fintech
 * dashboard next to the messenger it sits beside.
 *
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
  // chat — bubbles read differently from brand surfaces, so they get their own
  // tokens rather than reusing `primary` (WhatsApp's outgoing bubble is a deep
  // green, not the bright brand green used for buttons).
  bubbleIn: string;
  bubbleOut: string;
  bubbleInText: string;
  bubbleOutText: string;
  chatBackground: string;
  // misc
  scrim: string;
  shadow: string;
}

const light: ThemeColors = {
  background: '#F7F9F8', // off-white ground so white cards still lift
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
  surfaceSunken: '#EEF2F0', // search wells, pressed rows
  text: '#0A0F0D',
  textMuted: '#667781',
  textSubtle: '#8696A0',
  onPrimary: '#FFFFFF',
  primary: '#008069', // WhatsApp light-mode green — white on it ≈ 4.6:1
  primarySoft: '#D9FDD3',
  primaryText: '#008069',
  border: '#E9EDEF',
  divider: '#F0F2F5',
  success: '#008069',
  successSoft: '#D9FDD3',
  warning: '#B45309',
  warningSoft: '#FBEAD0',
  danger: '#DC2626',
  dangerSoft: '#FBE0E0',
  info: '#1D4ED8',
  infoSoft: '#DCE6FE',
  bubbleIn: '#FFFFFF',
  bubbleOut: '#D9FDD3',
  bubbleInText: '#111B21',
  bubbleOutText: '#111B21',
  chatBackground: '#EFE7DE', // the familiar warm paper behind messages
  scrim: 'rgba(17,27,33,0.45)',
  shadow: '#111B21',
};

const dark: ThemeColors = {
  // The same ink scale the web app uses (apps/web tailwind `ink-*`), so a
  // customer moving between the dashboard and the app sees one brand. The
  // greys carry a faint green cast rather than being pure neutral, and the
  // ground is near-black, not #000: pure black flattens every shadow and
  // makes cards look cut out with scissors. On OLED the difference in power
  // is nil; the difference in depth is not.
  background: '#0A0F0D', // ink-950
  surface: '#161E1B', // ink-800: grouped cards
  surfaceElevated: '#1E2825', // ink-700: floating header pills, sheets
  surfaceSunken: '#0F1614', // ink-900: search wells, pressed rows
  text: '#F2F6F4', // ink-50, off-white
  textMuted: '#8A9994', // ink-300
  textSubtle: '#5C6B65', // ink-400
  onPrimary: '#062017', // dark glyph on bright green, as on WhatsApp's + button
  primary: '#25D366', // WhatsApp brand green — dark text on it ≈ 9:1
  primarySoft: '#0B2E22',
  primaryText: '#25D366',
  border: '#2A3632', // ink-600
  divider: '#1E2825', // ink-700
  success: '#25D366',
  successSoft: '#0B2E22',
  warning: '#FBBF24',
  warningSoft: '#33270A',
  danger: '#F87171',
  dangerSoft: '#3A1616',
  info: '#60A5FA',
  infoSoft: '#12233F',
  bubbleIn: '#1F2C33',
  bubbleOut: '#005C4B',
  bubbleInText: '#FFFFFF',
  bubbleOutText: '#FFFFFF',
  chatBackground: '#0B141A',
  scrim: 'rgba(5,8,7,0.6)',
  shadow: '#050807',
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
