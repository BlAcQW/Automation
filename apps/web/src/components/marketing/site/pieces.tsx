import Link from 'next/link';
import {
    MessageCircle, Instagram, Facebook, Wallet, CalendarCheck,
    BellRing, ShieldCheck, Users, ArrowRight, Check,
} from 'lucide-react';
import { Reveal, LiftCard } from './motion';

/**
 * Shared marketing pieces.
 *
 * Spacing is tuned for a 360px phone first — `py-16` on mobile rising to
 * `py-24` on desktop, rather than a desktop rhythm scaled down. Every
 * interactive element clears 44px.
 */

export function Section({
    id, children, tint, className = '',
}: {
    id?: string; children: React.ReactNode; tint?: boolean; className?: string;
}) {
    // Night by default. `tint` lifts the block onto a paper inset panel, the
    // reference's rhythm of night band / paper sheet / night band.
    if (tint) {
        return (
            <section id={id} className={`fs-night ${className}`}>
                <div className="fs-inset fs-paper">
                    <div className="fs-wrap">{children}</div>
                </div>
            </section>
        );
    }
    return (
        <section id={id} className={`fs-night fs-section ${className}`}>
            <div className="fs-wrap">{children}</div>
        </section>
    );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
    return <p className="fs-badge mb-5">{children}</p>;
}

export function Heading({ children, sub }: { children: React.ReactNode; sub?: string }) {
    return (
        <div className="max-w-3xl">
            <h2
                className="text-[2.1rem] leading-[1.02] sm:text-[3.2rem]"
                style={{ color: 'var(--foreground)', textWrap: 'balance', fontWeight: 400, letterSpacing: '-0.05em' }}
            >
                {children}
            </h2>
            {sub && (
                <p className="mt-4 max-w-xl text-[15px] leading-relaxed sm:text-[16px]" style={{ color: 'var(--muted-foreground)' }}>
                    {sub}
                </p>
            )}
        </div>
    );
}

