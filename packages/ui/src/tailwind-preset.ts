import type { Config } from 'tailwindcss';

/**
 * Tailwind preset for @bookingflow/ui. Add it to an app's tailwind config:
 *
 *     presets: [uiPreset],
 *     content: [..., '../../packages/ui/src/**\/*.{ts,tsx}'],   // so classes are generated
 *
 * BRAND COLOUR. Components never name a brand colour; they use `accent-*`
 * (50..950, plus `accent-alt` for gradients), which resolve to CSS variables
 * holding space-separated RGB triplets. Each app sets its own brand in its
 * global CSS, once, for :root:
 *
 *     :root {
 *       --accent-50-rgb: 236 253 245;  ...  --accent-950-rgb: 2 44 34;
 *       --accent-alt-rgb: 20 184 166;
 *     }
 *
 * Triplets (not hex) so opacity modifiers such as `bg-accent-500/10` work.
 * `ink-*` (theme-flipping neutrals) read `--ink-*-rgb` the same way and are
 * likewise defined by the app. `slate` and `on-accent` are fixed values.
 */
const accentScale = Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
        step,
        `rgb(var(--accent-${step}-rgb) / <alpha-value>)`,
    ]),
);

const inkScale = Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950, 1000].map((step) => [
        step,
        `rgb(var(--ink-${step}-rgb) / <alpha-value>)`,
    ]),
);

const preset: Partial<Config> = {
    theme: {
        extend: {
            colors: {
                accent: { ...accentScale, alt: 'rgb(var(--accent-alt-rgb) / <alpha-value>)' },
                ink: inkScale,
                // Text/icon colour on top of the accent. Fixed in both themes.
                'on-accent': '#050807',
                // Fixed-hex greys (paired with explicit `dark:` variants).
                slate: {
                    50: '#F2F6F4',
                    100: '#E7EDEA',
                    200: '#DCE5E1',
                    300: '#B6C2BD',
                    400: '#8A9994',
                    500: '#5C6B65',
                    600: '#3D4B46',
                    700: '#1E2825',
                    800: '#161E1B',
                    900: '#0F1614',
                    950: '#0A0F0D',
                },
            },
            fontFamily: {
                sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
                display: ['var(--font-sans)', 'system-ui', 'sans-serif'],
                mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
            },
            fontSize: {
                'display-2xl': ['clamp(3rem, 7.5vw, 6.5rem)', { lineHeight: '0.95', letterSpacing: '-0.03em', fontWeight: '700' }],
                'display-xl': ['clamp(2.25rem, 5.5vw, 5rem)', { lineHeight: '1.02', letterSpacing: '-0.025em', fontWeight: '700' }],
                'display-lg': ['clamp(2rem, 4vw, 3.5rem)', { lineHeight: '1.05', letterSpacing: '-0.022em', fontWeight: '600' }],
                'display-md': ['clamp(1.75rem, 3vw, 2rem)', { lineHeight: '1.1', letterSpacing: '-0.018em', fontWeight: '600' }],
                h1: ['2rem', { lineHeight: '1.2', letterSpacing: '-0.015em', fontWeight: '600' }],
                h2: ['1.5rem', { lineHeight: '1.25', letterSpacing: '-0.012em', fontWeight: '600' }],
                h3: ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.008em', fontWeight: '600' }],
                'body-lg': ['1.125rem', { lineHeight: '1.6', fontWeight: '400' }],
                body: ['1rem', { lineHeight: '1.55', fontWeight: '400' }],
                'body-sm': ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
                caption: ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.08em', fontWeight: '500' }],
            },
            boxShadow: {
                card: '0 1px 2px rgba(0, 0, 0, 0.25), 0 2px 8px rgba(0, 0, 0, 0.18)',
                'card-hover': '0 2px 4px rgba(0, 0, 0, 0.30), 0 8px 24px rgba(0, 0, 0, 0.24)',
                'card-lg': '0 4px 12px rgba(0, 0, 0, 0.32), 0 16px 40px rgba(0, 0, 0, 0.28)',
            },
        },
    },
};

export default preset;
