'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, CalendarCheck, CreditCard, BellRing } from 'lucide-react';
import { GlowButton } from '@/components/primitives/glow-button';
import { BlurFade, BlurFadeWords } from '@/components/primitives/blur-fade';
import { DotPattern } from '@/components/primitives/dot-pattern';
import { durations, ease } from '@/lib/motion';

/**
 * Hero. One headline, one sentence, two buttons, and a real conversation
 * with the assistant on the right. The conversation is the product, so it
 * is the hero visual; nothing else is competing for the first screen.
 */
export function Hero() {
    const reduce = useReducedMotion();
    return (
        <section className="relative isolate overflow-hidden">
            {/* One ambient light source, top-right, behind the phone, over a
                dotted field that fades out before it reaches the edges. */}
            <div className="bg-orb bg-orb-1" aria-hidden />
            <DotPattern className="[mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,#000_30%,transparent_100%)]" />

            <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 sm:pt-28 lg:pt-32 pb-16 sm:pb-20 lg:pb-28">
                <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-center">
                    <motion.div
                        initial={reduce ? false : { opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: durations.long, ease: ease.out }}
                    >
                        <h1 className="font-display text-display-xl text-ink-50 text-balance">
                            <BlurFadeWords text="Your bookings, taken on WhatsApp. By an assistant that never sleeps." step={0.045} />
                        </h1>
                        <BlurFade as="p" delay={0.55} className="mt-6 text-body-lg text-ink-200 max-w-[38ch] text-pretty">
                            Bookly answers your customers, books the appointment, collects the deposit and sends the reminder. You just show up.
                        </BlurFade>

                        <BlurFade delay={0.7} className="mt-9 flex flex-col sm:flex-row gap-3">
                            <GlowButton href="/register" size="lg">
                                Start free
                                <ArrowRight className="w-4 h-4" />
                            </GlowButton>
                            <GlowButton href="#how" variant="ghost" size="lg">
                                See how it works
                            </GlowButton>
                        </BlurFade>
                    </motion.div>

                    <motion.div
                        initial={reduce ? false : { opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: durations.long, ease: ease.out, delay: 0.15 }}
                        className="relative mx-auto w-full"
                    >
                        <PhoneMock />
                    </motion.div>
                </div>
            </div>
        </section>
    );
}

/**
 * A WhatsApp thread as the customer sees it. This is a scaled-down render
 * of the product's own output, not a decorative mock: the copy is what the
 * assistant actually says.
 */
