'use client';

import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    icon?: ReactNode;
    error?: string;
    label?: string;
}

/**
 * Auth-screen input. Password fields get a show/hide toggle automatically:
 * typing a password blind on a phone keyboard is the single most common
 * reason a sign-up fails, and the eye button costs nothing.
 */
const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className, icon, error, label, id, type, ...props }, ref) => {
        const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
        const isPassword = type === 'password';
        const [revealed, setRevealed] = useState(false);
        const resolvedType = isPassword && revealed ? 'text' : type;

        return (
            <div className="space-y-1.5">
                {label && (
                    <label
                        htmlFor={inputId}
                        className="block text-sm font-medium text-ink-100"
                    >
                        {label}
                    </label>
                )}
                <div className="relative group">
                    {icon && (
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-300 group-focus-within:text-bookly-emerald-400 transition-colors">
                            {icon}
                        </div>
                    )}
                    <input
                        ref={ref}
                        id={inputId}
                        type={resolvedType}
                        className={cn(
                            'w-full rounded-xl border bg-ink-900 text-ink-50 placeholder:text-ink-400 transition-colors duration-200',
                            'focus:outline-none focus:ring-4 focus:ring-bookly-emerald-500/15 focus:border-bookly-emerald-500',
                            'border-ink-700 hover:border-ink-600',
                            icon ? 'pl-12' : 'pl-4',
                            isPassword ? 'pr-12' : 'pr-4',
                            'py-3 text-base',
                            error && 'border-rose-500/60 focus:ring-rose-500/15 focus:border-rose-500',
                            className
                        )}
                        {...props}
                    />
                    {isPassword && (
                        <button
                            type="button"
                            onClick={() => setRevealed((v) => !v)}
                            aria-label={revealed ? 'Hide password' : 'Show password'}
                            aria-pressed={revealed}
                            className="absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-lg text-ink-300 hover:text-ink-50 hover:bg-ink-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bookly-emerald-500 transition-colors"
                        >
                            {revealed ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                    )}
                </div>
                {error && (
                    <p className="text-sm text-rose-300">{error}</p>
                )}
            </div>
        );
    }
);

Input.displayName = 'Input';

// Dashboard form input (denser; used inside the app shell).
interface DashboardInputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    icon?: ReactNode;
    error?: string;
}

const DashboardInput = forwardRef<HTMLInputElement, DashboardInputProps>(
    ({ className, label, icon, error, id, ...props }, ref) => {
        const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
        return (
            <div className="space-y-1.5">
                {label && (
                    <label htmlFor={inputId} className="block text-[13px] font-medium text-ink-200">
                        {label}
                    </label>
                )}
                <div className="relative group">
                    {icon && (
                        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300 group-focus-within:text-bookly-emerald-400 transition-colors">
                            {icon}
                        </div>
                    )}
                    <input
                        ref={ref}
                        id={inputId}
                        className={cn(
                            'w-full rounded-xl border transition-colors duration-200',
                            'bg-ink-900 border-ink-700',
                            'text-ink-50 placeholder:text-ink-400',
                            'focus:outline-none focus:ring-4 focus:ring-bookly-emerald-500/15 focus:border-bookly-emerald-500',
                            'hover:border-ink-600',
                            icon ? 'pl-10 pr-4' : 'px-4',
                            'py-2.5',
                            error && 'border-rose-500 focus:ring-rose-500/15 focus:border-rose-500',
                            className
                        )}
                        {...props}
                    />
                </div>
                {error && (
                    <p className="text-sm text-rose-300">{error}</p>
                )}
            </div>
        );
    }
);

DashboardInput.displayName = 'DashboardInput';

export { Input, DashboardInput };
