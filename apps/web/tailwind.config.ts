import type { Config } from 'tailwindcss';
import uiPreset from '../../packages/ui/src/tailwind-preset'; // tailwind's config loader ignores tsconfig paths

/**
 * Bookly design system — ui.md §3 + §4. Cinematic dark-mode SaaS with a
 * refined emerald scale (`bookly-emerald-*`), the proper WhatsApp signal
 * color (`wa-green` — reserved for WhatsApp-related UI only), and `ink-*`
 * neutrals for surfaces. Cabinet Grotesk drives display type, Satoshi
 * drives body, JetBrains Mono drives numeric/code surfaces.
 */
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
                // (ink-*, on-accent and slate now live in @bookingflow/ui/tailwind-preset.)
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
            },
            backdropBlur: {
                xs: '2px',
            },
        },
    },
    plugins: [],
};

export default config;
