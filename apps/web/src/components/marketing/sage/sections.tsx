import Link from 'next/link';
import { Reveal, RevealItem, LiftCard } from './motion';
import {
    MessageCircle, Instagram, Facebook, Wallet, CalendarCheck,
    BellRing, ShieldCheck, Users, ArrowRight, Check,
} from 'lucide-react';

/**
 * Landing page sections, written from the positioning brief
 * (docs/strategy/what-bookly-sells.pdf).
 *
 * The brief's argument drives the order: we sell a RECEPTIONIST, the price
 * anchor is a salary and lost no-shows rather than other software, and the
 * two things nobody else does — handling payments and texts so the owner
 * never touches a gateway — are given their own section rather than buried
 * in a feature grid.
 */

export function Section({ id, children, tint }: { id?: string; children: React.ReactNode; tint?: boolean }) {
    return (
        <section
            id={id}
            className="relative px-5 sm:px-8 py-20 sm:py-28"
            style={tint ? { background: 'var(--secondary)' } : undefined}
        >
            <div className="mx-auto max-w-5xl">{children}</div>
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
            <h2 className="font-display text-3xl sm:text-[2.6rem] leading-[1.08]" style={{ color: 'var(--foreground)' }}>
                {children}
            </h2>
            {sub && <p className="mt-4 text-[17px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{sub}</p>}
        </div>
    );
}

/* ------------------------------------------------------------------ */

/** The problem, in the owner's own terms. Money already walking out. */
export function TheProblem() {
    return (
        <Section tint>
            <Eyebrow>The thing that actually costs you</Eyebrow>
            <Heading sub="Not admin. Not 'efficiency'. Two specific leaks, both of them money.">
                Every missed message is a booking that went next door.
            </Heading>

            <Reveal className="mt-12 grid gap-6 sm:grid-cols-2">
                {[
                    {
                        n: '1',
                        t: "You're mid-service and the phone buzzes",
                        d: "You can't stop. By the time you reply she's booked somewhere else. It happens every single working day and you never see the ones you lost.",
                    },
                    {
                        n: '2',
                        t: 'They book, then just never come',
                        d: 'Three no-shows a week at GHS 50 is GHS 600 a month gone, and the chair sat empty while someone else could have had it.',
                    },
                ].map((c) => (
                    <LiftCard
                        key={c.n}
                        className="rounded-xl p-7"
                        style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                    >
                        <span
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold"
                            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                        >
                            {c.n}
                        </span>
                        <h3 className="mt-4 text-lg font-semibold" style={{ color: 'var(--foreground)' }}>{c.t}</h3>
                        <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{c.d}</p>
                    </LiftCard>
                ))}
            </Reveal>
        </Section>
    );
}

/** The seven jobs, in the order a customer feels them. */
const JOBS = [
    { icon: MessageCircle, t: 'Answers while you work', d: "Replies in seconds, at any hour, so the booking doesn't go to the salon down the road." },
    { icon: CalendarCheck, t: 'Only offers real free times', d: 'Checks your hours, your days off, your existing bookings and how many customers you take at once.' },
    { icon: Wallet, t: 'Takes the deposit up front', d: 'Mobile Money or card. The slot is held for 30 minutes and released if nobody pays.' },
    { icon: BellRing, t: 'Reminds them before the day', d: 'The single biggest reason a deposit turns into someone actually turning up.' },
    { icon: Users, t: 'Keeps one diary', d: 'Replaces the notebook and the "I think I have someone at two".' },
    { icon: Instagram, t: 'Answers where you advertise', d: 'Instagram and Messenger as well as WhatsApp — the same assistant, the same diary behind all three.' },
    { icon: ShieldCheck, t: 'Keeps your customer list yours', d: 'Staff see only the last four digits of any number. They can work; they cannot copy your book.' },
];

export function WhatItDoes() {
    return (
        <Section id="features">
            <Eyebrow>What it does</Eyebrow>
            <Heading sub="Seven jobs, in the order you'll feel them.">
                A receptionist who never takes lunch.
            </Heading>

            <Reveal className="mt-12 grid gap-x-10 gap-y-9 sm:grid-cols-2">
                {JOBS.map(({ icon: Icon, t, d }) => (
                    <RevealItem key={t} className="flex gap-4">
                        <div
                            className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                            style={{ background: 'var(--secondary)' }}
                        >
                            <Icon className="h-[18px] w-[18px]" style={{ color: 'var(--primary)' }} />
                        </div>
                        <div>
                            <h3 className="text-[15px] font-semibold" style={{ color: 'var(--foreground)' }}>{t}</h3>
                            <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{d}</p>
                        </div>
                    </RevealItem>
                ))}
            </Reveal>
        </Section>
    );
}

/**
 * The differentiator. Every competitor still sends the owner off to open a
 * Paystack account and fetch an API key — which is precisely where a
 * non-technical owner stops.
 */
export function NoSetup() {
    return (
        <Section tint>
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
                <div>
                    <Eyebrow>No accounts. No keys. No setup.</Eyebrow>
                    <Heading sub="Taking payments and sending texts are the two steps that stop people. Everyone else asks you to go and open an account somewhere and paste in a secret key. We just do it.">
                        You never touch a payment gateway.
                    </Heading>
                    <ul className="mt-8 space-y-3.5">
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

                {/* A concrete artefact beats an abstract claim. */}
                <div
                    className="rounded-2xl p-7"
                    style={{ background: 'var(--background)', border: '1px solid var(--border)' }}
                >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--muted-foreground)' }}>
                        Ready to withdraw
                    </p>
                    <p className="mt-1 font-display text-5xl" style={{ color: 'var(--foreground)' }}>GHS 1,240</p>

                    <div className="mt-5 space-y-2.5 border-t pt-5 text-sm" style={{ borderColor: 'var(--border)' }}>
                        <Row k="Still clearing" v="GHS 300" />
                        <Row k="Goes to" v="MTN · 024 ••• 4567" />
                    </div>

                    <div
                        className="mt-6 flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold"
                        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                    >
                        Send to my MoMo <ArrowRight className="h-4 w-4" />
                    </div>
                    <p className="mt-3 text-center text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        Usually arrives in a few minutes.
                    </p>
                </div>
            </div>
        </Section>
    );
}

