'use client';

import {
    Inbox,
    Sparkles,
    CalendarClock,
    Banknote,
    Users,
    UsersRound,
} from 'lucide-react';
import { ScrollReveal, ScrollRevealItem } from '@/components/primitives/scroll-reveal';
import { SpotlightCard } from '@/components/primitives/spotlight-card';
import { cn } from '@/lib/cn';

interface FeatureCell {
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    span?: string;
    visual?: 'inbox' | 'reminder';
}

/**
 * Six things the product does today. Nothing on this list is a roadmap item:
 * if it isn't in the dashboard, it isn't here.
 */
const CELLS: FeatureCell[] = [
    {
        title: 'One inbox for every chat',
        description: 'Every customer conversation in one place. Read what the assistant said, step in when you want to, hand back when you are done.',
        icon: Inbox,
        span: 'md:col-span-2',
        visual: 'inbox',
    },
    {
        title: 'An assistant that knows your business',
        description: 'It greets customers by name, knows your services, prices and hours, and books straight into your calendar.',
        icon: Sparkles,
    },
    {
        title: 'Reminders that cut no-shows',
        description: 'The day before, the customer gets a WhatsApp reminder. Nobody has to remember to send it.',
        icon: CalendarClock,
        visual: 'reminder',
    },
    {
        title: 'Deposits paid in the chat',
        description: 'A Paystack link goes out when the customer chooses to pay now. Mobile money and cards. The seat is held until it is paid.',
        icon: Banknote,
        span: 'md:col-span-2',
    },
    {
        title: 'Customers, remembered',
        description: 'Every person who has ever messaged you, with their bookings and what they usually ask for.',
        icon: Users,
    },
    {
        title: 'Your team on one number',
        description: 'Add staff. Everyone answers from the same WhatsApp number, and you can see who said what.',
        icon: UsersRound,
    },
];

export function FeatureBento() {
    return (
        <ScrollReveal id="features" className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 lg:py-28" stagger>
            <div aria-hidden className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-screen h-px bg-ink-700/50" />

            <ScrollRevealItem>
                <h2 className="font-display text-display-lg text-ink-50 max-w-[22ch] text-balance">
                    Everything a booking business does, in one chat.
                </h2>
            </ScrollRevealItem>

            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
                {CELLS.map((cell) => (
                    <ScrollRevealItem key={cell.title} className={cn('group', cell.span)}>
                        <FeatureCard {...cell} />
                    </ScrollRevealItem>
                ))}
            </div>
        </ScrollReveal>
    );
}

function FeatureCard({ title, description, icon: Icon, visual }: FeatureCell) {
    return (
        <SpotlightCard className="h-full p-6 sm:p-7">
            <div className="mb-5 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-bookly-emerald-500/10 text-bookly-emerald-400">
                <Icon className="h-5 w-5" />
            </div>
            <h3 className="font-display text-h3 text-ink-50 mb-2 tracking-tight text-balance">{title}</h3>
            <p className="text-body-sm text-ink-300 leading-relaxed max-w-[52ch]">{description}</p>

            {visual === 'inbox' && <InboxPreview />}
            {visual === 'reminder' && <ReminderPreview />}
        </SpotlightCard>
    );
}

/** Three rows of the real inbox list, at inbox size. */
function InboxPreview() {
    return (
        <div className="mt-6 rounded-xl border border-ink-700 bg-ink-950 overflow-hidden">
            {INBOX_ROWS.map((row, i) => (
                <div
                    key={row.name}
                    className={cn(
                        'flex items-center gap-3 px-3.5 py-2.5',
                        i !== INBOX_ROWS.length - 1 && 'border-b border-ink-700/60',
                    )}
                >
                    <div className="h-8 w-8 shrink-0 rounded-full bg-ink-700 flex items-center justify-center text-[11px] font-display font-semibold text-ink-100">
                        {row.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                            <span className={cn('text-[13px] truncate', row.unread ? 'font-semibold text-ink-50' : 'font-medium text-ink-100')}>
                                {row.name}
                            </span>
                            <span className="text-[11px] text-ink-300 shrink-0 tabular-nums">{row.time}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                            <span className="text-[12px] text-ink-300 truncate">{row.preview}</span>
                            <span className={cn(
                                'shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
                                row.who === 'Assistant' ? 'bg-bookly-emerald-500/10 text-bookly-emerald-300' : 'bg-ink-700 text-ink-100',
                            )}>
                                {row.who}
                            </span>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

const INBOX_ROWS = [
    { initials: 'AA', name: 'Akosua Asante', preview: 'Booked Saturday 1:30 PM, deposit paid', time: '9:43', unread: true, who: 'Assistant' },
    { initials: 'KO', name: 'Kwame Osei', preview: 'Can I move it to Friday?', time: '9:12', unread: true, who: 'You' },
    { initials: 'EN', name: 'Efua Nyarko', preview: 'Thank you, see you then', time: 'Mon', unread: false, who: 'Assistant' },
];

function ReminderPreview() {
    return (
        <div className="mt-6 rounded-xl rounded-tr-sm bg-[#005C4B] px-3 py-2 text-[12.5px] leading-snug text-white">
            Reminder: knotless braids tomorrow at 1:30 PM at Adwoa&apos;s Hair Studio. Reply 1 to confirm or 2 to reschedule.
        </div>
    );
}
