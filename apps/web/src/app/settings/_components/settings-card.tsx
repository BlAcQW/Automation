'use client';

/**
 * Settings page building blocks: a sectioned card, an on/off row and the
 * "Saved" tick that pops next to a save button.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Card, CardContent, TickPop, cn } from '@bookingflow/ui';

interface SettingsCardProps {
    icon: ReactNode;
    title: string;
    description?: ReactNode;
    children: ReactNode;
    /** `danger` gives the card a red edge (delete account). */
    tone?: 'default' | 'danger';
    id?: string;
}

export function SettingsCard({ icon, title, description, children, tone = 'default', id }: SettingsCardProps) {
    return (
        <Card id={id} className={cn(tone === 'danger' && 'border-error/40')}>
            <div className="flex items-start gap-3 border-b border-border px-5 py-4 sm:px-6">
                <span
                    className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-control [&_svg]:h-5 [&_svg]:w-5',
                        tone === 'danger' ? 'bg-error-soft text-error-fg' : 'bg-primary-soft text-primary',
                    )}
                    aria-hidden
                >
                    {icon}
                </span>
                <div className="min-w-0">
                    <h3 className="text-[18px] font-bold leading-snug text-text">{title}</h3>
                    {description && <p className="mt-0.5 text-[15px] leading-relaxed text-muted">{description}</p>}
                </div>
            </div>
            <CardContent className="space-y-5">{children}</CardContent>
        </Card>
    );
}

interface ToggleRowProps {
    title: string;
    description: ReactNode;
    /** The Switch. */
    control: ReactNode;
}

export function ToggleRow({ title, description, control }: ToggleRowProps) {
    return (
        <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
                <p className="text-base font-semibold text-text">{title}</p>
                <p className="mt-1 max-w-[60ch] text-[15px] leading-relaxed text-muted">{description}</p>
            </div>
            <div className="pt-1">{control}</div>
        </div>
    );
}

/** Row under a form: the save button, then a tick + "Saved" for a moment. */
export function SaveRow({ children, saved, label = 'Saved' }: { children: ReactNode; saved: number; label?: string }) {
    return (
        <div className="flex flex-wrap items-center gap-3 pt-1">
            {children}
            {saved > 0 && (
                <span key={saved} className="inline-flex items-center gap-2 text-[15px] font-semibold text-success-fg" role="status">
                    <TickPop size={28} label={label} />
                    {label}
                </span>
            )}
        </div>
    );
}

/**
 * `flash()` shows the SaveRow tick for 3 seconds; each call replays it.
 * Returns a counter (0 = hidden) so the TickPop re-mounts every time.
 */
export function useSavedFlash(): [number, () => void] {
    const [saved, setSaved] = useState(0);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    useEffect(() => () => clearTimeout(timer.current), []);
    const flash = useCallback(() => {
        clearTimeout(timer.current);
        setSaved((n) => n + 1);
        timer.current = setTimeout(() => setSaved(0), 3000);
    }, []);
    return [saved, flash];
}
