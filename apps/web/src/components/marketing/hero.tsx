'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Play, MessageCircle, Calendar, CreditCard, CheckCheck, Bot } from 'lucide-react';
import { GlowButton } from '@/components/primitives/glow-button';
import { durations, ease } from '@/lib/motion';

/**
 * Hero — ui.md §7.2. Full-viewport cinematic dark hero. The 3D R3F scene
 * is deferred (spec §7.2 itself recommends shipping without it first); we
 * use a CSS-only phone mock with a faux WhatsApp thread and a soft
 * `bookly-glow` radial behind it.
 */
export function Hero() {
    return (
        <section className="relative isolate overflow-hidden">
            {/* Atmospheric glows */}
            <div className="bg-orb bg-orb-1" />
            <div className="bg-orb bg-orb-2" />

            {/* Soft grid behind everything */}
            <div className="absolute inset-0 bg-grid opacity-60" aria-hidden />

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 sm:pt-36 lg:pt-44 pb-20 sm:pb-24 lg:pb-32">
                <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
                    {/* Copy column */}
                    <motion.div
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: durations.long, ease: ease.out }}
                    >
                        <div className="flex items-center gap-2 text-caption uppercase tracking-[0.18em] text-bookly-emerald-400 mb-6">
                            <span>WhatsApp × Automation ×</span>
                            <EyebrowRotator />
                        </div>
                        <h1 className="font-display text-display-xl text-ink-50 mb-7">
                            Run your whole business{' '}
                            <span className="text-gradient">inside one WhatsApp.</span>
                        </h1>
                        <p className="text-body-lg text-ink-200 max-w-xl mb-10">
                            Bookly turns WhatsApp into your bookings desk, customer support, and sales pipeline — handled by a bot you configure in minutes.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-10">
                            <GlowButton href="/register" size="lg">
                                Start free — no card
                            </GlowButton>
                            <GlowButton href="#how" variant="ghost" size="lg">
                                <Play className="w-4 h-4" />
                                Watch 90s demo
                            </GlowButton>
                        </div>

                        {/* Trust strip — centered on mobile, left-aligned on lg+ */}
                        <div className="text-center lg:text-left">
                            <p className="text-caption uppercase tracking-wider text-ink-300 mb-4">
                                Trusted by small businesses across Africa
                            </p>
                            <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-5 sm:gap-x-8 gap-y-2 opacity-60">
                                {['ATELIER', 'KIM & CO', 'GIMPERS', 'LessData', 'URBAN', 'NEXA'].map((name) => (
                                    <span key={name} className="text-[11px] sm:text-body-sm font-display font-semibold tracking-wider text-ink-200">
                                        {name}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </motion.div>

                    {/* Phone mock (placeholder for the R3F scene) */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: durations.long, ease: ease.out, delay: 0.2 }}
                        className="relative mx-auto"
                    >
                        {/* Breathing Bookly glow behind the phone */}
                        <BreathingGlow />
                        <PhoneMock />
                    </motion.div>
                </div>
            </div>
        </section>
    );
}

function PhoneMock() {
    return (
        <div className="relative mx-auto max-w-[320px] sm:max-w-[360px]">
            {/* Phone frame */}
            <div className="relative rounded-[2.5rem] border border-ink-700 bg-ink-900 p-3 shadow-card-lg">
                <div className="rounded-[2rem] overflow-hidden bg-ink-950 ring-1 ring-ink-800">
                    {/* WhatsApp header */}
                    <div className="bg-[var(--wa-dark)] px-4 py-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-bookly-emerald-400 to-bookly-emerald-600 flex items-center justify-center font-bold text-ink-1000">
                            B
                        </div>
                        <div className="flex-1">
                            <p className="text-body-sm font-semibold text-white">Bella Salon</p>
                            <p className="text-[10px] text-emerald-200/80 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-300" />
                                online · bot active
                            </p>
                        </div>
                        <Bot className="w-4 h-4 text-emerald-200/80" />
                    </div>

                    {/* Chat thread */}
                    <div className="bg-[#0B141A] px-4 py-5 space-y-3">
                        <CustomerBubble>Hi, can I book a haircut for Saturday?</CustomerBubble>
                        <BotBubble>
                            <p className="font-medium mb-1">Hi 👋 I'd be happy to help!</p>
                            <p>Saturday slots available:</p>
                            <div className="mt-2 space-y-1.5">
                                <SlotChip>10:00 AM</SlotChip>
                                <SlotChip>1:30 PM</SlotChip>
                                <SlotChip>4:00 PM</SlotChip>
                            </div>
                        </BotBubble>
                        <CustomerBubble>1:30 PM works.</CustomerBubble>
                        <TypingIndicator />
                        <BotBubble icon={<Calendar className="w-3 h-3" />}>
                            ✅ Booked for Sat · 1:30 PM
                            <span className="block mt-1 text-[10px] opacity-80">Payment link sent</span>
                        </BotBubble>
                    </div>

                    {/* Composer placeholder */}
                    <div className="bg-[#1F2C33] px-4 py-3 flex items-center gap-2">
                        <div className="flex-1 h-8 rounded-full bg-[#2A3942] flex items-center px-3 text-[11px] text-slate-400">
                            Type a message…
                        </div>
                        <div className="w-8 h-8 rounded-full bg-bookly-emerald-500 flex items-center justify-center">
                            <MessageCircle className="w-4 h-4 text-ink-1000" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Floating event chips — two on mobile (left + right), three on lg+. */}
            <FloatingChip
                className="-left-3 top-4 sm:-left-12"
                delay={0.6}
                icon={<CheckCheck className="w-3 h-3 text-bookly-emerald-300" />}
            >
                Booking confirmed
            </FloatingChip>
            <FloatingChip
                className="-right-3 top-32 sm:-right-12"
                delay={1.0}
                icon={<CreditCard className="w-3 h-3 text-bookly-emerald-300" />}
            >
                $45 received
            </FloatingChip>
            <FloatingChip
                className="hidden lg:flex -left-10 bottom-24"
                delay={1.4}
                icon={<Bot className="w-3 h-3 text-bookly-emerald-300" />}
            >
                Reminder scheduled
            </FloatingChip>
        </div>
    );
}