function Row({ k, v }: { k: string; v: string }) {
    return (
        <div className="flex items-center justify-between">
            <span style={{ color: 'var(--muted-foreground)' }}>{k}</span>
            <span className="font-medium tabular-nums" style={{ color: 'var(--foreground)' }}>{v}</span>
        </div>
    );
}

export function Channels() {
    const items = [
        { icon: MessageCircle, n: 'WhatsApp', d: 'Bookings, deposits and reminders.' },
        { icon: Instagram, n: 'Instagram', d: 'Answers the DMs your posts already bring in.' },
        { icon: Facebook, n: 'Messenger', d: 'Answers messages to your Page.' },
    ];
    return (
        <Section id="channels">
            <Eyebrow>Where it works</Eyebrow>
            <Heading sub="Customers message you the way they already do. Nothing to download, nothing for them to learn.">
                Your customers don&apos;t install anything.
            </Heading>
            <Reveal className="mt-12 grid gap-5 sm:grid-cols-3">
                {items.map(({ icon: Icon, n, d }) => (
                    <LiftCard
                        key={n}
                        className="rounded-xl p-6"
                        style={{ background: 'var(--secondary)', border: '1px solid transparent' }}
                    >
                        <Icon className="h-6 w-6" style={{ color: 'var(--primary)' }} />
                        <h3 className="mt-4 font-semibold" style={{ color: 'var(--foreground)' }}>{n}</h3>
                        <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{d}</p>
                    </LiftCard>
                ))}
            </Reveal>
        </Section>
    );
}

export function HowItWorks() {
    const steps = [
        { n: '1', t: 'Connect your WhatsApp', d: 'One guided step. No code, no keys.' },
        { n: '2', t: 'Add your services and hours', d: 'What you do, what it costs, when you are open.' },
        { n: '3', t: 'Share your number', d: 'Put it in your Instagram bio. The assistant takes it from there.' },
    ];
    return (
        <Section id="how" tint>
            <Eyebrow>Getting started</Eyebrow>
            <Heading sub="Most people are taking bookings the same afternoon.">Three steps, once.</Heading>
            <Reveal className="mt-12 grid gap-8 sm:grid-cols-3">
                {steps.map((s) => (
                    <RevealItem key={s.n}>
                        <span className="font-display text-4xl" style={{ color: 'var(--primary)' }}>{s.n}</span>
                        <h3 className="mt-3 font-semibold" style={{ color: 'var(--foreground)' }}>{s.t}</h3>
                        <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{s.d}</p>
                    </RevealItem>
                ))}
            </Reveal>
        </Section>
    );
}

