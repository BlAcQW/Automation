'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, ArrowUpRight, CalendarCheck } from 'lucide-react';

/**
 * Site chrome: nav, sticky mobile CTA, footer — after the reference's
 * floating nav (21st.dev maroon-fintech-landing). The logo sits in a paper
 * pill with a forest burger; the burger opens a night dropdown that is the
 * whole menu at every width. Buttons float on the right.
 *
 * Mobile is still the primary target: the dropdown rows are 48px tall, the
 * burger is the only control on a 360px screen besides "Log in", and the
 * sticky bottom CTA keeps sign-up within thumb reach for the whole page.
 */

const NAV = [
    { href: '/', label: 'Home' },
    { href: '/features', label: 'What it does' },
    { href: '/pricing', label: 'Pricing' },
    { href: '/faq', label: 'Questions' },
    { href: '/support', label: 'Support' },
];

export function Logo() {
    return (
        <Link href="/" className="fs-logo" aria-label="Bookly home">
            <span className="fs-logo-mark" aria-hidden>
                <CalendarCheck className="h-3 w-3" strokeWidth={2.4} />
            </span>
            <span>
                Bookly<span className="fs-logo-dot">.</span>
            </span>
        </Link>
    );
}

export function Nav() {
    const [open, setOpen] = useState(false);
    const path = usePathname();
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => { setOpen(false); }, [path]);

    // Close on outside click and Escape; the dropdown is a disclosure, not a modal.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: PointerEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    // Lift the floating controls once the page has scrolled under them.
    useEffect(() => {
        const root = document.querySelector('.theme-site');
        const onScroll = () => root?.classList.toggle('fs-scrolled', window.scrollY > 24);
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    return (
        <nav className="fs-nav" aria-label="Main">
            <div className="fs-nav-l" ref={menuRef}>
                <div className="fs-logo-pill">
                    <Logo />
                    <button
                        type="button"
                        className={`fs-burger${open ? ' is-open' : ''}`}
                        onClick={() => setOpen((v) => !v)}
                        aria-label={open ? 'Close menu' : 'Open menu'}
                        aria-expanded={open}
                        aria-controls="site-menu"
                    >
                        <i /><i />
                    </button>
                </div>
                {open && (
                    <div className="fs-dropdown" id="site-menu">
                        <ul>
                            {NAV.map((l, i) => (
                                <li key={l.href} style={{ animationDelay: `${40 + i * 35}ms` }}>
                                    <Link href={l.href} aria-current={path === l.href ? 'page' : undefined}>
                                        <span className="fs-dd-n">0{i + 1}</span>
                                        {l.label}
                                        <ArrowUpRight className="h-4 w-4" />
                                    </Link>
                                </li>
                            ))}
                        </ul>
                        <div className="fs-dd-foot">
                            <span className="fs-live" aria-hidden />
                            Answering customers right now
                        </div>
                    </div>
                )}
            </div>

            <div className="fs-nav-r">
                <Link href="/login" className="fs-btn fs-btn--sm fs-btn--white">Log in</Link>
                <Link href="/register" className="fs-btn fs-btn--sm fs-btn--brand fs-hide-sm">Get started</Link>
            </div>
        </nav>
    );
}

/** Persistent CTA on small screens, so sign-up never scrolls away. */
export function MobileCTA() {
    return (
        <div className="fs-mobile-cta md:hidden">
            <Link href="/register" className="fs-btn fs-btn--lg fs-btn--cream fs-btn--wide">
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
        <div className="fs-night">
            <footer className="fs-foot">
                <div className="fs-foot-top">
                    <div className="fs-foot-brand">
                        <Logo />
                        <p>
                            A receptionist for your WhatsApp and Instagram. Built for small
                            appointment businesses in Ghana and across West Africa.
                        </p>
                    </div>
                    {cols.map((c) => (
                        <div key={c.h} className="fs-foot-col">
                            <p>{c.h}</p>
                            <ul>
                                {c.links.map(([label, href]) => (
                                    <li key={label}><Link href={href}>{label}</Link></li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
                <div className="fs-wordmark" aria-hidden>
                    Bookly<span>.</span>
                </div>
                <div className="fs-foot-bot">
                    <span>© {new Date().getFullYear()} Bookly. All rights reserved.</span>
                    <span>Made in Ghana.</span>
                </div>
            </footer>
        </div>
    );
}
