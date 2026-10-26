import type { Config } from 'tailwindcss';
import uiPreset from '../../packages/ui/src/tailwind-preset'; // tailwind's config loader ignores tsconfig paths

/**
 * Bookly design system — "Your shop, always open."
 *
 * The brand tokens (semantic colours, type scale, radii, warm shadows, fonts)
 * live in the shared preset (packages/ui/src/tailwind-preset.ts) and read
 * CSS variables defined in src/app/globals.css. Full guide: apps/web/DESIGN-SYSTEM.md.
 *
 * This file only adds app-level extras and the LEGACY ALIASES below.
 */

// ============================================================================
// LEGACY ALIASES — remove when pages migrate.
//
// ~1,500 existing classes still say `emerald-*`, `slate-*`, `bookly-emerald-*`,
// `teal-*`, `forest-*`, `mint`, `lime`, `bookly-amber`, `bookly-rose`. They are
// mapped onto the NEW brand here so nothing breaks while pages are migrated to
// the semantic classes (bg-bg, bg-surface, text-text, text-muted, border-border,
// bg-primary, bg-accent, text-success …). Do NOT use these names in new code.
// ============================================================================

// Green brand scale built around --green #0F6B4F (600) / --green-dark #0B5540 (700).
const GREEN_SCALE = {
    50: '#EAF4EF',
    100: '#D3E8DE',
    200: '#A8D1BE',
    300: '#74B497',
    400: '#3F9271',
    500: '#1A7A5A',
    600: '#0F6B4F',
    700: '#0B5540',
    800: '#094434',
    900: '#07362A',
    950: '#04231B',
};

// Warm neutrals from cream (#FAF6EE) to charcoal (#1F2328). Text steps
// (500+) clear WCAG AA on cream and white.
const WARM_NEUTRAL = {
    50: '#FAF6EE',
    100: '#F4EFE5',
    200: '#E7E1D6',
    300: '#D6CFC2',
    400: '#6B7280',
    500: '#5F6672',
    600: '#4A4F57',
    700: '#363B41',
    800: '#2A2F35',
    900: '#1F2328',
    950: '#171A1E',
};

const config: Config = {
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
                // WhatsApp signal — ONLY for WhatsApp-related UI (badges,
                // "Open in WhatsApp" CTAs, "Connected to WhatsApp" pill).
                wa: {
                    green: '#25D366',
                    teal: '#128C7E',
                    dark: '#075E54',
                },

                // ---- LEGACY ALIASES — remove when pages migrate ----
                'bookly-emerald': GREEN_SCALE,
                emerald: GREEN_SCALE,
                teal: GREEN_SCALE,
                slate: WARM_NEUTRAL,
                forest: {
                    frame: '#0B5540', // → green-dark
                    paper: '#FAF6EE', // → cream
                    ink: '#1F2328', // → charcoal
                    muted: '#5F6672', // → muted (AA on cream)
                    brand: '#0F6B4F', // → green
                    night: '#1F2328', // → charcoal
                    card: '#2A2F35', // → charcoal surface
                    cream: '#FAF6EE', // → cream
                    device: '#E7E1D6', // → border
                    glow: '#E8A317', // → gold
                },
                mint: '#D3E8DE', // → green-100
                lime: '#E8A317', // → gold
                'bookly-amber': '#E8A317', // → warning (gold)
                'bookly-rose': '#C0392B', // → error
                // ---- end LEGACY ALIASES ----
            },
            animation: {
                'fade-in': 'fadeIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
                'fade-in-up': 'fadeInUp 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
                'slide-up': 'slideUp 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
                'slide-down': 'slideDown 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
                'slide-in-left': 'slideInLeft 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
                'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
                shimmer: 'shimmer 1.6s linear infinite',
                // LEGACY ALIASES — remove when pages migrate (now calm, no glow).
                'glow-pulse': 'pulseSoft 2s ease-in-out infinite',
                float: 'float 6s ease-in-out infinite',
                'border-beam': 'shimmer 4s linear infinite',
                'light-sweep': 'fadeIn 0.3s ease-out',
            },
            keyframes: {
                fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
                fadeInUp: { '0%': { opacity: '0', transform: 'translateY(8px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
                slideUp: { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
                slideDown: { '0%': { transform: 'translateY(-8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
                slideInLeft: { '0%': { transform: 'translateX(-100%)', opacity: '0' }, '100%': { transform: 'translateX(0)', opacity: '1' } },
                pulseSoft: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.7' } },
                float: { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
                shimmer: { '0%': { backgroundPosition: '-200% center' }, '100%': { backgroundPosition: '200% center' } },
            },
            boxShadow: {
                // LEGACY ALIASES — remove when pages migrate (warm, no glow).
                'bookly-glow': '0 12px 32px -12px rgb(var(--c-shadow-rgb) / 0.28)',
                'bookly-soft': '0 8px 24px -8px rgb(var(--c-shadow-rgb) / 0.12)',
                'glow-sm': '0 4px 12px -4px rgb(var(--c-shadow-rgb) / 0.2)',
                glow: '0 8px 24px -8px rgb(var(--c-shadow-rgb) / 0.24)',
                'glow-lg': '0 12px 32px -12px rgb(var(--c-shadow-rgb) / 0.28)',
                'glow-xl': '0 24px 56px -16px rgb(var(--c-shadow-rgb) / 0.3)',
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
