'use client';

import { type ReactNode, useId } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn } from '../cn';
import { durations, ease } from '../motion';
import { Backdrop, CloseButton, useOverlay } from './overlay';

interface DrawerProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    /** Which edge the panel slides from. Default right (details, filters). */
    side?: 'right' | 'left' | 'bottom';
    footer?: ReactNode;
    className?: string;
}

const PANEL: Record<NonNullable<DrawerProps['side']>, { cls: string; from: Record<string, string> }> = {
    right: { cls: 'right-0 top-0 h-full w-full max-w-md rounded-l-card-lg', from: { x: '100%' } },
    left: { cls: 'left-0 top-0 h-full w-full max-w-sm rounded-r-card-lg', from: { x: '-100%' } },
    bottom: { cls: 'bottom-0 inset-x-0 max-h-[88dvh] rounded-t-card-lg pb-[env(safe-area-inset-bottom)]', from: { y: '100%' } },
};

/** Side / bottom panel: backdrop fades, panel slides in from its edge. */
export function Drawer({ isOpen, onClose, title, children, side = 'right', footer, className }: DrawerProps) {
    const panelRef = useOverlay(isOpen, onClose);
    const reduce = useReducedMotion();
    const titleId = useId();
    const { cls, from } = PANEL[side];

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50">
                    <Backdrop onClick={onClose} />
                    <motion.div
                        ref={panelRef}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby={titleId}
                        tabIndex={-1}
                        initial={reduce ? { opacity: 0 } : from}
                        animate={reduce ? { opacity: 1 } : { x: 0, y: 0 }}
                        exit={reduce ? { opacity: 0 } : { ...from, transition: { duration: 0.2, ease: ease.in } }}
                        transition={{ duration: durations.medium, ease: ease.out }}
                        className={cn('absolute flex flex-col bg-surface text-text shadow-card-lg outline-none', cls, className)}
                    >
                        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
                            <h2 id={titleId} className="text-[18px] font-bold text-text">{title}</h2>
                            <CloseButton onClick={onClose} className="-mr-2" />
                        </div>
                        <div className="flex-1 overflow-y-auto p-5">{children}</div>
                        {footer && <div className="flex gap-2 border-t border-border p-4 [&>*]:flex-1">{footer}</div>}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
