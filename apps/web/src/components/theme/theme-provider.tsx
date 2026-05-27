'use client';

import { ThemeProvider as NextThemeProvider } from 'next-themes';

/**
 * App-wide light/dark theme provider. Tailwind is configured with
 * `darkMode: 'class'`, so next-themes toggles a `class` on <html>.
 * `<html>` already has `suppressHydrationWarning` in the root layout.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
    return (
        <NextThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
        >
            {children}
        </NextThemeProvider>
    );
}
