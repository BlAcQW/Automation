'use client';

import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../cn';
import { durations, ease } from '../motion';

/**
 * Shared overlay plumbing for Modal / Drawer / ConfirmDialog: locks body
 * scroll, closes on Escape, moves focus into the panel and restores it.
 */
export function useOverlay(isOpen: boolean, onClose: () => void) {
    const panelRef = useRef<HTMLDivElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        if (!isOpen) return;
        const previous = document.activeElement as HTMLElement | null;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCloseRef.current();
        };
        document.addEventListener('keydown', onKey);
        // Focus the first focusable control in the panel (after it mounts).
        const t = window.setTimeout(() => {
            const el = panelRef.current?.querySelector<HTMLElement>(
                '[data-autofocus], input, select, textarea, button:not([data-close]), [href], [tabindex]:not([tabindex="-1"])',
            );
            (el ?? panelRef.current)?.focus();
        }, 30);
        return () => {
            window.clearTimeout(t);
            document.body.style.overflow = '';
            document.removeEventListener('keydown', onKey);
            previous?.focus?.();
        };
    }, [isOpen]);

    return panelRef;
}

/** Fading charcoal backdrop. */
export function Backdrop({ onClick }: { onClick: () => void }) {
    const reduce = useReducedMotion();
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.15, ease: ease.in } }}
            transition={{ duration: reduce ? 0 : durations.short, ease: ease.out }}
            className="absolute inset-0 bg-charcoal/45 backdrop-blur-[2px]"
            onClick={onClick}
            aria-hidden
        />
    );
}

export function CloseButton({ onClick, className }: { onClick: () => void; className?: string }) {
    return (
        <button
            type="button"
            data-close
            onClick={onClick}
            aria-label="Close"
            className={cn(
                'flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-text/[0.06] hover:text-text',
                className,
            )}
        >
            <X className="h-5 w-5" />
        </button>
    );
}
