'use client';

import { type ReactNode, useId } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn } from '../cn';
import { durations, ease } from '../motion';
import { Backdrop, CloseButton, useOverlay } from './overlay';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    className?: string;
    maxWidth?: string;
    /** Optional line under the title. */
    description?: ReactNode;
    /** Optional sticky action row (right-aligned buttons). */
    footer?: ReactNode;
}

/**
 * Centred dialog on desktop; a bottom sheet on phones (thumb reach).
 * Backdrop fades, the panel slides up 16px. Escape and backdrop close it.
 */
export function Modal({ isOpen, onClose, title, children, className, maxWidth = 'max-w-md', description, footer }: ModalProps) {
    const panelRef = useOverlay(isOpen, onClose);
    const reduce = useReducedMotion();
    const titleId = useId();

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
                    <Backdrop onClick={onClose} />
                    <motion.div
                        ref={panelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        tabIndex={-1}
                        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, transition: { duration: 0.15, ease: ease.in } }}
                        transition={{ duration: durations.medium, ease: ease.out }}
                        className={cn(
                            'relative flex max-h-[92dvh] w-full flex-col rounded-t-card-lg bg-surface text-text shadow-card-lg outline-none sm:rounded-card-lg',
                            'pb-[env(safe-area-inset-bottom)] sm:pb-0',
                            maxWidth,
                            className
                        )}
                    >
                        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3 sm:px-6">
                            <div className="min-w-0 pt-1.5">
                                <h2 id={titleId} className="text-[20px] font-bold leading-tight text-text">{title}</h2>
                                {description && <p className="mt-1 text-[15px] text-muted">{description}</p>}
                            </div>
                            <CloseButton onClick={onClose} className="-mr-2" />
                        </div>
                        <div className="overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
                        {footer && (
                            <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                                {footer}
                            </div>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
