import type { Config } from 'tailwindcss';
import uiPreset from '../../packages/ui/src/tailwind-preset'; // tailwind's config loader ignores tsconfig paths

/**
 * Bookly design system — "Forest ledger" (after 21st.dev's maroon-fintech-landing,
 * forest palette). Paper surfaces inside a deep forest frame, night-green dark
 * mode, Inter Tight with tight negative tracking, small 3–8px radii.
 *
 * The stock Tailwind palettes the pages were written against (`emerald-*`,
 * `slate-*`, `white`) are remapped here onto the forest scale, so every page
 * picks up the new look without touching its class names. The brand scale is
 * one place to change: swap FOREST for a maroon/midnight scale to re-skin.
 */
// Forest brand scale. 600 is the reference's brand (#2f5640); 500 carries
// cream text at ~5.5:1; 400 reads as text on the night background.
const FOREST = {
    50: '#EEF2EC',
    100: '#DCE5D9',
    200: '#B9CBB7',
    300: '#93AE93',
    400: '#6E9474',
    500: '#3F6B4C',
    600: '#2F5640',
    700: '#284836',
    800: '#213A2C',
    900: '#1A2E23',
    950: '#0F1C15',
};

// Warm green-grey neutrals, paired with explicit `dark:` variants in pages.
// Light end = paper/cream, dark end = night/card from the reference.
const PAPER = {
    50: '#F3F2EA',
    100: '#ECEBE1',
    200: '#DCDBCF',
    300: '#C5C4B6',
    400: '#8E9488',
    500: '#686F67',
    600: '#4A534B',
    700: '#2F4436',
    800: '#1C2C22',
    900: '#121D17',
    950: '#0B130E',
};