function PhoneMock() {
    return (
        <div className="relative mx-auto max-w-[320px] sm:max-w-[350px]">
            <div className="relative rounded-[2.25rem] border border-ink-700 bg-ink-900 p-2.5 shadow-card-lg">
                <div className="rounded-[1.75rem] overflow-hidden bg-[#0B141A] ring-1 ring-ink-800">
                    {/* WhatsApp header */}
                    <div className="bg-[var(--wa-dark)] px-4 py-3 flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-bookly-emerald-500 flex items-center justify-center font-display font-bold text-on-accent">
                            A
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-body-sm font-semibold text-white truncate">Adwoa&apos;s Hair Studio</p>
                            <p className="text-[11px] text-emerald-200/80">Business account</p>
                        </div>
                    </div>

                    {/* Thread */}
                    <div className="px-3.5 py-4 space-y-2.5">
                        <CustomerBubble time="9:41">Hi, can I book braids for Saturday?</CustomerBubble>
                        <BotBubble time="9:41">
                            Welcome to Adwoa&apos;s Hair Studio. Yes, Saturday works. Knotless braids take about 3 hours. I have these times open:
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                <SlotChip>9:00 AM</SlotChip>
                                <SlotChip>1:30 PM</SlotChip>
                            </div>
                        </BotBubble>
                        <CustomerBubble time="9:42">1:30 please</CustomerBubble>
                        <BotBubble time="9:42">
                            I have held Saturday 1:30 PM for you for 30 minutes. Pay the GHS 50 deposit here and it is confirmed:
                            <span className="mt-1.5 block truncate text-[12px] text-emerald-200/90 underline underline-offset-2">
                                paystack.com/pay/adwoa-hair-9f2a
                            </span>
                        </BotBubble>
                        <CustomerBubble time="9:43">Done</CustomerBubble>
                        <BotBubble time="9:43">
                            Deposit received, you are booked. I will remind you the day before.
                        </BotBubble>
                    </div>

                    {/* Composer */}
                    <div className="bg-[#1F2C33] px-3 py-2.5 flex items-center gap-2">
                        <div className="flex-1 h-9 rounded-full bg-[#2A3942] flex items-center px-3.5 text-[12px] text-slate-400">
                            Message
                        </div>
                        <div className="w-9 h-9 rounded-full bg-[var(--wa-green)] flex items-center justify-center">
                            <ArrowRight className="w-4 h-4 text-on-accent" />
                        </div>
                    </div>
                </div>
            </div>

            {/* What happened in the dashboard while that chat ran. On phones
                the chips sit in a row under the screen, where they can't cover
                the conversation; on wide screens they float beside the frame. */}
            <div className="mt-4 flex flex-wrap justify-center gap-2 lg:hidden">
                {EVENTS.map((e, i) => (
                    <EventChip key={e.label} delay={0.9 + i * 0.25} icon={e.icon}>{e.label}</EventChip>
                ))}
            </div>
            <div className="hidden lg:block">
                <EventChip className="absolute -left-52 top-[14%]" delay={0.9} icon={EVENTS[0].icon}>{EVENTS[0].label}</EventChip>
                {/* Sits in the empty space to the right of the "Done" bubble; the
                    viewport has no room past the phone on the right at 1280px. */}
                <EventChip className="absolute -right-4 top-[65%]" delay={1.2} icon={EVENTS[1].icon}>{EVENTS[1].label}</EventChip>
                <EventChip className="absolute -left-48 bottom-[14%]" delay={1.5} icon={EVENTS[2].icon}>{EVENTS[2].label}</EventChip>
            </div>
        </div>
    );
}

const EVENTS = [
    { label: 'Booking confirmed', icon: <CalendarCheck className="w-3.5 h-3.5" /> },
    { label: 'GHS 50 deposit paid', icon: <CreditCard className="w-3.5 h-3.5" /> },
    { label: 'Reminder scheduled', icon: <BellRing className="w-3.5 h-3.5" /> },
];

function CustomerBubble({ children, time }: { children: React.ReactNode; time: string }) {
    return (
        <div className="flex">
            <div className="max-w-[82%] rounded-xl rounded-tl-sm bg-[#202C33] text-slate-100 px-3 py-1.5 text-[13px] leading-snug">
                {children}
                <span className="ml-2 align-bottom text-[11px] text-slate-400 tabular-nums">{time}</span>
            </div>
        </div>
    );
}

function BotBubble({ children, time }: { children: React.ReactNode; time: string }) {
    return (
        <div className="flex justify-end">
            <div className="max-w-[86%] rounded-xl rounded-tr-sm bg-[#005C4B] text-white px-3 py-1.5 text-[13px] leading-snug">
                {children}
                <span className="ml-2 align-bottom text-[11px] text-emerald-100/70 tabular-nums">{time}</span>
            </div>
        </div>
    );
}

function SlotChip({ children }: { children: React.ReactNode }) {
    return (
        <span className="inline-block rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium tabular-nums">
            {children}
        </span>
    );
}

function EventChip({
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
    const reduce = useReducedMotion();
    return (
        <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: durations.medium, ease: ease.out, delay: reduce ? 0 : delay }}
            className={`flex items-center gap-2 rounded-xl border border-ink-700 bg-ink-900 px-3 py-2 shadow-card-lg ${className ?? ''}`}
        >
            <span className="text-bookly-emerald-400">{icon}</span>
            <span className="text-[12px] font-medium text-ink-50 whitespace-nowrap">{children}</span>
        </motion.div>
    );
}
