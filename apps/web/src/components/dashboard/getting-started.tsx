'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@bookingflow/ui';

interface Step {
    key: string;
    title: string;
    detail: string;
    href: string;
    done: boolean;
}

/**
 * The first thing a new owner sees. Four zeros tell them nothing; this tells
 * them the three things that make the product work, in order, and vanishes
 * once all three are done.
 *
 * Completion is derived from data that already exists (service count, hours,
 * WhatsApp status), so there is nothing to persist and nothing to get stale.
 */
export function GettingStarted() {
    const { tenant } = useAuth();
    const isProduct = tenant?.businessType === 'PRODUCT';

    const { data: catalogue } = useQuery<unknown[]>({
        queryKey: [isProduct ? 'products' : 'services', 'count'],
        queryFn: async () => {
            const res = await api.get(isProduct ? '/products' : '/services');
            const body = res.data;
            return Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
        },
        staleTime: 30_000,
    });

    const { data: hours } = useQuery<{ isOpen?: boolean; isActive?: boolean }[]>({
        queryKey: ['availability', 'hours'],
        queryFn: async () => {
            const res = await api.get('/availability/hours');
            const body = res.data;
            return Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
        },
        enabled: !isProduct,
        staleTime: 30_000,
    });

    const { data: wa } = useQuery<{ connected?: boolean }>({
        queryKey: ['whatsapp', 'status'],
        queryFn: async () => (await api.get('/whatsapp/status')).data,
        staleTime: 30_000,
    });

    const { data: templates } = useQuery<unknown[]>({
        queryKey: ['templates', 'count'],
        queryFn: async () => {
            const body = (await api.get('/templates')).data;
            return Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
        },
        staleTime: 30_000,
    });

    // Undefined while loading: don't flash "0 of 4" at someone who is done.
    if (catalogue === undefined || wa === undefined || templates === undefined || (!isProduct && hours === undefined)) return null;

    const steps: Step[] = [
        {
            key: 'catalogue',
            title: isProduct ? 'Add your products' : 'Add your services',
            detail: isProduct
                ? 'What you sell, with prices. The assistant quotes from this list.'
                : 'What you offer, how long it takes, what it costs. The assistant books from this list.',
            href: isProduct ? '/products' : '/services',
            done: catalogue.length > 0,
        },
        ...(!isProduct
            ? [{
                key: 'hours',
                title: 'Set your opening hours',
                detail: 'So customers are only offered times you are actually open.',
                href: '/availability',
                done: (hours ?? []).some((h) => h.isOpen ?? h.isActive ?? false),
            }]
            : []),
        {
            key: 'whatsapp',
            title: 'Connect your WhatsApp number',
            detail: 'Customers message the number you already use. Takes about two minutes.',
            href: '/whatsapp',
            done: !!wa.connected,
        },
        {
            key: 'templates',
            title: 'Add your message templates',
            detail: 'WhatsApp only lets us send reminders and confirmations through a template it has approved. We can set this up with you.',
            href: '/templates',
            done: templates.length > 0,
        },
    ];

    const remaining = steps.filter((s) => !s.done).length;
    if (remaining === 0) return null;

    const doneCount = steps.length - remaining;

    return (
        <section className="rounded-xl bg-ink-900 shadow-card overflow-hidden">
            <header className="px-5 pt-5 pb-4 sm:px-6">
                <p className="flex items-center gap-2 font-mono text-[11px] text-ink-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-forest-brand dark:bg-forest-glow" aria-hidden />
                    {doneCount} of {steps.length} done
                </p>
                <h2 className="mt-2 font-display text-[1.625rem] font-normal leading-[1.05] tracking-[-0.04em] text-ink-50">
                    {doneCount === 0 ? 'Set up your business' : 'Almost there'}
                </h2>
                <p className="mt-2 text-[14px] text-ink-300 max-w-[60ch]">
                    A few steps and your customers can book by sending a WhatsApp message.
                </p>
            </header>
            <ol className="border-t border-ink-50/[0.08] divide-y divide-ink-50/[0.06]">
                {steps.map((step, i) => (
                    <li key={step.key}>
                        {step.done ? (
                            <div className="flex items-center gap-4 px-5 py-4 sm:px-6 opacity-70">
                                <StepMarker done index={i} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-[14px] font-medium text-ink-300 line-through decoration-ink-500">
                                        {step.title}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <Link
                                href={step.href}
                                className="group flex items-center gap-4 px-5 py-4 sm:px-6 hover:bg-ink-50/[0.03] active:bg-ink-50/[0.05] transition-colors"
                            >
                                <StepMarker index={i} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-[14px] font-medium tracking-[-0.01em] text-ink-50">{step.title}</p>
                                    <p className="mt-0.5 text-[13px] leading-snug text-ink-300">{step.detail}</p>
                                </div>
                                <ChevronRight className="h-5 w-5 shrink-0 text-ink-400 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink-50" />
                            </Link>
                        )}
                    </li>
                ))}
            </ol>
        </section>
    );
}

function StepMarker({ done, index }: { done?: boolean; index: number }) {
    return (
        <span
            className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded text-[13px] font-medium tabular-nums',
                done
                    ? 'bg-forest-brand text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]'
                    : 'bg-white dark:bg-ink-1000 shadow-[0_0_0_1px_rgb(var(--ink-50-rgb)/0.12)] text-ink-200',
            )}
            aria-hidden
        >
            {done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : index + 1}
        </span>
    );
}
