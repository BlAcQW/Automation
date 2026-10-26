'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';
import { cn } from '@bookingflow/ui';

/**
 * Light/dark theme toggle. Renders a placeholder until mounted so the
 * server and client markup match (next-themes can't know the theme on
 * the server).
 */
export function ThemeToggle({ className }: { className?: string }) {
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => setMounted(true), []);

    const isDark = resolvedTheme === 'dark';

    return (
        <button
            type="button"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className={cn(
                'inline-flex h-11 w-11 items-center justify-center rounded-control',
                'text-muted hover:text-text hover:bg-text/[0.06]',
                'transition-colors',
                className,
            )}
        >
            {mounted ? (
                isDark ? <Sun className="h-[18px] w-[18px]" strokeWidth={1.75} /> : <Moon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            ) : (
                <div className="h-5 w-5" />
            )}
        </button>
    );
}
