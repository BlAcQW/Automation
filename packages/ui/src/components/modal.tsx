'use client';

import { type ReactNode, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../cn';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    className?: string;
    maxWidth?: string;
}

export function Modal({ isOpen, onClose, title, children, className, maxWidth = 'max-w-md' }: ModalProps) {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="absolute inset-0 bg-[rgba(18,29,23,0.55)] backdrop-blur-[6px]"
                        onClick={onClose}
                    />

                    {/* Content */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96, y: 14 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.98, y: 8, transition: { duration: 0.15 } }}
                        transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
                        className={cn(
                            'relative w-full rounded-3xl bg-ink-950 text-ink-50 shadow-[0_0_0_1px_rgb(var(--ink-50-rgb)/0.08),0_40px_80px_-36px_rgba(0,0,0,0.6)]',
                            maxWidth,
                            className
                        )}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-4 border-b border-ink-50/[0.08]">
                            <h2 className="text-[1.25rem] font-normal leading-tight tracking-[-0.035em] text-ink-50">{title}</h2>
                            <button
                                type="button"
                                onClick={onClose}
                                aria-label="Close"
                                className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded text-ink-300 hover:bg-ink-50/[0.06] hover:text-ink-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-6">
                            {children}
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
