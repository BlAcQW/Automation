'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

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
        <section className="rounded-2xl border border-bookly-emerald-500/30 bg-ink-900 overflow-hidden">
            <header className="px-5 pt-5 pb-4 sm:px-6">
                <p className="text-[13px] font-medium text-bookly-emerald-400">
                    {doneCount} of {steps.length} done
                </p>
                <h2 className="mt-1 font-display text-h2 text-ink-50">
                    {doneCount === 0 ? 'Set up your business' : 'Almost there'}
                </h2>
                <p className="mt-1 text-body-sm text-ink-300 max-w-[60ch]">
                    A few steps and your customers can book by sending a WhatsApp message.
                </p>
            </header>
            <ol className="border-t border-ink-700/70 divide-y divide-ink-700/70">
                {steps.map((step, i) => (
                    <li key={step.key}>
                        {step.done ? (
                            <div className="flex items-center gap-4 px-5 py-4 sm:px-6 opacity-70">
                                <StepMarker done index={i} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-body-sm font-medium text-ink-100 line-through decoration-ink-500">
                                        {step.title}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <Link
                                href={step.href}
                                className="flex items-center gap-4 px-5 py-4 sm:px-6 hover:bg-ink-800/60 active:bg-ink-800 transition-colors"
                            >
                                <StepMarker index={i} />
                                <div className="min-w-0 flex-1">
                                    <p className="text-body-sm font-semibold text-ink-50">{step.title}</p>
                                    <p className="mt-0.5 text-[13px] leading-snug text-ink-300">{step.detail}</p>
                                </div>
                                <ChevronRight className="h-5 w-5 shrink-0 text-ink-300" />
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
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums',
                done
                    ? 'bg-bookly-emerald-500 text-on-accent'
                    : 'border border-ink-600 text-ink-200',
            )}
            aria-hidden
        >
            {done ? <Check className="h-4 w-4" strokeWidth={2.5} /> : index + 1}
        </span>
    );
}
