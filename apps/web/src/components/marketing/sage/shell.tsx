import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { Section, Eyebrow, Heading } from './sections';
import { HeroReveal, AnimatedChat, Reveal, LiftCard } from './motion';

/** Nav, hero, pricing and footer for the Sage Cream landing page. */

export function Nav() {
    const links = [
        { href: '#features', label: 'What it does' },
        { href: '#channels', label: 'Where it works' },
        { href: '#how', label: 'Getting started' },
        { href: '#pricing', label: 'Pricing' },
        { href: '#faq', label: 'Questions' },
    ];
    return (
        <header
            className="sticky z-50 border-b backdrop-blur-md"
            style={{
                top: 'env(safe-area-inset-top, 0px)',
                background: 'rgba(255,252,240,0.85)',
                borderColor: 'var(--border)',
            }}
        >
            <nav className="mx-auto flex max-w-5xl items-center justify-between gap-6 px-5 py-3.5 sm:px-8" aria-label="Main">
                <Link href="/" className="font-display text-xl" style={{ color: 'var(--foreground)' }}>
                    Bookly
                </Link>

                <div className="hidden items-center gap-7 md:flex">
                    {links.map((l) => (
                        <a
                            key={l.href}
                            href={l.href}
                            className="text-sm transition-colors hover:opacity-70"
                            style={{ color: 'var(--muted-foreground)' }}
                        >
                            {l.label}
                        </a>
                    ))}
                </div>

                <div className="flex items-center gap-2">
                    <Link
                        href="/login"
                        className="hidden min-h-[44px] items-center px-3 text-sm sm:inline-flex"
                        style={{ color: 'var(--foreground)' }}
                    >
                        Log in
                    </Link>
                    <Link
                        href="/register"
                        className="inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-semibold transition-opacity hover:opacity-90"
                        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                        Get started
                    </Link>
                </div>
            </nav>
        </header>
    );
}

/**
 * Hero. The thesis is the positioning line, and the proof beside it is the
 * product doing its actual job — a customer booking in a chat.
 */
export function Hero() {
    return (
        <section className="grain relative overflow-hidden px-5 pb-16 pt-16 sm:px-8 sm:pb-24 sm:pt-24">
            <div className="mx-auto grid max-w-5xl gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
                <div>
                    <HeroReveal>
                    <span
                        className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium"
                        style={{ background: 'var(--secondary)', color: 'var(--foreground)' }}
                    >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--primary)' }} />
                        WhatsApp · Instagram · Messenger
                    </span>
                    </HeroReveal>

                    <HeroReveal delay={0.08}>
                    <h1
                        className="font-display mt-6 text-[2.75rem] leading-[1.03] sm:text-6xl"
                        style={{ color: 'var(--foreground)', textWrap: 'balance' }}
                    >
                        Never lose a booking because you were busy.
                    </h1>
                    </HeroReveal>

                    <HeroReveal delay={0.16}>
                    <p className="mt-6 max-w-lg text-[17px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
                        Bookly is a receptionist for your WhatsApp and Instagram. It answers
                        customers while you&apos;re working, books them into times you&apos;re really
                        free, and takes a deposit so they actually show up.
                    </p>
                    </HeroReveal>

                    <HeroReveal delay={0.24}>
                    <div className="mt-8 flex flex-wrap items-center gap-3">
                        <Link
                            href="/register"
                            className="inline-flex min-h-[48px] items-center gap-2 rounded-lg px-6 text-[15px] font-semibold transition-opacity hover:opacity-90"
                            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                        >
                            Get started free <ArrowRight className="h-4 w-4" />
                        </Link>
                        <a
                            href="#how"
                            className="inline-flex min-h-[48px] items-center rounded-lg border px-6 text-[15px] font-medium"
                            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                        >
                            See how it works
                        </a>
                    </div>

                    <p className="mt-5 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                        No payment gateway to set up. No card to start.
                    </p>
                    </HeroReveal>
                </div>

                <HeroReveal delay={0.2}>
                    <AnimatedChat />
                </HeroReveal>
            </div>
        </section>
    );
}

