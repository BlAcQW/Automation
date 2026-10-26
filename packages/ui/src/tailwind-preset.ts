import type { Config } from 'tailwindcss';

/**
 * Tailwind preset for @bookingflow/ui — the Bookly brand system
 * ("Your shop, always open"). Add it to an app's tailwind config:
 *
 *     presets: [uiPreset],
 *     content: [..., '../../packages/ui/src/**\/*.{ts,tsx}'],   // so classes are generated
 *
 * Every semantic colour resolves to a CSS variable holding a space-separated
 * RGB triplet (`--c-<name>-rgb`), defined by the app's global CSS for `:root`
 * (light, the default) and `.dark` (charcoal, planned). Triplets — not hex —
 * so opacity modifiers such as `bg-primary/10` work and follow the theme.
 *
 * SEMANTIC NAMES (use these in new code — see apps/web/DESIGN-SYSTEM.md):
 *   bg, surface, surface-2, text, muted, border,
 *   primary (green) / primary-hover / primary-soft / primary-fg,
 *   accent (gold) / accent-hover / accent-soft / accent-fg,
 *   success, warning, error (+ -soft, -fg),
 *   and the fixed brand hues gold, gold-dark, green, green-dark, charcoal, cream.
 *
 * LEGACY: `accent-50..950` + `accent-alt` (the old brand scale the UI kit was
 * written against) and `ink-*` (theme-flipping neutrals) are kept as
 * compatibility aliases onto the new brand — see LEGACY ALIASES below.
 */

const v = (name: string) => `rgb(var(--c-${name}-rgb) / <alpha-value>)`;

// ---- LEGACY ALIASES — remove when pages migrate -------------------------
// `accent-50..950`: used to be "the brand". It now resolves to the GREEN
// brand scale (CSS vars in globals.css), because every existing call site
// means "brand colour", not gold. New code: `primary` (green) / `accent` (gold).
const accentScale = Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
        step,
        `rgb(var(--accent-${step}-rgb) / <alpha-value>)`,
    ]),
);

// `ink-*`: theme-flipping neutrals (50 = strongest text … 950 = page,
// 1000 = input/panel white). Now cream → charcoal. New code: bg/surface/text/muted/border.
const inkScale = Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000].map((step) => [
        step,
        `rgb(var(--ink-${step}-rgb) / <alpha-value>)`,
    ]),
);
// ---- end LEGACY ALIASES --------------------------------------------------

