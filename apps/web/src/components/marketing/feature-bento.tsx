'use client';

import {
    Inbox,
    Bot,
    Calendar,
    CreditCard,
    Users,
    Megaphone,
    LineChart,
    UsersRound,
} from 'lucide-react';
import { ScrollReveal, ScrollRevealItem } from '@/components/primitives/scroll-reveal';
import { cn } from '@/lib/cn';

interface BentoCard {
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    /** Tailwind grid-span classes (default: single col). */
    span?: string;
    /** Optional rich visual rendered inside the card (overrides the icon). */
    visual?: 'inbox' | 'payments';
}

const CARDS: BentoCard[] = [
    {
        title: 'Smart inbox',
        description: 'A unified WhatsApp inbox the whole team can work from. Assign, snooze, filter — without leaving chat.',
        icon: Inbox,
        span: 'md:col-span-2',
        visual: 'inbox',
    },
    {
        title: 'No-code bot',
        description: 'Drag-to-build conversation flows. Booking, FAQ, payment reminder — configured the way you\'d talk to it.',
        icon: Bot,
    },
    {
        title: 'Bookings',
        description: 'Calendar sync, automated reminders, no-show recovery — the whole booking funnel runs itself.',
        icon: Calendar,
    },
    {
        title: 'Payments',
        description: 'Request, confirm, reconcile inside chat. Paystack and momo links sent automatically when an order closes.',
        icon: CreditCard,
        span: 'md:col-span-2',
    },
    {
        title: 'Contacts CRM',
        description: 'Auto-tagged. Segmented by behavior. Exportable to CSV when you need it.',
        icon: Users,
    },
    {
        title: 'Broadcasts',
        description: 'Compliant bulk messaging that doesn\'t get your number banned. Templates are pre-approved by Meta.',
        icon: Megaphone,
    },
    {
        title: 'Analytics',
        description: 'Response time, conversion, revenue per chat — finally measurable.',
        icon: LineChart,
    },
    {
        title: 'Multi-agent',
        description: 'Your whole team on one number. Conversations route to whoever is available; bot picks up the rest.',
        icon: UsersRound,
    },
];

/**
 * FeatureBento — ui.md §7.4. Mixed-size bento grid; some cards span 2 cols.
 * Each card hover: emerald border + faint inner glow.
 */
export function FeatureBento() {
    return (
        <ScrollReveal id="features" className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-32" stagger>
            {/* Section atmosphere — full-bleed divider + offset emerald glow top-right. */}
            <div aria-hidden className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-screen h-full overflow-hidden -z-10">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-ink-700/40 to-transparent" />
                <div className="absolute -top-24 -right-32 w-[600px] h-[600px] bookly-glow opacity-30" />
            </div>

            <ScrollRevealItem>
                <p className="text-caption uppercase tracking-[0.18em] text-bookly-emerald-400 mb-4 text-center">
                    Everything you need
                </p>
                <h2 className="font-display text-display-lg text-ink-50 text-center max-w-3xl mx-auto">
                    Everything your business does, in one chat.
                </h2>
            </ScrollRevealItem>

            <div className="mt-14 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
                {CARDS.map((card) => (
                    <ScrollRevealItem key={card.title} className={cn('group', card.span)}>
                        <FeatureCard {...card} />
                    </ScrollRevealItem>
                ))}
            </div>
        </ScrollReveal>
    );
}

function FeatureCard({ title, description, icon: Icon, visual }: BentoCard) {
    return (
        <article className="group/card relative h-full overflow-hidden rounded-2xl border border-ink-700 bg-ink-900 p-6 sm:p-7 transition-all duration-300 hover:border-bookly-emerald-500/40 hover:bg-ink-800/60">
            {/* Inner glow on hover */}
            <div
                className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover/card:opacity-100 pointer-events-none"
                style={{
                    background:
                        'radial-gradient(circle at 30% 0%, rgba(16,185,129,0.10) 0%, transparent 60%)',
                }}
                aria-hidden
            />
            <div className="relative">
                <div className="mb-4 sm:mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-bookly-emerald-500/10 border border-bookly-emerald-500/20 text-bookly-emerald-400 transition-transform duration-300 group-hover/card:scale-105">
                    <Icon className="h-5 w-5" />
                </div>
                <h3 className="font-display text-h3 text-ink-50 mb-2 tracking-tight">{title}</h3>
                <p className="text-body-sm text-ink-300 leading-relaxed">{description}</p>

                {visual === 'inbox' && <InboxPreview />}
            </div>
        </article>
    );
}

/** Mini static inbox preview — 3 rows, dark slate surface, unread dot. */
function InboxPreview() {
    return (
        <div className="mt-5 rounded-xl border border-ink-700 bg-ink-1000/60 overflow-hidden">
            {INBOX_ROWS.map((row, i) => (
                <div
                    key={row.name}
                    className={cn(
                        'flex items-center gap-3 px-3.5 py-2.5',
                        i !== INBOX_ROWS.length - 1 && 'border-b border-ink-700/60',
                        row.active && 'bg-ink-800/40',
                    )}
                >
                    <div
                        className={cn(
                            'h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[10px] font-display font-bold text-ink-1000',
                            row.color,
                        )}
                    >
                        {row.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                            <span className={cn('text-[12px] font-medium truncate', row.unread ? 'text-ink-50' : 'text-ink-100')}>
                                {row.name}
                            </span>
                            <span className="text-[10px] text-ink-300 shrink-0 tabular-nums">{row.time}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                            <span className="text-[11px] text-ink-300 truncate">{row.preview}</span>
                            {row.unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bookly-emerald-500" />}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

const INBOX_ROWS = [
    { name: 'Akosua A.', preview: 'Booked Saturday — confirmed ✓', time: '2:14', unread: true, color: 'bg-gradient-to-br from-bookly-emerald-400 to-bookly-emerald-600', active: false },
    { name: 'Kwame O.', preview: 'Can I reschedule to Friday?', time: '1:08', unread: true, color: 'bg-gradient-to-br from-amber-400 to-amber-600', active: true },
    { name: 'Adaeze N.', preview: 'Thanks! See you then.', time: 'Mon', unread: false, color: 'bg-gradient-to-br from-mint to-bookly-emerald-500', active: false },
];