const config: Config = {
    // ink-*, accent-*, slate, on-accent, the type scale and card shadows come from
    // the shared preset; this app supplies the CSS variables (globals.css).
    presets: [uiPreset as Config],
    content: [
        '../../packages/ui/src/**/*.{ts,tsx}',
        './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
        './src/components/**/*.{js,ts,jsx,tsx,mdx}',
        './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // Brand — the forest scale (name kept so existing classes resolve).
                'bookly-emerald': FOREST,
                emerald: FOREST,
                teal: FOREST,
                slate: PAPER,
                // Pure white reads as a hole in a paper UI; lift it to the
                // reference's panel white instead.
                white: '#FBFAF7',
                black: '#141A16',
                'on-accent': '#F3F2EA',
                // Named reference surfaces, for new work.
                forest: {
                    frame: '#2F4436',
                    paper: '#E5E4DA',
                    ink: '#141A16',
                    muted: '#7F857B',
                    brand: '#2F5640',
                    night: '#121D17',
                    card: '#1C2C22',
                    cream: '#ECEBE1',
                    device: '#C9B79A',
                    glow: '#FFD98A',
                },
                // WhatsApp signal — ONLY for WA-related UI (badges, "Open in
                // WhatsApp" CTAs, "Connected to WhatsApp" pill).
                wa: {
                    green: '#25D366',
                    teal: '#128C7E',
                    dark: '#075E54',
                },
                // (ink-*, on-accent and slate now live in @bookingflow/ui/tailwind-preset.)
                // Accents — sparingly, for data viz / highlights
                mint: '#B9CBB7',
                lime: '#FFD98A',
                // Status colors (use sparingly — only for their semantic role)
                'bookly-amber': '#E0A43A',
                'bookly-rose': '#C2554A',

                // Back-compat aliases so the gradient utilities in existing
                // components keep working without an immediate sweep. Tailwind
                // still ships the default `emerald-*` and `teal-*` palettes,
                // so `from-emerald-500` etc. resolve as before.
                primary: FOREST,
            },
            fontFamily: {
                sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
                display: ['var(--font-sans)', 'system-ui', 'sans-serif'],
                mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
            },
            // Reference type: light-weight display with very tight tracking.
            fontSize: {
                'display-2xl': ['clamp(2.75rem, 6.2vw, 5.75rem)', { lineHeight: '0.98', letterSpacing: '-0.055em', fontWeight: '400' }],
                'display-xl': ['clamp(2.25rem, 4.6vw, 4rem)', { lineHeight: '1', letterSpacing: '-0.05em', fontWeight: '400' }],
                'display-lg': ['clamp(1.9rem, 3.6vw, 3rem)', { lineHeight: '1.04', letterSpacing: '-0.045em', fontWeight: '400' }],
                'display-md': ['clamp(1.6rem, 2.6vw, 2rem)', { lineHeight: '1.08', letterSpacing: '-0.04em', fontWeight: '400' }],
                h1: ['1.875rem', { lineHeight: '1.1', letterSpacing: '-0.04em', fontWeight: '500' }],
                h2: ['1.375rem', { lineHeight: '1.2', letterSpacing: '-0.03em', fontWeight: '500' }],
                h3: ['1.125rem', { lineHeight: '1.3', letterSpacing: '-0.02em', fontWeight: '500' }],
            },
            // Small, precise corners. Cards 6px, panels 8px, sheets 12px.
            borderRadius: {
                none: '0',
                sm: '2px',
                DEFAULT: '3px',
                md: '4px',
                lg: '5px',
                xl: '6px',
                '2xl': '8px',
                '3xl': '12px',
            },
            animation: {
                'fade-in': 'fadeIn 0.5s ease-out',
                'fade-in-up': 'fadeInUp 0.5s ease-out',
                'slide-up': 'slideUp 0.3s ease-out',
                'slide-down': 'slideDown 0.3s ease-out',
                'slide-in-left': 'slideInLeft 0.3s ease-out',
                'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
                'glow-pulse': 'glowPulse 2s ease-in-out infinite',
                float: 'float 6s ease-in-out infinite',
                shimmer: 'shimmer 2s linear infinite',
                'border-beam': 'borderBeam 4s linear infinite',
                'light-sweep': 'lightSweep 1.2s ease-out',
            },
            keyframes: {
                fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
                fadeInUp: { '0%': { opacity: '0', transform: 'translateY(20px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
                slideUp: { '0%': { transform: 'translateY(10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
                slideDown: { '0%': { transform: 'translateY(-10px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
                slideInLeft: { '0%': { transform: 'translateX(-100%)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
                pulseSoft: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.7' } },
                glowPulse: {
                    '0%, 100%': { boxShadow: '0 0 0 0 rgba(255, 217, 138, 0.45)' },
                    '50%': { boxShadow: '0 0 0 6px rgba(255, 217, 138, 0)' },
                },
                float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-10px)' } },
                shimmer: { '0%': { backgroundPosition: '-200% center' }, '100%': { backgroundPosition: '200% center' } },
                borderBeam: {
                    '0%': { backgroundPosition: '0% 50%' },
                    '50%': { backgroundPosition: '100% 50%' },
                    '100%': { backgroundPosition: '0% 50%' },
                },
                lightSweep: {
                    '0%': { transform: 'translateX(-100%)' },
                    '100%': { transform: 'translateX(200%)' },
                },
            },
            // Reference shadows: long, soft, dropped below the element, never a halo.
            boxShadow: {
                card: '0 0 0 1px rgb(var(--ink-50-rgb) / 0.06), 0 14px 30px -22px rgba(20, 26, 22, 0.45)',
                'card-hover': '0 0 0 1px rgb(var(--ink-50-rgb) / 0.08), 0 24px 44px -24px rgba(20, 26, 22, 0.55)',
                'card-lg': '0 0 0 1px rgb(var(--ink-50-rgb) / 0.06), 0 40px 70px -40px rgba(0, 0, 0, 0.7)',
                'bookly-glow': '0 30px 60px -30px rgba(47, 86, 64, 0.55)',
                'bookly-soft': '0 30px 80px -40px rgba(255, 217, 138, 0.35)',
                'glow-sm': '0 8px 22px -10px rgba(47, 86, 64, 0.5)',
                glow: '0 14px 30px -12px rgba(47, 86, 64, 0.55)',
                'glow-lg': '0 24px 50px -20px rgba(47, 86, 64, 0.6)',
                'glow-xl': '0 40px 80px -30px rgba(47, 86, 64, 0.6)',
                'inner-glow': 'inset 0 1px 0 rgba(255, 255, 255, 0.14)',
            },
            backdropBlur: {
                xs: '2px',
            },
        },
    },
    plugins: [],
};

export default config;