/**
 * Pricing. Deliberately neutral: the tiers are named and shaped, the numbers
 * are not set. Inventing a price here would contradict the positioning work,
 * which says the number comes after the product can prove what it recovers.
 */
export function Pricing() {
    const tiers = [
        {
            name: 'Solo',
            who: 'One person, one chair',
            points: ['The assistant on all channels', 'Deposits and reminders', 'Mobile app', 'Your own diary'],
            featured: false,
        },
        {
            name: 'Team',
            who: '2–8 people',
            points: ['Everything in Solo', 'Staff logins', 'Customer numbers hidden from staff', 'Shared inbox'],
            featured: true,
        },
        {
            name: 'Enterprise',
            who: 'Groups and resellers',
            points: ['Everything in Team', 'Your own branding', 'Several locations', 'Priority support'],
            featured: false,
        },
    ];

    return (
        <Section id="pricing">
            <Eyebrow>Pricing</Eyebrow>
            <Heading sub="We're still setting the prices. What we can tell you now is the shape — and that there's a free way to start.">
                Three plans. Numbers coming soon.
            </Heading>

            <Reveal className="mt-12 grid gap-5 lg:grid-cols-3">
                {tiers.map((t) => (
                    <LiftCard
                        key={t.name}
                        className="flex flex-col rounded-2xl p-7"
                        style={{
                            background: t.featured ? 'var(--secondary)' : 'var(--background)',
                            border: `1px solid ${t.featured ? 'var(--primary)' : 'var(--border)'}`,
                        }}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="font-display text-2xl" style={{ color: 'var(--foreground)' }}>{t.name}</h3>
                            {t.featured && (
                                <span
                                    className="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
                                    style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                                >
                                    Most shops
                                </span>
                            )}
                        </div>
                        <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>{t.who}</p>

                        <p className="mt-6 text-2xl font-semibold" style={{ color: 'var(--foreground)' }}>Coming soon</p>
                        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Pricing announced shortly</p>

                        <ul className="mt-6 flex-1 space-y-2.5">
                            {t.points.map((p) => (
                                <li key={p} className="flex gap-2.5 text-[14px]" style={{ color: 'var(--foreground)' }}>
                                    <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--primary)' }} />
                                    {p}
                                </li>
                            ))}
                        </ul>

                        <Link
                            href="/register"
                            className="mt-7 inline-flex min-h-[44px] items-center justify-center rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
                            style={
                                t.featured
                                    ? { background: 'var(--primary)', color: 'var(--primary-foreground)' }
                                    : { border: '1px solid var(--border)', color: 'var(--foreground)' }
                            }
                        >
                            Start free
                        </Link>
                    </LiftCard>
                ))}
            </Reveal>

            <p className="mt-8 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                You pay Meta&apos;s own message rates directly on WhatsApp — we add nothing on top.
                Instagram and Messenger cost nothing at all.
            </p>
        </Section>
    );
}

export function Footer() {
    const cols = [
        { h: 'Product', links: [['What it does', '#features'], ['Where it works', '#channels'], ['Pricing', '#pricing'], ['Questions', '#faq']] },
        { h: 'Account', links: [['Log in', '/login'], ['Get started', '/register'], ['Support', '/support']] },
        { h: 'Legal', links: [['Privacy', '/privacy'], ['Terms', '/terms']] },
    ];
    return (
        <footer className="border-t px-5 py-14 sm:px-8" style={{ borderColor: 'var(--border)' }}>
            <div className="mx-auto grid max-w-5xl gap-10 sm:grid-cols-2 lg:grid-cols-4">
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
                        <ul className="mt-3 space-y-2">
                            {c.links.map(([label, href]) => (
                                <li key={label}>
                                    <Link
                                        href={href}
                                        className="text-sm transition-opacity hover:opacity-70"
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
                className="mx-auto mt-12 flex max-w-5xl flex-col gap-2 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between"
                style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
            >
                <p>© {new Date().getFullYear()} Bookly. All rights reserved.</p>
                <p>Made in Ghana.</p>
            </div>
        </footer>
    );
}
