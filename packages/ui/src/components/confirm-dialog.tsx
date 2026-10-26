'use client';

import { type ReactNode, useId } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../cn';
import { durations, ease } from '../motion';
import { Button } from './button';
import { Backdrop, useOverlay } from './overlay';

interface ConfirmDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    /** A question in plain words: "Delete this service?" */
    title: string;
    /** What happens, and whether it can be undone. */
    description?: ReactNode;
    /** Verb for the button: "Delete", "Cancel booking". */
    confirmLabel?: string;
    cancelLabel?: string;
    /** Red button + warning icon. Default true (this is for destructive actions). */
    destructive?: boolean;
    isLoading?: boolean;
}

/**
 * Confirmation for destructive actions. Focus lands on the safe choice
 * (Keep / Cancel) so Enter never deletes by accident.
 */
export function ConfirmDialog({
    isOpen,
    onClose,
    onConfirm,
    title,
    description,
    confirmLabel = 'Delete',
    cancelLabel = 'Keep it',
    destructive = true,
    isLoading = false,
}: ConfirmDialogProps) {
    const panelRef = useOverlay(isOpen, onClose);
    const reduce = useReducedMotion();
    const titleId = useId();
    const descId = useId();

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                    <Backdrop onClick={onClose} />
                    <motion.div
                        ref={panelRef}
                        role="alertdialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        aria-describedby={description ? descId : undefined}
                        tabIndex={-1}
                        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, transition: { duration: 0.15, ease: ease.in } }}
                        transition={{ duration: durations.short, ease: ease.out }}
                        className="relative w-full max-w-sm rounded-card-lg bg-surface p-6 text-text shadow-card-lg outline-none"
                    >
                        <div
                            className={cn(
                                'mb-4 flex h-12 w-12 items-center justify-center rounded-full',
                                destructive ? 'bg-error-soft text-error-fg' : 'bg-warning-soft text-warning-fg',
                            )}
                            aria-hidden
                        >
                            <AlertTriangle className="h-6 w-6" />
                        </div>
                        <h2 id={titleId} className="text-[20px] font-bold leading-tight">{title}</h2>
                        {description && <p id={descId} className="mt-2 text-[15px] leading-relaxed text-muted">{description}</p>}
                        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <Button variant="secondary" onClick={onClose} data-autofocus disabled={isLoading}>
                                {cancelLabel}
                            </Button>
                            <Button variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm} isLoading={isLoading}>
                                {confirmLabel}
                            </Button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
