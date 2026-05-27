'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { BooklyWordmark } from './bookly-wordmark';
import { GlowButton } from '@/components/primitives/glow-button';

const links = [
    { href: '#features', label: 'Features' },
    { href: '#how', label: 'How it works' },
    { href: '#pricing', label: 'Pricing' },
];

/**
 * MarketingNav — ui.md §7.1. Sticky 72px, glassy, darkens on scroll past the
 * hero. Bookly wordmark left, in-page anchors center (md+), auth CTAs right.
 *
 * On mobile a hamburger opens a motion-driven slide-down sheet (framer-motion;
 * no Vaul dep added). The sheet closes on link tap, backdrop tap, or Esc.
 */
export function MarketingNav() {
    const [scrolled, setScrolled] = useState(false);
    const [open, setOpen] = useState(false);
    const reduce = useReducedMotion();

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 60);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Lock body scroll + close on Esc while the mobile sheet is open.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = '';
            window.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <>
            <nav
                className={cn(
                    'fixed top-0 inset-x-0 z-50 h-[64px] sm:h-[72px] flex items-center transition-colors duration-300',
                    'backdrop-blur-xl border-b',
                    scrolled
                        ? 'bg-ink-950/85 border-ink-700/60'
                        : 'bg-ink-950/40 border-ink-700/30',
                )}
            >
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full flex items-center justify-between gap-6">
                    <Link href="/" className="flex items-center" onClick={() => setOpen(false)}>
                        <BooklyWordmark />
                    </Link>

                    {/* Desktop links */}
                    <div className="hidden md:flex items-center gap-7">
                        {links.map((l) => (
                            <Link
                                key={l.href}
                                href={l.href}
                                className="relative text-body-sm text-ink-200 hover:text-ink-50 transition-colors after:absolute after:left-0 after:-bottom-1 after:h-px after:w-0 after:bg-bookly-emerald-400 after:transition-all hover:after:w-full"
                            >
                                {l.label}
                            </Link>
                        ))}
                    </div>

                    {/* Desktop CTAs */}
                    <div className="hidden md:flex items-center gap-3">
                        <Link
                            href="/login"
                            className="text-body-sm text-ink-200 hover:text-ink-50 px-3 py-2 transition-colors"
                        >
                            Sign in
                        </Link>
                        <GlowButton href="/register" size="sm">
                            Start free
                        </GlowButton>
                    </div>

                    {/* Mobile hamburger */}
                    <button
                        type="button"
                        aria-label={open ? 'Close menu' : 'Open menu'}
                        aria-expanded={open}
                        onClick={() => setOpen(!open)}
                        className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-xl border border-ink-700 bg-ink-900/80 text-ink-100 hover:bg-ink-800 transition-colors"
                    >
                        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </div>
            </nav>

            {/* Mobile sheet */}
            <AnimatePresence>
                {open && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            key="backdrop"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: reduce ? 0 : 0.2 }}
                            onClick={() => setOpen(false)}
                            className="md:hidden fixed inset-0 z-40 bg-ink-1000/70 backdrop-blur-sm"
                        />

                        {/* Sheet */}
                        <motion.div
                            key="sheet"
                            initial={{ y: -20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: -20, opacity: 0 }}
                            transition={{
                                duration: reduce ? 0 : 0.28,
                                ease: [0.16, 1, 0.3, 1],
                            }}
                            className="md:hidden fixed top-[64px] inset-x-3 z-50 rounded-2xl border border-ink-700 bg-ink-950/95 backdrop-blur-xl shadow-card-lg overflow-hidden"
                        >
                            <div className="flex flex-col p-2">
                                {links.map((l) => (
                                    <Link
                                        key={l.href}
                                        href={l.href}
                                        onClick={() => setOpen(false)}
                                        className="flex items-center justify-between rounded-xl px-4 py-3.5 text-body text-ink-100 hover:bg-ink-900 transition-colors"
                                    >
                                        {l.label}
                                        <span className="text-ink-400">→</span>
                                    </Link>
                                ))}
                                <div className="border-t border-ink-700/60 my-2" />
                                <Link
                                    href="/login"
                                    onClick={() => setOpen(false)}
                                    className="flex items-center justify-between rounded-xl px-4 py-3.5 text-body text-ink-100 hover:bg-ink-900 transition-colors"
                                >
                                    Sign in
                                    <span className="text-ink-400">→</span>
                                </Link>
                                <div className="px-2 pt-2 pb-1">
                                    <GlowButton href="/register" className="w-full">
                                        Start free
                                    </GlowButton>
                                </div>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