export function WhoItsFor() {
    const fits = [
        'Salons, barbers, nail and lash techs', 'Spas, dental and aesthetic clinics',
        'Physios, tutors and trainers', 'Photographers and mechanics',
        'Anyone selling on Instagram', 'Anyone with staff on the books',
    ];
    return (
        <Section>
            <Eyebrow>Who it&apos;s for</Eyebrow>
            <Heading sub="Anything booked by appointment, run by one to eight people — big enough to lose bookings while you're busy, too small to pay someone to answer the phone.">
                Built for a business run from a phone.
            </Heading>
            <Reveal className="mt-10 flex flex-wrap gap-2.5">
                {fits.map((f) => (
                    <RevealItem key={f}><span
                        key={f}
                        className="rounded-full px-4 py-2 text-sm"
                        style={{ background: 'var(--secondary)', color: 'var(--foreground)' }}
                    >
                        {f}
                    </span></RevealItem>
                ))}
            </Reveal>
        </Section>
    );
}

export function FAQ() {
    const qs = [
        { q: 'Do my customers need an app?', a: 'No. They use WhatsApp or Instagram exactly as they already do. That is the whole point.' },
        { q: 'Can I still reply myself?', a: 'Any time. Open the chat and type — the assistant steps back and waits until you hand it back.' },
        { q: 'How do I get my money?', a: 'Customers pay through Bookly and your earnings show up in your account. Send them to your Mobile Money whenever you like.' },
        { q: 'Do I need a Paystack account?', a: 'No. That is the step we removed. You only give us the MoMo number you want to be paid on.' },
        { q: 'What if someone cancels?', a: 'The deposit stays with you — that is what holding the slot is worth. If they just want a different time, they reschedule and their deposit moves with them.' },
        { q: 'Can my staff see customer numbers?', a: 'Only the last four digits. They can reply and work normally, but they cannot copy your customer list. You see everything.' },
        { q: 'Is it only for salons?', a: 'No. Anything booked by appointment works — clinics, tutors, mechanics, photographers.' },
    ];
    return (
        <Section id="faq" tint>
            <Eyebrow>Questions</Eyebrow>
            <Heading>Straight answers.</Heading>
            <div className="mt-10 divide-y" style={{ borderColor: 'var(--border)' }}>
                {qs.map(({ q, a }) => (
                    <details key={q} className="group py-5">
                        <summary
                            className="flex cursor-pointer list-none items-center justify-between gap-6 text-[16px] font-medium"
                            style={{ color: 'var(--foreground)' }}
                        >
                            {q}
                            <span
                                className="shrink-0 text-xl transition-transform group-open:rotate-45"
                                style={{ color: 'var(--primary)' }}
                                aria-hidden="true"
                            >
                                +
                            </span>
                        </summary>
                        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>{a}</p>
                    </details>
                ))}
            </div>
        </Section>
    );
}

export function FinalCTA() {
    return (
        <Section>
            <div
                className="relative overflow-hidden rounded-2xl px-8 py-14 text-center sm:px-14"
                style={{ background: 'var(--foreground)' }}
            >
                <h2 className="font-display text-3xl sm:text-[2.5rem] leading-tight" style={{ color: 'var(--background)' }}>
                    Stop losing bookings because you were busy.
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-[16px]" style={{ color: 'rgba(255,252,240,0.72)' }}>
                    Set it up this afternoon. Your assistant answers the next message that comes in.
                </p>
                <Link
                    href="/register"
                    className="mt-8 inline-flex min-h-[48px] items-center gap-2 rounded-lg px-7 text-[15px] font-semibold transition-opacity hover:opacity-90"
                    style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                >
                    Get started free <ArrowRight className="h-4 w-4" />
                </Link>
            </div>
        </Section>
    );
}
