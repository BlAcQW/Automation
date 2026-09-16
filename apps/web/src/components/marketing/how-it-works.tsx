'use client';

import { MessageCircle, Clock, CalendarCheck } from 'lucide-react';
import { ScrollReveal, ScrollRevealItem } from '@/components/primitives/scroll-reveal';

const STEPS = [
    {
        icon: MessageCircle,
        title: 'Connect your WhatsApp number',
        body: 'The number you already use. You sign in with Meta, tap through, done. Nothing to install on your phone.',
        visual: 'connect',
    },
    {
        icon: Clock,
        title: 'Add your services and hours',
        body: 'What you offer, what it costs, how long it takes, when you are open. That is everything the assistant needs.',
        visual: 'services',
    },
    {
        icon: CalendarCheck,
        title: 'Customers book by messaging you',
        body: 'The assistant replies within seconds, day or night. You see every booking and every chat in one place.',
        visual: 'live',
    },
] as const;

type Step = (typeof STEPS)[number];

/**
 * Setup is the thing a first-time visitor is nervous about, so this section
 * shows the three screens they will actually meet, in order. No numbers on
 * the steps: the order on the page is the order.
 */
export function HowItWorks() {
    return (
        <ScrollReveal id="how" className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-28" stagger>
            <div aria-hidden className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-screen h-px bg-ink-700/50" />

            <ScrollRevealItem>
                <h2 className="font-display text-display-lg text-ink-50 max-w-[20ch] text-balance">
                    Set up in an afternoon. Then it runs itself.
                </h2>
            </ScrollRevealItem>

            <div className="mt-12 sm:mt-14 grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6">
                {STEPS.map((s) => (
                    <ScrollRevealItem key={s.title}>
                        <StepCard step={s} />
                    </ScrollRevealItem>
                ))}
            </div>
        </ScrollReveal>
    );
}

function StepCard({ step }: { step: Step }) {
    const Icon = step.icon;
    return (
        <div className="flex h-full flex-col rounded-2xl border border-ink-700 bg-ink-900 p-5 sm:p-6">
            <div className="mb-5">
                {step.visual === 'connect' && <ConnectMock />}
                {step.visual === 'services' && <ServicesMock />}
                {step.visual === 'live' && <LiveMock />}
            </div>
            <div className="mt-auto flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bookly-emerald-500/10 text-bookly-emerald-400">
                    <Icon className="h-4 w-4" />
                </span>
                <div>
                    <h3 className="font-display text-h3 text-ink-50 tracking-tight">{step.title}</h3>
                    <p className="mt-1.5 text-body-sm text-ink-300 leading-relaxed">{step.body}</p>
                </div>
            </div>
        </div>
    );
}

/* Small renders of the three real screens. */

function ConnectMock() {
    return (
        <div className="rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-3.5 flex items-center gap-3">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-[var(--wa-green)]/15 flex items-center justify-center">
                <MessageCircle className="h-4 w-4 text-[var(--wa-green)]" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[12px] text-ink-300">WhatsApp Business</p>
                <p className="text-[13px] font-medium text-ink-50 truncate tabular-nums">+233 24 000 0000</p>
            </div>
            <span className="rounded-full bg-bookly-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-bookly-emerald-300">
                Connected
            </span>
        </div>
    );
}

function ServicesMock() {
    const rows = [
        { name: 'Knotless braids', meta: '3 hr', price: 'GHS 250' },
        { name: 'Wash and set', meta: '45 min', price: 'GHS 60' },
        { name: 'Gel manicure', meta: '1 hr', price: 'GHS 90' },
    ];
    return (
        <div className="rounded-xl border border-ink-700 bg-ink-950 overflow-hidden">
            {rows.map((r, i) => (
                <div key={r.name} className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${i < rows.length - 1 ? 'border-b border-ink-700/60' : ''}`}>
                    <div className="min-w-0">
                        <p className="text-[13px] font-medium text-ink-50 truncate">{r.name}</p>
                        <p className="text-[11px] text-ink-300">{r.meta}</p>
                    </div>
                    <p className="text-[13px] font-medium text-ink-100 tabular-nums">{r.price}</p>
                </div>
            ))}
        </div>
    );
}

function LiveMock() {
    return (
        <div className="rounded-xl border border-ink-700 bg-ink-950 px-3.5 py-3.5">
            <p className="text-[12px] text-ink-300">Today</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
                <MiniStat label="Bookings" value="6" />
                <MiniStat label="Deposits" value="GHS 300" />
                <MiniStat label="Open chats" value="2" />
            </div>
        </div>
    );
}

function MiniStat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg border border-ink-700/70 bg-ink-900 px-2.5 py-2">
            <p className="font-display text-[15px] font-semibold text-ink-50 tabular-nums leading-tight">{value}</p>
            <p className="mt-0.5 text-[11px] text-ink-300">{label}</p>
        </div>
    );
}
