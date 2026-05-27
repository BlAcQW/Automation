'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon } from 'lucide-react';
import { cn } from '@/lib/cn';

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
                'inline-flex h-9 w-9 items-center justify-center rounded-xl',
                'text-slate-500 dark:text-slate-400',
                'hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200',
                'transition-colors',
                className,
            )}
        >
            {mounted ? (
                isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />
            ) : (
                <div className="h-5 w-5" />
            )}
        </button>
    );
}
