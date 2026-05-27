'use client';

import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';

interface BillingStatus {
    plan: {
        id: string;
        name: string;
        messageLimitPerMonth: number;
    };
    subscription: {
        status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';
        trialEndsAt: string | null;
    };
    usage: {
        messages: { used: number; limit: number; ok: boolean };
    };
}

/**
 * Compact plan + monthly message-usage card. Lives at the foot of the
 * dashboard sidebar (above Sign Out) so the operator always knows where they
 * sit against their quota. Quietly hides when the API is unreachable.
 */
export function PlanCard() {
    const { data } = useQuery<BillingStatus>({
        queryKey: ['billing-status'],
        queryFn: async () => (await api.get('/billing/status')).data,
        staleTime: 5 * 60 * 1000,
        retry: 0,
    });

    if (!data) return null;

    const used = data.usage.messages.used;
    const limit = data.usage.messages.limit || 1;
    const pct = Math.min(100, Math.round((used / limit) * 100));
    const trialing = data.subscription.status === 'TRIALING';

    return (
        <Link
            href="/settings"
            className="block rounded-xl bg-ink-900 border border-ink-700 p-3 hover:border-bookly-emerald-500/40 transition-colors"
        >
            <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wider text-ink-300">
                    Plan details
                </p>
                {trialing && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
                        <Sparkles className="h-2.5 w-2.5" />
                        Trial
                    </span>
                )}
            </div>
            <p className="mt-1.5 text-sm font-semibold text-ink-50">{data.plan.name}</p>

            <div className="mt-2.5 h-1.5 w-full rounded-full bg-ink-800 overflow-hidden">
                <div
                    className={cn(
                        'h-full rounded-full transition-all',
                        pct >= 90
                            ? 'bg-gradient-to-r from-rose-500 to-amber-500'
                            : 'bg-gradient-to-r from-emerald-400 to-teal-500',
                    )}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <p className="mt-1.5 text-[11px] text-ink-300">
                {used.toLocaleString()}/{limit.toLocaleString()} messages used
            </p>
        </Link>
    );
}