/** Inner-page hero: the paper panel with a left-aligned head. */
export function PageHero({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
    return (
        <header className="fs-hero fs-paper">
            <div className="fs-hero-grid" aria-hidden />
            <div className="fs-hero-head fs-hero-head--left" style={{ paddingBottom: 72 }}>
                <p className="fs-key fs-in">/{eyebrow.toLowerCase()}/</p>
                <h1 className="fs-h1 fs-h1--page fs-in">{title}</h1>
                <p className="fs-sub fs-in">{sub}</p>
            </div>
        </header>
    );
}

export function CTA({ href, children, variant = 'solid' }: {
    href: string; children: React.ReactNode; variant?: 'solid' | 'ghost';
}) {
    return (
        <Link
            href={href}
            className={`fs-btn fs-btn--lg w-full sm:w-auto ${variant === 'solid' ? 'fs-btn--brand' : 'fs-btn--ghost'}`}
        >
            {children}
        </Link>
    );
}

/* ---------------------------------------------------------------- */

export const JOBS = [
    { icon: MessageCircle, t: 'Answers while you work', d: "Replies in seconds, at any hour, so the booking doesn't go to the salon down the road." },
    { icon: CalendarCheck, t: 'Only offers real free times', d: 'Checks your hours, your days off, your bookings and how many customers you take at once.' },
    { icon: Wallet, t: 'Takes the deposit up front', d: 'Mobile Money or card. The slot is held for 30 minutes and released if nobody pays.' },
    { icon: BellRing, t: 'Reminds them before the day', d: 'The biggest reason a deposit turns into someone actually turning up.' },
    { icon: Users, t: 'Keeps one diary', d: 'Replaces the notebook and the "I think I have someone at two".' },
    { icon: Instagram, t: 'Answers where you advertise', d: 'Instagram and Messenger too — one assistant, one diary behind all three.' },
    { icon: ShieldCheck, t: 'Keeps your customer list yours', d: 'Staff see only the last four digits. They can work; they cannot copy your book.' },
];

export function JobsGrid() {
    return (
        <Reveal className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {JOBS.map(({ icon: Icon, t, d }) => (
                <div key={t} className="flex gap-4">
                    <div
                        className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[5px]"
                        style={{ background: 'var(--card)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 0 1px var(--border)' }}
                    >
                        <Icon className="h-[18px] w-[18px]" style={{ color: 'var(--primary)' }} />
                    </div>
                    <div>
                        <h3 className="text-[16px] font-medium tracking-[-0.02em]" style={{ color: 'var(--foreground)' }}>{t}</h3>
                        <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{d}</p>
                    </div>
                </div>
            ))}
        </Reveal>
    );
}

export function ChannelCards() {
    const items = [
        { icon: MessageCircle, n: 'WhatsApp', d: 'Bookings, deposits and reminders.' },
        { icon: Instagram, n: 'Instagram', d: 'Answers the DMs your posts already bring in.' },
        { icon: Facebook, n: 'Messenger', d: 'Answers messages to your Page.' },
    ];
    return (
        <Reveal className="grid gap-4 sm:grid-cols-3">
            {items.map(({ icon: Icon, n, d }) => (
                <LiftCard
                    key={n}
                    className="rounded-[6px] p-6"
                    style={{ background: 'var(--card)', boxShadow: '0 30px 50px -28px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)' }}
                >
                    <span className="fs-ico" style={{ width: 32, height: 32 }}><Icon className="h-4 w-4" style={{ color: 'var(--primary)' }} /></span>
                    <h3 className="mt-6 text-[20px] font-normal tracking-[-0.03em]" style={{ color: 'var(--foreground)' }}>{n}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{d}</p>
                </LiftCard>
            ))}
        </Reveal>
    );
}

/** The differentiator: nothing to set up. Given its own block wherever used. */
export function NoSetupBlock() {
    return (
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
                <Eyebrow>No accounts. No keys.</Eyebrow>
                <Heading sub="Taking payments and sending texts are the two steps that stop people. Everyone else sends you off to open an account somewhere and paste in a secret key. We just do it.">
                    You never touch a payment gateway.
                </Heading>
                <ul className="mt-7 space-y-3">
                    {[
                        'Customers pay through us — Mobile Money or card',
                        'Send your money to your own MoMo whenever you want',
                        'Text reminders go out on our account, not yours',
                        'Nothing to sign up for, nothing to copy and paste',
                    ].map((l) => (
                        <li key={l} className="flex gap-3 text-[15px]" style={{ color: 'var(--foreground)' }}>
                            <Check className="mt-0.5 h-[18px] w-[18px] shrink-0" style={{ color: 'var(--primary)' }} />
                            {l}
                        </li>
                    ))}
                </ul>
            </div>

            <div
                className="rounded-[6px] p-6 sm:p-7"
                style={{ background: 'var(--forest-card)', color: 'var(--forest-cream)', boxShadow: '0 40px 70px -40px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06)', ['--foreground' as string]: 'var(--forest-cream)', ['--muted-foreground' as string]: 'rgba(236,235,225,0.6)', ['--border' as string]: 'rgba(236,235,225,0.12)' }}
            >
                <p className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
                    Ready to withdraw
                </p>
                <p className="mt-2 text-[2.9rem] font-light leading-none tracking-[-0.045em] tabular-nums">GHS 1,240</p>
                <div className="mt-5 space-y-2.5 border-t pt-5 text-sm" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex justify-between">
                        <span style={{ color: 'var(--muted-foreground)' }}>Still clearing</span>
                        <span className="tabular-nums" style={{ color: 'var(--foreground)' }}>GHS 300</span>
                    </div>
                    <div className="flex justify-between">
                        <span style={{ color: 'var(--muted-foreground)' }}>Goes to</span>
                        <span className="tabular-nums" style={{ color: 'var(--foreground)' }}>MTN · 024 ••• 4567</span>
                    </div>
                </div>
                <div className="fs-btn fs-btn--cream fs-btn--wide mt-6" aria-hidden>
                    Send to my MoMo <ArrowRight className="h-4 w-4" />
                </div>
            </div>
        </div>
    );
}

export function ClosingCTA({ title, sub }: { title: string; sub: string }) {
    return (
        <section className="fs-night">
            <div className="fs-cta">
                <span className="fs-cta-mark" aria-hidden><Sparkle /></span>
                <h2 className="fs-h2" style={{ maxWidth: '16ch', color: 'var(--forest-cream)' }}>{title}</h2>
                <p className="fs-feat-sub">{sub}</p>
                <div className="fs-actions" style={{ marginTop: 30 }}>
                    <Link href="/register" className="fs-btn fs-btn--lg fs-btn--cream">
                        Get started free <ArrowRight className="h-4 w-4" />
                    </Link>
                    <Link href="/pricing" className="fs-btn fs-btn--lg fs-btn--ghost">See pricing</Link>
                </div>
            </div>
        </section>
    );
}

/** Six-petal mark from the reference's CTA, drawn as plain strokes. */
function Sparkle() {
    return (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            {[0, 60, 120].map((r) => (
                <line key={r} x1="12" y1="3" x2="12" y2="21" transform={`rotate(${r} 12 12)`} />
            ))}
        </svg>
    );
}

/**
 * Trust strip.
 *
 * Only claims that are actually true and checkable. WhatChimp leads with a
 * "Meta Business Partner" badge; Bookly is a verified Meta Tech Provider with
 * Advanced access, which is the same class of signal and is earned. No
 * customer counts, no logo carousel, no testimonials — there are barely any
 * customers yet, and inventing them is the fastest way to lose the ones there
 * are.
 */
export function TrustStrip() {
    const items = [
        'Verified Meta Tech Provider',
        'Official WhatsApp Business Platform',
        'Payments by Paystack',
        'Mobile Money and card',
    ];
    return (
        <div className="fs-night px-5 pb-2 pt-10 sm:px-8">
            <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3">
                {items.map((i) => (
                    <li
                        key={i}
                        className="flex items-center gap-2 text-[13px]"
                        style={{ color: 'var(--muted-foreground)' }}
                    >
                        <Check className="h-3.5 w-3.5" style={{ color: 'var(--forest-glow)' }} />
                        {i}
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * The honest comparison.
 *
 * Every competitor in this space sends the owner off to open a Paystack
 * account and paste a secret key, and that is precisely where a
 * non-technical owner stops. Saying so plainly is stronger than any
 * feature list, and unlike a testimonial it is verifiable.
 */
export function Comparison() {
    const rows = [
        ['Open a payment gateway account', 'We handle it'],
        ['Find and paste an API secret key', 'Nothing to paste'],
        ['Open an SMS gateway account', 'We handle it'],
        ['Work out message templates', 'Already set up'],
        ['Wire up a webhook', 'Nothing to wire'],
    ];
    return (
        <div className="overflow-hidden rounded-[6px]" style={{ background: '#FBFAF7', boxShadow: '0 24px 50px -28px rgba(20,26,22,0.45), 0 0 0 1px var(--border)' }}>
            <div className="grid grid-cols-2 text-[12px] font-medium">
                <div className="px-4 py-3 sm:px-6" style={{ color: 'var(--muted-foreground)' }}>
                    Other tools ask you to
                </div>
                <div className="px-4 py-3 sm:px-6" style={{ background: 'var(--forest-brand)', color: '#FBFAF7' }}>
                    With Bookly
                </div>
            </div>
            {rows.map(([a, b], i) => (
                <div key={a} className="grid grid-cols-2 border-t text-[14px]" style={{ borderColor: 'var(--border)' }}>
                    <div className="px-4 py-3.5 sm:px-6" style={{ color: 'var(--muted-foreground)' }}>{a}</div>
                    <div className="px-4 py-3.5 font-medium sm:px-6" style={{ color: 'var(--foreground)', background: i % 2 ? 'transparent' : 'rgba(47,86,64,0.06)' }}>
                        {b}
                    </div>
                </div>
            ))}
        </div>
    );
}

/** Real integrations only — every one of these is actually wired up. */
export function WorksWith() {
    const items = ['WhatsApp', 'Instagram', 'Messenger', 'Paystack', 'Mobile Money', 'Google Calendar', 'SMS'];
    return (
        <div className="flex flex-wrap items-center gap-2">
            {items.map((i) => (
                <span
                    key={i}
                    className="rounded-[3px] px-3 py-2 text-[13px]"
                    style={{ background: '#FBFAF7', boxShadow: '0 0 0 1px var(--border)', color: 'var(--foreground)' }}
                >
                    {i}
                </span>
            ))}
        </div>
    );
}
