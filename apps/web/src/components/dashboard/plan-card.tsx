'use client';

import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { cn } from '@bookingflow/ui';

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
        // Dark forest-card panel on the forest frame.
        <Link
            href="/settings"
            className="group block rounded-xl bg-forest-card p-3 text-forest-cream shadow-[0_20px_36px_-24px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.06)] hover:shadow-[0_20px_36px_-24px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.06),0_0_0_1px_rgba(236,235,225,0.14)] dark:shadow-[0_0_0_1px_rgba(236,235,225,0.06)] transition-shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-glow"
        >
            <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] text-forest-cream/50">
                    /plan details/
                </p>
                {trialing && (
                    <span className="inline-flex items-center gap-1 rounded bg-forest-cream px-1.5 py-0.5 text-[11px] font-medium text-forest-night">
                        <Sparkles className="h-2.5 w-2.5" />
                        Trial
                    </span>
                )}
            </div>
            <p className="mt-1.5 text-[15px] font-medium tracking-[-0.02em] text-forest-cream">{data.plan.name}</p>

            <div className="mt-2.5 h-1 w-full rounded-sm bg-white/10 overflow-hidden">
                <div
                    className={cn(
                        'h-full rounded-sm transition-all',
                        pct >= 90 ? 'bg-[#E08A7E]' : 'bg-forest-glow',
                    )}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <p className="mt-1.5 text-[11px] tabular-nums text-forest-cream/60">
                {used.toLocaleString()}/{limit.toLocaleString()} messages used
            </p>
        </Link>
    );
}
