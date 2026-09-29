'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, ArrowRight } from 'lucide-react';

/**
 * Site chrome: nav, mobile menu, sticky mobile CTA, footer.
 *
 * Mobile is the primary target, not a fallback. The owners this is written
 * for run the business from a phone, usually a cheap one, often one-handed
 * between clients. So: a real full-screen menu rather than a cramped
 * dropdown, 48px tap targets throughout, and a persistent CTA bar on small
 * screens so signing up is never more than one thumb-reach away.
 */

const NAV = [
    { href: '/features', label: 'What it does' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/faq', label: 'Questions' },
];

export function Nav() {
    const [open, setOpen] = useState(false);
    const path = usePathname();

    // Close on navigation, and never leave the page scroll-locked behind a
    // menu that is no longer visible.
    useEffect(() => { setOpen(false); }, [path]);
    useEffect(() => {
        document.body.style.overflow = open ? 'hidden' : '';
        return () => { document.body.style.overflow = ''; };
    }, [open]);

    return (
        <>
            <header
                className="sticky z-50 border-b backdrop-blur-xl"
                style={{
                    top: 'env(safe-area-inset-top, 0px)',
                    background: 'rgba(12,10,9,0.72)',
                    borderColor: 'var(--border)',
                }}
            >
                <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8" aria-label="Main">
                    <Link href="/" className="font-display text-xl" style={{ color: 'var(--foreground)' }}>
                        Bookly
                    </Link>

                    <div className="hidden items-center gap-8 md:flex">
                        {NAV.map((l) => (
                            <Link
                                key={l.href}
                                href={l.href}
                                className="text-sm transition-colors"
                                style={{ color: path === l.href ? 'var(--primary)' : 'var(--muted-foreground)' }}
                            >
                                {l.label}
                            </Link>
                        ))}
                    </div>

                    <div className="flex items-center gap-1.5">
                        <Link
                            href="/login"
                            className="hidden min-h-[44px] items-center px-3 text-sm sm:inline-flex"
                            style={{ color: 'var(--foreground)' }}
                        >
                            Log in
                        </Link>
                        <Link
                            href="/register"
                            className="hidden min-h-[44px] items-center rounded-xl px-4 text-sm font-semibold sm:inline-flex"
                            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                        >
                            Get started
                        </Link>

                        <button
                            type="button"
                            onClick={() => setOpen((v) => !v)}
                            aria-label={open ? 'Close menu' : 'Open menu'}
                            aria-expanded={open}
                            className="flex h-11 w-11 items-center justify-center rounded-xl md:hidden"
                            style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
                        >
                            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                        </button>
                    </div>
                </nav>
            </header>

            {/* Full-screen sheet. A dropdown at this width means mis-taps. */}
            {open && (
                <div
                    className="fixed inset-0 z-40 flex flex-col px-5 pb-8 md:hidden"
                    style={{
                        background: 'var(--background)',
                        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 76px)',
                    }}
                >
                    <div className="flex flex-col gap-1">
                        {NAV.map((l) => (
                            <Link
                                key={l.href}
                                href={l.href}
                                className="flex min-h-[56px] items-center justify-between border-b text-lg"
                                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                            >
                                {l.label}
                                <ArrowRight className="h-4 w-4" style={{ color: 'var(--muted-foreground)' }} />
                            </Link>
                        ))}
                    </div>

                    <div className="mt-auto flex flex-col gap-3">
                        <Link
                            href="/register"
                            className="flex min-h-[52px] items-center justify-center rounded-xl text-base font-semibold"
                            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                        >
                            Get started free
                        </Link>
                        <Link
                            href="/login"
                            className="flex min-h-[52px] items-center justify-center rounded-xl text-base"
                            style={{ border: '1px solid var(--border)', color: 'var(--foreground)' }}
                        >
                            Log in
                        </Link>
                    </div>
                </div>
            )}
        </>
    );
}

/**
 * Persistent CTA on small screens.
 *
 * On a phone the buttons in the hero scroll away within one swipe. This keeps
 * the one action that matters within thumb reach for the whole page.
 */
export function MobileCTA() {
    return (
        <div
            className="fixed inset-x-0 bottom-0 z-40 border-t px-4 py-3 backdrop-blur-xl md:hidden"
            style={{
                background: 'rgba(12,10,9,0.9)',
                borderColor: 'var(--border)',
                paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 0.75rem)',
            }}
        >
            <Link
                href="/register"
                className="flex min-h-[48px] items-center justify-center gap-2 rounded-xl text-[15px] font-semibold"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
            >
                Get started free <ArrowRight className="h-4 w-4" />
            </Link>
        </div>
    );
}

export function Footer() {
    const cols = [
        { h: 'Product', links: [['What it does', '/features'], ['Pricing', '/pricing'], ['Questions', '/faq']] },
        { h: 'Account', links: [['Log in', '/login'], ['Get started', '/register'], ['Support', '/support']] },
        { h: 'Legal', links: [['Privacy', '/privacy'], ['Terms', '/terms']] },
    ];
    return (
        <footer
            className="border-t px-5 pb-28 pt-14 sm:px-8 md:pb-14"
            style={{ borderColor: 'var(--border)' }}
        >
            <div className="mx-auto grid max-w-6xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                    <p className="font-display text-xl" style={{ color: 'var(--foreground)' }}>Bookly</p>
                    <p className="mt-2 max-w-xs text-sm leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                        A receptionist for your WhatsApp and Instagram. Built for small
                        appointment businesses in Ghana and across West Africa.
                    </p>
                </div>
                {cols.map((c) => (
                    <div key={c.h}>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--foreground)' }}>{c.h}</p>
                        <ul className="mt-3 space-y-1">
                            {c.links.map(([label, href]) => (
                                <li key={label}>
                                    <Link
                                        href={href}
                                        className="flex min-h-[40px] items-center text-sm"
                                        style={{ color: 'var(--muted-foreground)' }}
                                    >
                                        {label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
            <div
                className="mx-auto mt-10 flex max-w-6xl flex-col gap-2 border-t pt-6 text-xs sm:flex-row sm:justify-between"
                style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
            >
                <p>© {new Date().getFullYear()} Bookly. All rights reserved.</p>
                <p>Made in Ghana.</p>
            </div>
        </footer>
    );
}
