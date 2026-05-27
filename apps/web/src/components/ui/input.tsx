'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    icon?: ReactNode;
    error?: string;
    label?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ className, icon, error, label, id, ...props }, ref) => {
        const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
        return (
            <div className="space-y-1.5">
                {label && (
                    <label
                        htmlFor={inputId}
                        className="block text-sm font-medium text-slate-300"
                    >
                        {label}
                    </label>
                )}
                <div className="relative group">
                    {icon && (
                        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-emerald-400 transition-colors">
                            {icon}
                        </div>
                    )}
                    <input
                        ref={ref}
                        id={inputId}
                        className={cn(
                            'w-full rounded-xl border bg-white/5 text-white placeholder:text-slate-500 transition-all duration-200',
                            'focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/60',
                            'border-white/10 hover:border-white/20',
                            icon ? 'pl-12 pr-4' : 'px-4',
                            'py-3',
                            error && 'border-red-500/50 focus:ring-red-500/40 focus:border-red-500/60',
                            className
                        )}
                        {...props}
                    />
                </div>
                {error && (
                    <p className="text-sm text-red-400">{error}</p>
                )}
            </div>
        );
    }
);

Input.displayName = 'Input';

// Light theme variant for dashboard forms
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
                    <label htmlFor={inputId} className="block text-caption uppercase tracking-wider text-ink-300">
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
                            'w-full rounded-xl border transition-all duration-200',
                            'bg-ink-900 border-ink-700',
                            'text-ink-50 placeholder:text-ink-300',
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
                    <p className="text-sm text-rose-300 animate-in slide-in-from-top-1 fade-in duration-200">{error}</p>
                )}
            </div>
        );
    }
);

DashboardInput.displayName = 'DashboardInput';

export { Input, DashboardInput };
