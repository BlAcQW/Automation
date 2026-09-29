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
    return (
        <section
            id={id}
            className={`relative px-5 py-16 sm:px-8 sm:py-24 ${className}`}
            style={tint ? { background: 'var(--card)' } : undefined}
        >
            <div className="mx-auto max-w-6xl">{children}</div>
        </section>
    );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: 'var(--primary)' }}>
            {children}
        </p>
    );
}

export function Heading({ children, sub }: { children: React.ReactNode; sub?: string }) {
    return (
        <div className="max-w-2xl">
            <h2
                className="font-display text-[2rem] leading-[1.1] sm:text-[2.7rem]"
                style={{ color: 'var(--foreground)', textWrap: 'balance' }}
            >
                {children}
            </h2>
            {sub && (
                <p className="mt-4 text-[16px] leading-relaxed sm:text-[17px]" style={{ color: 'var(--muted-foreground)' }}>
                    {sub}
                </p>
            )}
        </div>
    );
}

export function PageHero({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
    return (
        <section className="glow relative px-5 pb-12 pt-14 sm:px-8 sm:pb-16 sm:pt-20">
            <div className="mx-auto max-w-6xl">
                <Eyebrow>{eyebrow}</Eyebrow>
                <h1
                    className="font-display text-[2.4rem] leading-[1.05] sm:text-[3.4rem]"
                    style={{ color: 'var(--foreground)', textWrap: 'balance' }}
                >
                    {title}
                </h1>
                <p className="mt-5 max-w-xl text-[16px] leading-relaxed sm:text-[18px]" style={{ color: 'var(--muted-foreground)' }}>
                    {sub}
                </p>
            </div>
        </section>
    );
}

export function CTA({ href, children, variant = 'solid' }: {
    href: string; children: React.ReactNode; variant?: 'solid' | 'ghost';
}) {
    const solid = { background: 'var(--primary)', color: 'var(--primary-foreground)' };
    const ghost = { border: '1px solid var(--border)', color: 'var(--foreground)' };
    return (
        <Link
            href={href}
            className="inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold sm:w-auto"
            style={variant === 'solid' ? solid : ghost}
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
                        className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                        style={{ background: 'var(--secondary)' }}
                    >
                        <Icon className="h-[18px] w-[18px]" style={{ color: 'var(--primary)' }} />
                    </div>
                    <div>
                        <h3 className="text-[15px] font-semibold" style={{ color: 'var(--foreground)' }}>{t}</h3>
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
                    className="rounded-2xl p-6"
                    style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
                >
                    <Icon className="h-6 w-6" style={{ color: 'var(--primary)' }} />
                    <h3 className="mt-4 font-semibold" style={{ color: 'var(--foreground)' }}>{n}</h3>
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

            <div className="rounded-2xl p-6 sm:p-7" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--muted-foreground)' }}>
                    Ready to withdraw
                </p>
                <p className="mt-1 font-display text-[2.75rem] leading-none" style={{ color: 'var(--primary)' }}>GHS 1,240</p>
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
                <div
                    className="mt-6 flex min-h-[48px] items-center justify-center gap-2 rounded-xl text-sm font-semibold"
                    style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                    Send to my MoMo <ArrowRight className="h-4 w-4" />
                </div>
            </div>
        </div>
    );
}

export function ClosingCTA({ title, sub }: { title: string; sub: string }) {
    return (
        <Section>
            <div
                className="relative overflow-hidden rounded-3xl px-6 py-12 text-center sm:px-14 sm:py-16"
                style={{ background: 'var(--secondary)', border: '1px solid var(--primary)' }}
            >
                <h2
                    className="font-display text-[1.9rem] leading-tight sm:text-[2.5rem]"
                    style={{ color: 'var(--secondary-foreground)', textWrap: 'balance' }}
                >
                    {title}
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-[15px] sm:text-[16px]" style={{ color: 'rgba(253,230,138,0.75)' }}>
                    {sub}
                </p>
                <div className="mx-auto mt-8 max-w-xs">
                    <CTA href="/register">Get started free <ArrowRight className="h-4 w-4" /></CTA>
                </div>
            </div>
        </Section>
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
        <div className="border-y px-5 py-4 sm:px-8" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2">
                {items.map((i) => (
                    <span
                        key={i}
                        className="text-[11px] font-medium uppercase tracking-[0.12em]"
                        style={{ color: 'var(--muted-foreground)' }}
                    >
                        {i}
                    </span>
                ))}
            </div>
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
        <div className="overflow-hidden rounded-2xl" style={{ border: '1px solid var(--border)' }}>
            <div className="grid grid-cols-2 text-[11px] font-semibold uppercase tracking-[0.12em]">
                <div className="px-4 py-3 sm:px-6" style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}>
                    Other tools ask you to
                </div>
                <div className="px-4 py-3 sm:px-6" style={{ background: 'var(--secondary)', color: 'var(--primary)' }}>
                    With Bookly
                </div>
            </div>
            {rows.map(([a, b], i) => (
                <div key={a} className="grid grid-cols-2 border-t text-[14px]" style={{ borderColor: 'var(--border)' }}>
                    <div className="px-4 py-3.5 sm:px-6" style={{ color: 'var(--muted-foreground)' }}>{a}</div>
                    <div className="px-4 py-3.5 font-medium sm:px-6" style={{ color: 'var(--foreground)', background: i % 2 ? 'transparent' : 'rgba(69,26,3,0.25)' }}>
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
                    className="rounded-lg px-3 py-2 text-[13px]"
                    style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                >
                    {i}
                </span>
            ))}
        </div>
    );
}
