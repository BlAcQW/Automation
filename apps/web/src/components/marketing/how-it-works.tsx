'use client';

import { Plug, Wand2, Rocket, MessageCircle, Calendar, CreditCard } from 'lucide-react';
import { ScrollReveal, ScrollRevealItem } from '@/components/primitives/scroll-reveal';

const STEPS = [
    {
        n: '01',
        icon: Plug,
        title: 'Connect your WhatsApp Business number',
        body: 'Meta-approved embedded signup. Takes about a minute. Your existing number, no porting required.',
        visual: 'connect',
    },
    {
        n: '02',
        icon: Wand2,
        title: 'Design how the bot behaves',
        body: 'Drag-to-build flows for bookings, FAQs, payment reminders. No code. Test against your own number before going live.',
        visual: 'design',
    },
    {
        n: '03',
        icon: Rocket,
        title: 'Go live. Sleep better.',
        body: 'Bookly handles the routine — your team handles the interesting stuff. You see everything from one inbox.',
        visual: 'live',
    },
] as const;

type Step = (typeof STEPS)[number];

/**
 * HowItWorks — ui.md §7.5, simplified. Three-step explainer with staggered
 * reveals and a small CSS mock per step (instead of icon-only). Real GSAP
 * ScrollTrigger pinning is deferred to a polish pass.
 */
export function HowItWorks() {
    return (
        <ScrollReveal id="how" className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-32" stagger>
            {/* Section atmosphere — full-bleed divider + offset emerald glow bottom-left. */}
            <div aria-hidden className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-screen h-full overflow-hidden -z-10">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-ink-700/40 to-transparent" />
                <div className="absolute -bottom-32 -left-32 w-[560px] h-[560px] bookly-glow opacity-25" />
            </div>

            <ScrollRevealItem>
                <p className="text-caption uppercase tracking-[0.18em] text-bookly-emerald-400 mb-4 text-center">
                    How it works
                </p>
                <h2 className="font-display text-display-lg text-ink-50 text-center max-w-3xl mx-auto">
                    Three steps. Then it runs itself.
                </h2>
            </ScrollRevealItem>

            <div className="mt-12 sm:mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8 relative">
                {/* Connector line on desktop */}
                <div className="hidden md:block absolute top-[5.5rem] left-[16%] right-[16%] h-px bg-gradient-to-r from-transparent via-bookly-emerald-500/30 to-transparent" aria-hidden />
                {STEPS.map((s) => (
                    <ScrollRevealItem key={s.n}>
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
        <div className="relative">
            {/* Step number badge */}
            <div className="relative z-10 mx-auto mb-6 flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-2xl bg-ink-900 border border-ink-700 shadow-card">
                <Icon className="h-8 w-8 sm:h-9 sm:w-9 text-bookly-emerald-400" />
                <span className="absolute -top-2 -right-2 inline-flex h-7 px-2 items-center justify-center rounded-full bg-bookly-emerald-500 text-ink-1000 text-[11px] font-display font-bold tabular-nums">
                    {step.n}
                </span>
            </div>

            {/* Per-step mini visual */}
            <div className="mt-1 mb-5 px-2">
                {step.visual === 'connect' && <ConnectMock />}
                {step.visual === 'design' && <DesignMock />}
                {step.visual === 'live' && <LiveMock />}
            </div>

            <h3 className="font-display text-h3 text-ink-50 mb-2 text-center tracking-tight">{step.title}</h3>
            <p className="text-body-sm text-ink-300 text-center leading-relaxed px-2">{step.body}</p>
        </div>
    );
}

/* ============================================================
   Per-step mocks — CSS-only, no images
   ============================================================ */

function ConnectMock() {
    return (
        <div className="rounded-xl border border-ink-700 bg-ink-1000/60 px-3 py-3.5 flex items-center gap-3">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-[var(--wa-green)]/15 flex items-center justify-center">
                <MessageCircle className="h-4 w-4 text-[var(--wa-green)]" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-[11px] text-ink-300 uppercase tracking-wider">WhatsApp Business</p>
                <p className="text-[13px] font-medium text-ink-50 truncate">+233 24 ••• 4582</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-bookly-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-bookly-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-bookly-emerald-500" />
                Linked
            </span>
        </div>
    );
}

function DesignMock() {
    // 3-node flow: Trigger → Question → Action, with emerald connector lines
    return (
        <div className="rounded-xl border border-ink-700 bg-ink-1000/60 p-3 bg-dots">
            <div className="flex items-center gap-1.5">
                <FlowNode label="Trigger" />
                <FlowLine />
                <FlowNode label="Ask" highlight />
                <FlowLine />
                <FlowNode label="Book" />
            </div>
        </div>
    );
}

function FlowNode({ label, highlight }: { label: string; highlight?: boolean }) {
    return (
        <div
            className={`shrink-0 rounded-md px-2 py-1.5 text-[10px] font-semibold tracking-wide ${highlight
                ? 'bg-bookly-emerald-500 text-ink-1000 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                : 'bg-ink-800 border border-ink-700 text-ink-100'
                }`}
        >
            {label}
        </div>
    );
}

function FlowLine() {
    return <div className="flex-1 h-px bg-gradient-to-r from-bookly-emerald-500/50 via-bookly-emerald-400/70 to-bookly-emerald-500/50" />;
}

function LiveMock() {
    return (
        <div className="rounded-xl border border-ink-700 bg-ink-1000/60 px-3 py-3.5">
            <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-bookly-emerald-500/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-bookly-emerald-300">
                    <span className="status-dot" />
                    Live
                </span>
                <span className="text-[10px] tabular-nums text-ink-300">42 chats today</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
                <MiniStat icon={<Calendar className="h-3 w-3" />} label="Bookings" value="14" />
                <MiniStat icon={<CreditCard className="h-3 w-3" />} label="Paid" value="$612" />
                <MiniStat icon={<MessageCircle className="h-3 w-3" />} label="Open" value="3" />
            </div>
        </div>
    );
}

function MiniStat({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
}) {
    return (
        <div className="rounded-md border border-ink-700/70 bg-ink-900 px-2 py-1.5">
            <div className="flex items-center gap-1 text-ink-300">
                {icon}
                <span className="text-[9px] uppercase tracking-wider">{label}</span>
            </div>
            <p className="font-mono text-[11px] font-semibold text-ink-50 tabular-nums leading-tight mt-0.5">{value}</p>
        </div>
    );
}