const preset: Partial<Config> = {
    theme: {
        extend: {
            colors: {
                // ---- Semantic (theme-aware) ----
                bg: v('bg'),
                surface: { DEFAULT: v('surface'), 2: v('surface-2') },
                text: v('text'),
                muted: v('muted'),
                border: v('border'),
                primary: {
                    DEFAULT: v('primary'),
                    hover: v('primary-hover'),
                    soft: v('primary-soft'),
                    fg: v('primary-fg'),
                },
                accent: {
                    DEFAULT: v('accent'),
                    hover: v('accent-hover'),
                    soft: v('accent-soft'),
                    fg: v('accent-fg'),
                    // LEGACY ALIASES — remove when pages migrate (green brand scale).
                    ...accentScale,
                    alt: 'rgb(var(--accent-alt-rgb) / <alpha-value>)',
                },
                success: { DEFAULT: v('success'), soft: v('success-soft'), fg: v('success-fg') },
                warning: { DEFAULT: v('warning'), soft: v('warning-soft'), fg: v('warning-fg') },
                error: { DEFAULT: v('error'), soft: v('error-soft'), fg: v('error-fg') },
                focus: v('focus'),

                // ---- Fixed brand hues (same in both themes) ----
                gold: { DEFAULT: '#E8A317', dark: '#C98A0E' },
                green: { DEFAULT: '#0F6B4F', dark: '#0B5540' },
                charcoal: '#1F2328',
                cream: '#FAF6EE',

                // LEGACY ALIASES — remove when pages migrate.
                ink: inkScale,
                // Text/icon colour on a filled brand (green) surface.
                'on-accent': '#FFFFFF',
            },
            borderColor: {
                DEFAULT: v('border'),
            },
            ringColor: {
                DEFAULT: v('focus'),
            },
            fontFamily: {
                // Bricolage Grotesque — body, buttons, forms, tables, nav.
                sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
                // Clash Display — logo, page titles and hero headlines ONLY.
                display: ['var(--font-display)', 'var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
                mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
            },
            fontSize: {
                // ---- Brand type scale (mobile → desktop) ----
                // Hero: Clash 40 → 72. Pair with `font-display`.
                hero: ['clamp(2.5rem, 1.6rem + 4.5vw, 4.5rem)', { lineHeight: '1.02', letterSpacing: '-0.02em', fontWeight: '600' }],
                // Page title: Clash 28 → 40. Pair with `font-display`.
                'page-title': ['clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem)', { lineHeight: '1.1', letterSpacing: '-0.015em', fontWeight: '600' }],
                // Section heading: Bricolage 700, 20 → 24.
                'section-heading': ['clamp(1.25rem, 1.1rem + 0.6vw, 1.5rem)', { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '700' }],
                // Body: 16px, never smaller for reading copy.
                body: ['1rem', { lineHeight: '1.55', fontWeight: '400' }],
                // Small / labels: 14px, 500.
                small: ['0.875rem', { lineHeight: '1.45', fontWeight: '500' }],

                // LEGACY ALIASES — remove when pages migrate.
                'display-2xl': ['clamp(2.5rem, 1.6rem + 4.5vw, 4.5rem)', { lineHeight: '1.02', letterSpacing: '-0.02em', fontWeight: '600' }],
                'display-xl': ['clamp(2.25rem, 1.5rem + 3.5vw, 4rem)', { lineHeight: '1.05', letterSpacing: '-0.02em', fontWeight: '600' }],
                'display-lg': ['clamp(2rem, 1.4rem + 2.5vw, 3rem)', { lineHeight: '1.08', letterSpacing: '-0.015em', fontWeight: '600' }],
                'display-md': ['clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem)', { lineHeight: '1.1', letterSpacing: '-0.015em', fontWeight: '600' }],
                h1: ['1.75rem', { lineHeight: '1.2', letterSpacing: '-0.015em', fontWeight: '700' }],
                h2: ['1.5rem', { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '700' }],
                h3: ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.005em', fontWeight: '700' }],
                'body-lg': ['1.125rem', { lineHeight: '1.6', fontWeight: '400' }],
                'body-sm': ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
                caption: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.02em', fontWeight: '500' }],
            },
            // 12px controls (inputs, buttons), 20–24px cards. The stock
            // Tailwind keys are retuned so existing classes land near brand.
            borderRadius: {
                control: '12px',
                card: '20px',
                'card-lg': '24px',
                sm: '6px',
                DEFAULT: '8px',
                md: '10px',
                lg: '12px',
                xl: '12px',
                '2xl': '20px',
                '3xl': '24px',
            },
            // Warm, soft, never harsh black: shadows are tinted with a brown
            // derived from the gold/charcoal pair.
            boxShadow: {
                soft: '0 1px 2px rgb(var(--c-shadow-rgb) / 0.06), 0 4px 12px -2px rgb(var(--c-shadow-rgb) / 0.08)',
                card: '0 1px 2px rgb(var(--c-shadow-rgb) / 0.05), 0 8px 24px -8px rgb(var(--c-shadow-rgb) / 0.12)',
                'card-hover': '0 2px 4px rgb(var(--c-shadow-rgb) / 0.06), 0 16px 36px -10px rgb(var(--c-shadow-rgb) / 0.18)',
                'card-lg': '0 2px 6px rgb(var(--c-shadow-rgb) / 0.06), 0 24px 56px -16px rgb(var(--c-shadow-rgb) / 0.22)',
                lift: '0 12px 32px -12px rgb(var(--c-shadow-rgb) / 0.28)',
            },
            transitionTimingFunction: {
                // ease-out to enter, ease-in to leave.
                'brand-out': 'cubic-bezier(0.22, 1, 0.36, 1)',
                'brand-in': 'cubic-bezier(0.55, 0, 1, 0.45)',
            },
            transitionDuration: {
                ui: '200ms',
                'ui-slow': '300ms',
                page: '400ms',
            },
        },
    },
};

export default preset;
