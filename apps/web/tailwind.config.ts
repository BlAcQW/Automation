import type { Config } from 'tailwindcss';

/**
 * Bookly design system — ui.md §3 + §4. Cinematic dark-mode SaaS with a
 * refined emerald scale (`bookly-emerald-*`), the proper WhatsApp signal
 * color (`wa-green` — reserved for WhatsApp-related UI only), and `ink-*`
 * neutrals for surfaces. Cabinet Grotesk drives display type, Satoshi
 * drives body, JetBrains Mono drives numeric/code surfaces.
 */
const config: Config = {
    content: [
        './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
        './src/components/**/*.{js,ts,jsx,tsx,mdx}',
        './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    ],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // Brand greens — the Bookly emerald
                'bookly-emerald': {
                    50: '#ECFDF5',
                    100: '#D1FAE5',
                    200: '#A7F3D0',
                    300: '#6EE7B7',
                    400: '#34D399',
                    500: '#10B981', // primary brand
                    600: '#059669',
                    700: '#047857',
                    800: '#065F46',
                    900: '#064E3B',
                    950: '#022C22',
                },
                // WhatsApp signal — ONLY for WA-related UI (badges, "Open in
                // WhatsApp" CTAs, "Connected to WhatsApp" pill).
                wa: {
                    green: '#25D366',
                    teal: '#128C7E',
                    dark: '#075E54',
                },
                // Neutrals. Read from the `--ink-*-rgb` triplets in globals.css
                // so the same utility resolves to the dark or light value
                // depending on the `.dark` / `.light` class on <html>. The
                // dark hex values (for reference): 50 #F2F6F4 … 950 #0A0F0D,
                // 1000 #050807.
                ink: {
                    50: 'rgb(var(--ink-50-rgb) / <alpha-value>)',
                    100: 'rgb(var(--ink-100-rgb) / <alpha-value>)',
                    200: 'rgb(var(--ink-200-rgb) / <alpha-value>)',
                    300: 'rgb(var(--ink-300-rgb) / <alpha-value>)',
                    400: 'rgb(var(--ink-400-rgb) / <alpha-value>)',
                    500: 'rgb(var(--ink-500-rgb) / <alpha-value>)',
                    600: 'rgb(var(--ink-600-rgb) / <alpha-value>)',
                    700: 'rgb(var(--ink-700-rgb) / <alpha-value>)',
                    800: 'rgb(var(--ink-800-rgb) / <alpha-value>)',
                    900: 'rgb(var(--ink-900-rgb) / <alpha-value>)',
                    950: 'rgb(var(--ink-950-rgb) / <alpha-value>)',
                    1000: 'rgb(var(--ink-1000-rgb) / <alpha-value>)',
                },
                // Text/icon colour on top of the emerald accent. Fixed in both
                // themes: the accent itself doesn't change, so neither should
                // what sits on it.
                'on-accent': '#050807',
                // The older dashboard pages were written against Tailwind's
                // blue-tinted `slate`. Re-pointing that name at the ink scale
                // (fixed hex, not the theme-flipping vars: these classes are
                // paired with explicit `dark:` variants) puts the whole app on
                // one grey family without touching every file. Steps are
                // shifted so light-on-dark text keeps AA contrast.
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
                // Accents — sparingly, for data viz / highlights
                mint: '#5EEAD4',
                lime: '#BEF264',
                // Status colors (use sparingly — only for their semantic role)
                'bookly-amber': '#FBBF24',
                'bookly-rose': '#FB7185',

                // Back-compat aliases so the gradient utilities in existing
                // components keep working without an immediate sweep. Tailwind
                // still ships the default `emerald-*` and `teal-*` palettes,
                // so `from-emerald-500` etc. resolve as before.
                primary: {
                    50: '#ECFDF5',
                    100: '#D1FAE5',
                    200: '#A7F3D0',
                    300: '#6EE7B7',
                    400: '#34D399',
                    500: '#10B981',
                    600: '#059669',
                    700: '#047857',
                    800: '#065F46',
                    900: '#064E3B',
                    950: '#022C22',
                },
            },
            fontFamily: {
                // One family for everything — Geist (Vercel's open-source).
                // `font-display` is an alias kept for backward compat with
                // the existing classes; Geist handles display sizes
                // beautifully with the tracking retune below.
                sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
                display: ['var(--font-sans)', 'system-ui', 'sans-serif'],
                mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
            },
            fontSize: {
                // Display — Geist, lighter tracking than Cabinet (Geist
                // doesn't need the aggressive -0.04em that helped Cabinet).
                // Mobile floor lowered so the headline doesn't crowd a
                // 343-px content width at 375 px viewports.
                'display-2xl': ['clamp(3rem, 7.5vw, 6.5rem)', { lineHeight: '0.95', letterSpacing: '-0.03em', fontWeight: '700' }],
                'display-xl': ['clamp(2.25rem, 5.5vw, 5rem)', { lineHeight: '1.02', letterSpacing: '-0.025em', fontWeight: '700' }],
                'display-lg': ['clamp(2rem, 4vw, 3.5rem)', { lineHeight: '1.05', letterSpacing: '-0.022em', fontWeight: '600' }],
                'display-md': ['clamp(1.75rem, 3vw, 2rem)', { lineHeight: '1.1', letterSpacing: '-0.018em', fontWeight: '600' }],
                // UI — Geist body weights
                'h1': ['2rem', { lineHeight: '1.2', letterSpacing: '-0.015em', fontWeight: '600' }],
                'h2': ['1.5rem', { lineHeight: '1.25', letterSpacing: '-0.012em', fontWeight: '600' }],
                'h3': ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.008em', fontWeight: '600' }],
                'body-lg': ['1.125rem', { lineHeight: '1.6', fontWeight: '400' }],
                'body': ['1rem', { lineHeight: '1.55', fontWeight: '400' }],
                'body-sm': ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
                'caption': ['0.75rem', { lineHeight: '1.4', letterSpacing: '0.08em', fontWeight: '500' }],
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
                    '0%, 100%': { boxShadow: '0 0 20px rgba(16, 185, 129, 0.3)' },
                    '50%': { boxShadow: '0 0 40px rgba(16, 185, 129, 0.6)' },
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
            boxShadow: {
                // The signature Bookly glow — emerald atmosphere
                'bookly-glow': '0 0 80px rgba(16, 185, 129, 0.35)',
                'bookly-soft': '0 0 120px rgba(110, 231, 183, 0.15)',
                // Legacy emerald glow (marketing surfaces)
                'glow-sm': '0 0 15px rgba(16, 185, 129, 0.2)',
                glow: '0 0 30px rgba(16, 185, 129, 0.3)',
                'glow-lg': '0 0 50px rgba(16, 185, 129, 0.4)',
                'glow-xl': '0 0 80px rgba(16, 185, 129, 0.3)',
                'inner-glow': 'inset 0 0 20px rgba(16, 185, 129, 0.15)',
                // Card elevation
                card: '0 1px 2px rgba(0, 0, 0, 0.25), 0 2px 8px rgba(0, 0, 0, 0.18)',
                'card-hover': '0 2px 4px rgba(0, 0, 0, 0.30), 0 8px 24px rgba(0, 0, 0, 0.24)',
                'card-lg': '0 4px 12px rgba(0, 0, 0, 0.32), 0 16px 40px rgba(0, 0, 0, 0.28)',
            },
            backdropBlur: {
                xs: '2px',
            },
        },
    },
    plugins: [],
};

export default config;