function CustomerBubble({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex">
            <div className="max-w-[78%] rounded-2xl rounded-bl-md bg-[#202C33] text-slate-100 px-3.5 py-2 text-[13px]">
                {children}
            </div>
        </div>
    );
}

function BotBubble({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
    return (
        <div className="flex justify-end">
            <div className="max-w-[80%] rounded-2xl rounded-br-md bg-[#005C4B] text-white px-3.5 py-2 text-[13px] shadow-sm">
                {icon && <span className="inline-flex items-center gap-1 mr-1 align-middle">{icon}</span>}
                {children}
            </div>
        </div>
    );
}

function SlotChip({ children }: { children: React.ReactNode }) {
    return (
        <div className="inline-block mr-1.5 px-2 py-1 rounded-md bg-white/10 text-[11px] font-medium tabular-nums">
            {children}
        </div>
    );
}

/**
 * Eyebrow rotator — cycles the third token in the eyebrow caption every
 * 2.6 s with a vertical wipe. Respects reduced-motion (stays on the first
 * token). Small touch, adds life to the static hero copy.
 */
const ROTATING_TOKENS = ['Zero Code', 'Bookings', 'Payments', 'Reminders'];

function EyebrowRotator() {
    const reduce = useReducedMotion();
    const [i, setI] = useState(0);
    useEffect(() => {
        if (reduce) return;
        const id = setInterval(() => setI((n) => (n + 1) % ROTATING_TOKENS.length), 2600);
        return () => clearInterval(id);
    }, [reduce]);

    if (reduce) {
        return <span>{ROTATING_TOKENS[0]}</span>;
    }
    return (
        <span className="relative inline-block overflow-hidden h-[1em]">
            <AnimatePresence mode="wait" initial={false}>
                <motion.span
                    key={ROTATING_TOKENS[i]}
                    initial={{ y: '100%', opacity: 0 }}
                    animate={{ y: '0%', opacity: 1 }}
                    exit={{ y: '-100%', opacity: 0 }}
                    transition={{ duration: 0.36, ease: ease.out }}
                    className="inline-block whitespace-nowrap"
                >
                    {ROTATING_TOKENS[i]}
                </motion.span>
            </AnimatePresence>
        </span>
    );
}

/**
 * Breathing glow — the bookly-glow behind the phone, slowly modulated
 * 0.6 → 1.0 opacity over 6 s. Gives the hero a subtle "alive" pulse.
 * Disabled under reduced-motion (stays at full opacity).
 */
function BreathingGlow() {
    const reduce = useReducedMotion();
    return (
        <motion.div
            aria-hidden
            className="absolute inset-0 bookly-glow"
            initial={{ opacity: 0.7 }}
            animate={reduce ? { opacity: 0.85 } : { opacity: [0.6, 1, 0.6] }}
            transition={
                reduce
                    ? { duration: 0 }
                    : { duration: 6, ease: 'easeInOut', repeat: Infinity }
            }
        />
    );
}

/**
 * Typing dots — the 3-dot pulse a WhatsApp bot shows while it's "thinking".
 * Loops slowly so the hero feels live.
 */
function TypingIndicator() {
    const reduce = useReducedMotion();
    return (
        <div className="flex justify-end">
            <div className="inline-flex items-center gap-1 rounded-2xl rounded-br-md bg-[#005C4B]/80 px-3 py-2.5">
                {[0, 1, 2].map((n) => (
                    <motion.span
                        key={n}
                        className="h-1.5 w-1.5 rounded-full bg-white/80"
                        initial={{ opacity: 0.3 }}
                        animate={reduce ? { opacity: 0.7 } : { opacity: [0.3, 1, 0.3] }}
                        transition={
                            reduce
                                ? { duration: 0 }
                                : {
                                    duration: 1.2,
                                    repeat: Infinity,
                                    ease: 'easeInOut',
                                    delay: n * 0.2,
                                }
                        }
                    />
                ))}
            </div>
        </div>
    );
}

function FloatingChip({
    children,
    className,
    delay,
    icon,
}: {
    children: React.ReactNode;
    className?: string;
    delay: number;
    icon: React.ReactNode;
}) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: durations.medium, ease: ease.out, delay }}
            className={`absolute flex items-center gap-1.5 sm:gap-2 rounded-xl border border-ink-700/70 bg-ink-900/95 backdrop-blur px-2.5 py-1.5 sm:px-3 sm:py-2 shadow-card-lg ${className ?? ''}`}
        >
            {icon}
            <span className="text-[10px] sm:text-[11px] font-medium text-ink-100 whitespace-nowrap">{children}</span>
        </motion.div>
    );
}
